# MISSION 001 — native NPC wreck loot refactor (evidence)

Behaviour-preserving refactor of `transferNativeWreckItemToCharacterLocation` in
`Code/server/src/space/npc/nativeNpcWreckService.js`, with independent characterization tests,
an independent review, an isolated deployment and server-side gameplay proofs.

## Commits

| what | repo | SHA |
|---|---|---|
| base (authoritative local branch `coop/pas7std`, 11 commits ahead of `origin`) | EveJS | `9de4f74868f226451cd1c75ef5be00d4bd7c4851` |
| characterization tests, part 1 (8 tests) | evejs-coop-universe | `458554e1` |
| characterization tests, part 2 (4 failure/flag tests) | evejs-coop-universe | `a8cf2fe6` |
| characterization tests, part 3 (4 runtime-refresh tests) | evejs-coop-universe | `98409a94` |
| refactor candidate | EveJS | `29fd6cf4efe0bd658d41cbcb0df6c8d3895e5943` |
| integrated (no-ff merge of the candidate on the base; tree identical to the candidate) | EveJS | `09455de501b74373db949a4b3f828fd63905ac35` |

Worktrees (never the shared checkout, never PLAY): `O:\tmp\m001\tests` (tests), `O:\tmp\m001\refactor`
(candidate), `O:\tmp\m001\integration` (integration).

## What changed

One file, +31/−8. Three duplicated `createNpcExpeditionWreckCustody({items,npcStore,gameStore})`
constructions (two inside the duplicated emptiness expression, one inside the pickup function) became
one memoised `getNativeWreckExpeditionCustody()`; the duplicated emptiness expression became
`isNativeWreckEmpty(wreckID)`. The pickup body, error codes, feature flags, quantity/singleton
clamping, change records, broadcast and the grant-before-source-debit order are unchanged; that
ordering is documented in place instead of being altered.

## Tests added (16, all against the untouched baseline first)

`tests/coop-native-wreck-loot-transfer.test.mjs` — full stack, partial stack (conserved total),
singleton, singleton refusing an explicit quantity > 1, repeated pickup, invalid ids, wreck
association mismatch, over-request.

`tests/coop-native-wreck-loot-failure-paths.test.mjs` — grant failure propagation,
grant-before-source-removal ordering, the pre-existing duplication defect (labelled
`BASELINE-DEFECT`), and the native loot quarantine gate.

`tests/coop-native-wreck-loot-runtime-refresh.test.mjs` — the emptiness rule through
`refreshNativeWreckRuntimeEntity`: non-empty with loot, empty after the last unit, one broadcast only
when asked, `WRECK_NOT_FOUND` when the wreck is not in the scene.

Fixture: real `gameStore`/`itemStore`/`nativeNpcStore` on an attested disposable SQLite root
(`server/tests/helpers/isolatedGameStore.js` attestation), no service mocks. The only test double is
the scene object at the runtime boundary in the refresh test.

## Regression

| run | tests | pass | fail | skipped |
|---|---|---|---|---|
| 69 related suites (wreck, custody, salvage, loot, inventory, economy) — baseline | 798 | 795 | 0 | 3 |
| the same 69 suites — candidate `29fd6cf4` | 798 | 795 | 0 | 3 |
| the same 69 suites + the 16 new tests — integrated `09455de5` | 802 | 799 | 0 | 3 |
| full overlay suite — integrated `09455de5` | 7000 | 6895 | 10 | 95 |

The 10 full-suite failures are the pre-existing ones recorded in the project's own `state/NOW.md`
baseline (absent-state, client contracts, flag registry, hook requires, installer coverage); none of
them touches the wreck pickup path and none appears in the 69-suite comparison, which is identical on
baseline and candidate.

`node --check` on the changed file exits 0. No other file changed in any commit.

## Independent review (DeepSeek, exact candidate SHA)

Verdict **pass**, 0 blocking findings, 2 observations, both argued as unreachable/benign:

1. `isNativeWreckEmpty` normalizes `wreckID` at the build call site where the old code passed it raw.
   Only a non-integer wreck id could differ, and wreck ids come from `allocateWreckID`.
2. The memoised custody instance is safe because `createNpcExpeditionWreckCustody` is stateless and
   frozen; it is still constructed lazily behind the flag.

## Deployment (isolated, not PLAY)

`compose/compose.mission001.yaml` in this repository: project `evejs-m001`, volumes
`evejs-m001-data`/`evejs-m001-images`, loopback ports `29443/26222/29000-29002/42110`, image pinned
per SHA. PLAY (`evejs`, 443/5222/26000-26002/40110) was never restarted, rebuilt or mounted.

| stage | image | server | market |
|---|---|---|---|
| baseline world | `evejs-m001:base-9de4f74` | healthy | healthy (`/health` 200) |
| candidate upgrade, same volumes | `evejs-m001:cand-29fd6cf4` | healthy | healthy |
| integrated artefact (deployed, probed, restarted) | `evejs-m001:int-09455de5` | healthy | healthy |

The gameplay probe and the restart check were run on the **candidate** image and then again on the
**integrated** image `evejs-m001:int-09455de5`, with the same volumes (a real upgrade, not a fresh
world). The probe process exits 3 because it counts scenario E as required; A–D are the service
scenarios and all pass.

## Server-side gameplay (real service path, real world store)

`probe2.cjs` runs inside the game container with the server stopped (single writer), on the deployed
candidate:

| scenario | result |
|---|---|
| A full stack 10 → character | 10 granted, one stack, source row removed — PASS |
| B partial 4 of 10 | 4 granted, 6 left in the wreck, total conserved 10 — PASS |
| C duplicate request | refused `ITEM_NOT_FOUND`, no second copy — PASS |
| D failures | association mismatch `ITEM_NOT_FOUND`, unknown character `CHARACTER_NOT_FOUND`, over-request `INSUFFICIENT_ITEMS`, nothing moved — PASS |
| E runtime wreck refresh | NOT RUN on the deployed server: `spawnNativeWreck` returns `WRECK_BUILD_FAILED` for a synthetic wreck record (the synthetic record is not a real wreck type). The rule is covered by the 4 runtime-refresh tests with a scene double instead. |

## Restart / durability

After the probe, the server was stopped and started on the same volumes and the store was read back
with a second SQLite reader (`verify6.cjs`):

- A: destination total 10, source row still absent — PASS
- B: destination 4, source 6, conserved 10 — PASS

## Pre-existing integrity defect (found, not introduced, not fixed here)

If the wreck-source write fails after the destination grant, the function returns `success: true`,
reports `removed: true`, and the units exist in **both** the wreck and the character's inventory.
Demonstrated on the untouched baseline and recorded as `BASELINE-DEFECT` in the failure-path tests
(4 + 4 = 8 from a 4-unit stack). `removeNativeWreckItem`'s result is never checked.

Proposed separate fix (its own change, its own tests, not part of this refactor): check the removal
result; on failure return an error (`NATIVE_LOOT_SOURCE_NOT_REMOVED`) and seal the pair with
`coopNativeLootQuarantine.quarantine({wreckID, wreckItemID, reason: "NATIVE_LOOT_SOURCE_NOT_REMOVED"})`,
which is exactly the fail-closed mechanism that already exists for an unverified source debit.

## Not verified

- Real EVE client (build 3396210): NOT RUN — owner decision; a second client copy with its own
  `start.ini` port was judged unrealistic here.
- Two-player regression (scenario F): NOT RUN for the same reason.
