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

## PF90 original ItemStore owner snapshots (2026-11-07)

The bundled PF58 original permit module exposes
`commitOriginalOwnerSnapshot({tx,writer,expectedBefore,nextItems})`:
an authoritative original snapshot comparison inside the same GameStore
SQLite transaction as PF89's actual item diff and the PF88 reciprocal
ship-custody checks. It rejects stale before-images, malformed snapshots
and hidden item modifications, then writes only the same original item
root once. The source-bound bootstrap exports
`commitStockOwnerSnapshotWithinTransaction`.

**This is a candidate API, NOT an original ItemStore hook**. The
unchanged stock `readItems()/writeItems()` still exposes a mutable
cache alias and schedules writes separately, and `characterState`
owns independent character writes. Native WORK source-pinned audit
documents and reproduces that hazard. Local regression:
`tests/pf90-owner-snapshot.test.cjs`; full explanation:
`scripts/pf90/PF90_ORIGINAL_STOCK_OWNERS.md`.
Personal Fleet OFF, no original fork or PLAY update.

## PF91 original per-character ship ownership (2026-11-07)

PF91 fixes a P0 schema mismatch in PF87's strict active-player check:
the real original `characterState` writes `characters` one SQLite row
per characterID, whereas the historical PF87 fixture stored a synthetic
`characters/characters` aggregate. PF87 now calls the shared
`inspectOriginalCharacterShipRows(tx,...)` on a **same transaction**
`tx.scan('characters')` of canonical original keys. Unreadable, absent,
mixed legacy, malformed or already-active original title fails closed.
The strict PF87 Node fixture now uses real individual SQLite rows.

The source-bundled permit module also exports
`createOriginalPlayerShipActivation(...).activate(...)` for a future
real `characterState` integration. It checks owner/target/previous
stock ship/claims under a single SQLite transaction, verifies an
independent docked-session witness twice and updates only the original
character row. It is **disabled by default and NOT wired into the
original EveJS characterState**. The bootstrap exposes the candidate
method but cannot activate it without original writer hooks. See
`scripts/pf91/PF91_ORIGINAL_CHARACTER_ROWS_AND_ATOMIC_PLAYER_SWITCH.md`.

## PF92 generic original character owner mutation fence

PF91's original player ship switch was only one route to the generic
`characterState.writeCharacterRecord()` entrypoint. In original EveJS,
`getCharacterRecord` normalization, `updateCharacterRecord` and
`itemStore.syncCharacterActiveShip` also reach that owner. PF92 adds
`createOriginalCharacterRecordWriteBarrier` to the existing PF58
candidate permit module to enforce real before/after per-character
SQLite writes, protected active-ship aliases, old/new original physical
hull custody, all-original-character collision scans and source-bound
session leases under one original `BEGIN IMMEDIATE`. Unsafe
captured-writer callbacks force rollback.

The native bootstrap exports a guarded character owner write function,
but **only while Personal Fleet is enabled and all original writers are
independently fenced**. No original `characterState` runtime hook is
installed and Personal Fleet remains OFF. Original owner source proofs,
26 new Node fixture cases and manual local commands:
`scripts/pf92/PF92_ORIGINAL_CHARACTER_GENERIC_WRITE_FENCE.md`.

## PF93 original SQLite witness rollback (2026-11-07)

PF91/PF92 session witnesses now share a complete, transaction-scoped
original SQLite row fingerprint before/after every witness callback.
The three scoped tables (`corporationRuntime`, `items`, `characters`)
are scanned and SHA256-attested, including unrelated row keys. A
callback closure writing anything in those tables forces an exception
and rollback, **even if it returns false**. The read-only witness
interface stays unchanged and async callbacks are rejected.
Source-bound original GameStore checks and local 16-case native
SQLite fixture regression:
`scripts/pf93/PF93_NATIVE_SESSION_WITNESS_ATOMIC_ISOLATION.md`.
This is a conservative O(database) safeguard, NOT final native
session-fencing or original engine integration. Personal Fleet OFF.

## PF94 original GameStore mutation epoch (2026-11-07)

The PF93 full original SQLite row fingerprint cannot detect
write-then-restore or identical-value writes. PF94 adds a separately
testable candidate single-writer mutation epoch (no patch installer)
that must be constructed by the actual original GameStore owner
after BEGIN IMMEDIATE. Its wrapped put/del increments a private count
on **every write attempt**, and its session witness aborts if that count
changed. Tested on actual Node 22 `node:sqlite` with 14/14 PASS,
including explicit SQLite rollback and a deliberate raw-writer bypass
negative case. The unchanged original fork is source-pinned and
does **not** have this hook. See
`scripts/pf94/PF94_ORIGINAL_OWNER_MUTATION_EPOCH.md`.
Personal Fleet OFF; unrelated PF91/92 code is not automatically
authorized by a passing PF94 standalone suite.

## PF95 original single-writer SQLite handoff (2026-11-07)

PF95 supplies a one-file, source-pinned **review-only** diff against
the original `coopGameStoreAtomic.js` owner. It installs no runtime
patcher or other SQLite writer in this repository. Inside the
original `BEGIN IMMEDIATE`, each `put/del` increments a private
counter and `verifyReadOnlySessionWitness` rejects any callback
that writes, including put/restore and delete-missing. Escaped
transaction methods also fail after commit/rollback. The new API
is OFF without `EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=1`.

The optional `-NativeCheckout` PF58 local runner now validates
the exact original source blob and checks/executes the candidate
patch **only on a temporary copy** with real Node SQLite. See
`scripts/pf95/PF95_NATIVE_GAMESTORE_OWNER_HANDOFF.md`.
The original fork remains unmodified and Personal Fleet OFF.
