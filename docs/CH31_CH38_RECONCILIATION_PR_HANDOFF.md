# PR handoff — CH31 corporations + CH38 new-player experience

**Scope:** one source-only reconciliation of two previously delivered Chat tasks on the exact `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` pin. No native client patches, GameStore schema changes, wallet writes, starter grants, Docker volume edits, CI or live deployment. This PR does **not** re-approve the entire 42-chat project.

## Commits to understand first

| Commit | Owner/delivered behavior | Current integration disposition |
|---|---|---|
| [`c70487306dd93cc4f010d982cadb1c1915aeb2d6`](https://github.com/pas7-studio/evejs-coop-universe/commit/c70487306dd93cc4f010d982cadb1c1915aeb2d6) | Chat 31: read-only corporate roles, hangar/office/wallet/industry checks, reversible source patch, 29 mock tests | Helper copied by reconciled central installer, source hooks now registered; a native-character-schema bug was repaired in this PR |
| [`6d0c2ea29a5ec0d5f27a1ab84899fcde23ae3257`](https://github.com/pas7-studio/evejs-coop-universe/commit/6d0c2ea29a5ec0d5f27a1ab84899fcde23ae3257) | Chat 38: per-character native tutorial RPC authorization, actual tutorial state, no invented achievements, reversible patch | **Already centrally installed** before this PR. Reused unchanged; guard OFF by default |
| [`e9bc93d28bba5d8aa62fbac944f150c46b835e2a`](https://github.com/pas7-studio/evejs-coop-universe/commit/e9bc93d28bba5d8aa62fbac944f150c46b835e2a) | Chat 01/42 post-merge module and overlay reconciliation | Kept; changed only five CH31 source targets and one native hook registration clause |
| [`023cc059f09b1838d55fe2eff2887c633f87515d`](https://github.com/pas7-studio/evejs-coop-universe/commit/023cc059f09b1838d55fe2eff2887c633f87515d) | Chat 24: player mining custody, 15 isolated tests | **Not enabled here**; needs separate ALIFE-06/07 native mining source-order validation and live dual-player verification |
| [`01837680c42543f25f6cc9460b6c2dcc5ece9de6`](https://github.com/pas7-studio/evejs-coop-universe/commit/01837680c42543f25f6cc9460b6c2dcc5ece9de6) | Chat 17: NPC industry recovery/unknown-settlement proof | Separate NPC economy owner; no changes here |

## Actual defects fixed in this one reconciliation commit

1. **CH31 was not active in the native installer:** `integration/coopPlayerCorporationAccess.cjs` already appeared in the copy list, but `scripts/patch-evejs-coop.cjs` had no `specs` or `transform` bindings for `industryAccess.js`, `invBrokerService.js`, `corpRegistryRuntime.js`, `corpMemberActionState.js`, `officeManagerService.js`. Register these **exact** five existing native paths and call the existing reversible `coop-player-corporation-access-patch.cjs` in the central transform. Do not duplicate modules or rewrite ownership.
2. **CH31 checked a nonexistent field:** pinned native `charService.Handle_CreateCharacterWithDoll` saves a character record indexed by ID, but does not store an embedded `characterID` field. `characterState.getCharacterRecord(id)` normalizes the record without inventing that field. Previous CH31 mocked `characterID` and would deny genuine CEOs and applicants. The guard now validates selected `session.characterID/charid`, persisted `accountId` against `session.userid`, saved `corporationID`, saved member and corporation records, and validates an embedded character ID only **if actually present**. Also reject conflicting aliases, disconnected sessions and account mismatch. No separate identity store is created.
3. **Regression proof:** update CH31 fixtures to reflect the pinned native record shape, add negative spoof/revoked/account/alias cases, and add a central-overlay bridge test for both CH31/CH38 registration, opt-in guards and reversible native changes.
4. **CH38 deliberately unchanged:** prior pinning/wiring was already correct and protects against cross-character tutorial skip/state mutation. Its default-off compatibility gate remains unchanged.

## Mandatory acceptance before enabling flags

Both switches are **OFF unless explicitly enabled**:

- `EVEJS_COOP_PLAYER_CORP_ACCESS=1` — only after original pinned-client UI and role matrix tests on a disposable preserved-world copy. Check native CEO/new member invite, member join, office rent, seven hangar views/transfers, corporate hull transfer and separate wallet divisions 1000–1006. Test role revocation and third-person asset denial; prove no fleet-to-corp authorization confusion. Corporate member `ExecuteActions` cash/share grants intentionally fail closed pending durable cross-wallet atomic receipts, not a silent lost-ISK compromise.
- `EVEJS_COOP_NPE_NATIVE_SAFETY=1` — only after native tutorial client result shape is verified. Two independent authenticated new characters should each retain exactly one starter ship and native starting items/skills/ISK on reconnect/restart. Test original tutorial and career agent, one mission acceptance and one real combat encounter, joining the same native fleet, and exactly-once mission rewards. No GM hacks. Starter Space, titles and achievement writes are **not** proven supported by this pinned client.

Run `node --test tests/coop-player-corporation-access.test.mjs tests/coop-npe-native-state.test.mjs tests/coop-chat31-chat38-overlay-bridge.test.mjs`, then validate real pinned source install/remove and `--check` on an **isolated** EveJS checkout. Live E2E, crash atomics, fleet/mission/killmail outcomes and multi-client UI are unverified; neither test success nor an opened PR is gameplay acceptance.

## Reviewer routing to other bots

- **Chat 01:** review central `specs` and reversible `transform` insertion order, check overlay deployment path and `--check` against pinned EveJS without writing into the active world.
- **Chat 31:** confirm corporation source guard handles real character records without embedded `characterID`; verify native office inventory owner, permission and wallet boundaries. Complete proper atomic corporate cash/share grants separately; do not weaken the test.
- **Chat 38:** validate stock `air_npe`, `nes_intro`, achievements and `tutorialSvc` RPC against actual client and two independent accounts; no duplicate starter grant and no tutorial-state override.
- **Chat 05/19/20/42:** furnish distinct-account real client fleet + first career mission + first battle acceptance evidence, not mocked session fixtures. Match the user-visible outcome to the original game.
- **Chat 24/40:** player mining exact item custody, restart and finance transaction hazards remain separate review gates; do not silently activate source hooks.

**Truth label:** `CODE_READY / LIVE_UNVERIFIED`; this PR narrows proven source/authorization gaps, not world readiness. Preserve native data, market ledger, SQLite, all Docker volumes, and existing commits from other workers.
