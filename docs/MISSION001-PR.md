## What

Behaviour-preserving refactor of `transferNativeWreckItemToCharacterLocation` in
`Code/server/src/space/npc/nativeNpcWreckService.js` — one file, **+31/−8**, no other file touched.

- three duplicated `createNpcExpeditionWreckCustody({items,npcStore,gameStore})` constructions
  (two inside a duplicated emptiness expression, one inside the pickup function) become one memoised
  `getNativeWreckExpeditionCustody()`;
- that duplicated emptiness expression becomes `isNativeWreckEmpty(wreckID)`, used by both the wreck
  runtime-entity build and the refresh;
- the grant-before-source-debit window is **documented in place**, not changed.

Unchanged and asserted: public signature, return shapes, every error code, feature flags,
quantity/singleton clamping, change records, side-effect ordering, broadcast.

## Why

The pickup path is the one place where four co-op mechanisms (expedition custody, salvage atomic
transfer, native loot quarantine, boss loot fence) sit inside a single 110-line function, and the same
custody construction was copy-pasted three times in the file. Naming the two rules makes the pickup
contract readable and gives the failure path a single place to be fixed later.

## Evidence

| gate | result |
|---|---|
| base | `coop/pas7std` @ `9de4f74` (11 commits ahead of `origin`) |
| candidate | `29fd6cf4` |
| integrated (no-ff, identical tree) | `09455de5` |
| characterization tests, frozen before the refactor | 16 tests, 16 pass |
| 69 related suites (wreck, custody, salvage, loot, inventory, economy) | 798 tests, 795 pass, 0 fail, 3 skipped — **identical to baseline** |
| same suites + new tests on the integrated SHA | 802 tests, 799 pass, 0 fail, 3 skipped |
| full overlay suite on the integrated SHA | 7000 tests, 6895 pass, 10 fail, 95 skipped — the 10 are the documented pre-existing failures in `state/NOW.md` |
| independent DeepSeek review of `29fd6cf4` | **pass**, 0 blocking, 2 benign observations |
| isolated deployment (`evejs-m001`, own volumes/ports) | healthy server + market, image `evejs-m001:int-09455de5` |
| server-side gameplay on the deployed image | full stack, partial (4 of 10, conserved), duplicate refused, failure paths — all pass |
| restart durability | destination/source state identical after stop/start |

## Pre-existing defect (not fixed here)

If the wreck-source write fails after the destination grant, the function returns `success: true`,
reports `removed: true`, and the units exist in both places (`removeNativeWreckItem`'s result is never
checked). Demonstrated on the untouched baseline and recorded as `BASELINE-DEFECT` in the
characterization suite. The fix is proposed as a separate change (fail closed, seal the pair with
`coopNativeLootQuarantine`), because changing it changes transaction semantics and must not ride along
with a pure refactor.

## Not verified

Real EVE client pickup and two-player interaction were not run (no second isolated client copy); the
clients' gates are reported as NOT RUN, not as passed.
