# EveJS Personal Fleet — PF58 original stock-ship native handoff (candidate)

**NOT GAMEPLAY READY. Personal Fleet remains OFF. DO NOT deploy to PLAY.**

PF58 closes one genuine integration gap in PF54: use the *existing original
player ship itemID* as the NPC's physical entityID, instead of calling standard
`spawnNativeNpcEntityInContext()`, which allocates a different ID and duplicate
NPC equipment. A separate original controller binds to that same physical ID.

## Included executable code

- `native/coopPersonalFleetOriginalShipHandoff.cjs`: authoritative PF54 ISSUING
  read + PF52 reservation + ownership + original ItemStore checks, one durable
  `CONSUMED` single-flight permit in `corporationRuntime`, then one external
  stock-ship handoff attempt. **Never redispatch after crash/unknown result.**
- `native/coopPersonalFleetNativeShipAdoption.cjs`: create real native NPC entity
  and controller on **the same original ItemStore itemID**. No new hull,
  native module/cargo row, ISK or inventory title. Start `nativeAmbient` with
  weapons disabled; stock ammo/combat authorization is NOT integrated.
- `native/coopPersonalFleetOriginalNativePermit.cjs`: read-only original GameStore
  verifier: initial one-shot `ISSUING` permitted only when explicitly requested;
  ordinary restart requires PF54 `ACTIVE` and matching PF actor claim.
  **PF73:** in the same original SQLite transaction, also rejects native restart
  after PF56 `DOCK_ISSUING` / `DOCKED`, any PF66/PF67 dock attempt, or PF60
  terminal intent. Early PF56 return is allowed only with a matching original
  return record and canonical PF56 SHA256 digest (not a keyed MAC) and no dock dispatch; unknown/corrupt keys deny startup.
- `native/coopPersonalFleetNativeBindings.cjs`: explicit one-time boot owner,
  defaults unavailable, never trusts environment flags alone.
- `native/coopPersonalFleetNativeBootstrap.cjs`: composition root wiring the
  PF54 one-shot callback to original ItemStore, native NPC service, mounted
  scene and independently verified physical actor. The live server must supply
  ORIGINAL session, station, offer, profile, equipment, writer and ownership
  authorities; stub callbacks are only for isolated tests.
- `build_native_stock_fittings_patch.py`: SHA-1 pinned REVIEW patch generator for
  original `Code/server/src/space/npc/nativeNpcService.js`. Enables stock
  fitting/slim module reads for PF58 ships and fail-closed restart admission.
  **Does not modify EveJS or enable the flag.**
- `tests/`: original PF58 baseline (59 Node tests, including Linux SIGKILL)
  plus PF69-73 integration/patch tests. PF73 adds **25 SQLite WAL/FULL Node
  tests**, including a child `SIGKILL` after durable docking intent. Run the
  full test discovery locally; no genuine WORK/EVE client run has occurred.
  See `docs/PF73_DOCK_RESTART_FENCE.md`.

## Source pins and local preflight

Original native fork: `pas7-studio/EveJS`, branch `coop/pas7std`.

- `Code/server/src/space/npc/nativeNpcService.js`: Git blob SHA-1
  `ca039daaaad2839d17f7109de2f3834cec0373a8`.
- `Code/server/src/space/runtime.js`: `0de66d2ab0499bfcff2b1bb57176e775c9b8df22`.
- `Code/server/src/space/npc/nativeNpcStore.js`: `95724ab4537683e7ee933bc3149d0a891082ce7e`.
- `Code/server/src/services/inventory/itemStore.js`: `e992d56ee9cff1911d54247bf46d44d01e5d8060`.
- `Code/server/src/space/npc/npcData.js`: `8046ced2336923ec6801c954f67aba300a65e127`.
- `Code/server/src/space/npc/npcEquipment.js`: `8c14469d3bcbecdd326c345fd41b3514599e3daf`.
- `Code/server/src/space/coopGameStoreAtomic.js`: `2b28b48145f3fbc989ce7346384487ee75e52280`.

On Linux:

```bash
node --test --test-concurrency=1 tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 build_native_stock_fittings_patch.py /path/to/EveJS --output PF58-native.patch
(cd /path/to/EveJS && git apply --check /absolute/path/to/PF58-native.patch)
```

On Windows, `Test-PF58-Local.ps1` runs non-SIGKILL Node tests and Python tests.
Use WSL/Linux for exact `SIGKILL` coverage. `-NativeCheckout` performs a
read-only source-pinned patch preflight. Nothing applies/merges automatically.

## Real installation gates (not satisfied)

1. Source-pin and manually review native NPC service patch in a separate WORK
   branch. Copy new native modules to `Code/server/src/space/` and install
   native bootstrap with REAL authorities (PF52, original stock ItemStore,
   nativeNpcStore, npcService, mounted runtime, profile resolver, equipment and
   independent actor proof). Feature is OFF without successful binding.
2. Globally fence all original ship ownership writers: inventory, player
   session transitions, stock market, manufacturing, WAR, Mining, Exploration,
   NPC spawn/materialize and native despawn/wreck. This is NOT implemented by
   the PF58 patch alone. `allWritersFenced` must be backed by actual fencing.
3. Resolve original player-owned persisted-space-ship materialization races.
   PF58 currently refuses an existing scene entity; it does not hijack it.
4. Obtain valid authored native NPC profile with `profile.shipTypeID ===
   originalShip.typeID` and original player pilot availability proof.
5. Restore original fitted items/slim modules from ItemStore, with no second
   NPC cargo/module title. **Weapon/charge consumption is not wired**; only
   non-combat Hold/Follow/Warp can be evaluated after PF55 ownership binding.
6. Validate PF54 reconcile, PF55 native order receipts, PF56 true sessionless
   docking/cargo custody, PF57 salaries, real two-player WORK E2E and crash
   recovery with original ItemStore + native controller tables.
7. Keep main and PLAY untouched until a separately reviewed WORK acceptance.

**Never merge the orchestration PR as a gameplay-ready implementation.**

## PF87 — strict original stock title + permit (manual WORK only)

The source-bound bootstrap now **requires** the original ship's hangar-to-space
title transfer to happen inside the exact same original GameStore
`BEGIN IMMEDIATE` transaction that consumes the PF58 durable one-shot
handoff permit. It also reads the native `characters` active-ship table in
that transaction and refuses any ship already marked active for a character.
The original ItemStore post-commit movement API is forbidden for this strict
path; generic legacy fixture mode remains available only for backward
compatibility. Original source modules still must be pinned and reviewed.

Tests: `tests/pf87-atomic-handoff.test.cjs` and
`tests/test_pf87_atomic_preflight.py`. The local PF58 runner includes both,
and the local PF80 WORK builder checks PF87 **before** applying the native
review patch. See `docs/PF87_ATOMIC_ORIGINAL_TITLE_AND_PERMIT.md`.

**NOT gameplay-ready:** other stock player / Mining / WAR / Exploration
writers and the running native engine still require independent verified
fencing and local two-client gameplay, restart, dock and wallet E2E.
Personal Fleet OFF; no PLAY/main merge.

## PF88 — reciprocal original writer custody (review-only)

The existing, source-bundled PF58 native permit module exports
`createReciprocalWriterFence({pf52}).inTransaction({tx,writer,shipItemID,
affectedItemID,destinationLocationID})`. This blocks an original ship that
has a PF52 reservation, native PF actor claim, one-shot PF58 handoff or
PF60 terminal custody. The same guard covers nested stock-fitted modules
and cargo, and inbound destination writes. A clear result is valid only
inside the **same** original writer's SQLite/GameStore mutation transaction.

The source-bound PF58 bootstrap now defaults its independent writer
fence OFF unless `verifyOriginalWriterHooks()` is provided and true
alongside the previous all-writers fence. The genuine original EveJS player,
Mining, WAR and Exploration writer hooks are **NOT INSTALLED** from this
orchestration repo. `scripts/pf88/Test-PF88-Local.ps1` runs the isolated
contract suite and optional source-pinned original writer audit; the audit
always reports BLOCKED_FOR_ACTIVATION. See
`scripts/pf88/PF88_RECIPROCAL_WRITER_CONTRACT.md`.

These changes are **not** a working native writer integration or gameplay
acceptance. Personal Fleet OFF and Draft PR retained.

## PF89 — actual original inventory delta enforcement

PF88 allowed the caller to declare which stock item or ship would be
modified. PF89 adds `mutateOriginalItemsInTransaction`, which computes
the **actual** changed original item IDs from a complete before/after
`items/items` snapshot inside a single native GameStore transaction.
It checks old/new module and cargo ancestry, every touched ship's durable
custody, untrusted builder/unknown changes, and only then performs one
stock item row write. A false/Promise builder never authorizes a commit;
attempted direct stock tx writes throw to force rollback.

`createNativeBootstrap` now exposes
`mutateForeignOriginalItemsWithinTransaction`, but **original EveJS
ItemStore/characterState/Mining/WAR/Exploration hooks are not installed**.
The refactor must live in the actual original engine fork and preserve its
single-owner write, cache indexes, transient cargo and notifications.
Full details and local tests:
`scripts/pf89/PF89_ACTUAL_ORIGINAL_ITEMS_DELTA_GATE.md`.
Feature OFF, PR Draft, no PLAY changes.
