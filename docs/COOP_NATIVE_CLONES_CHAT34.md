# Chat 34 — Native medical clones, jump clones, implants, boosters and pod death

**Status: CODE_READY / LIVE_UNVERIFIED / NOT_WIRED.** Pinned upstream:
`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

This is a staged, default-OFF safeguard implementation. It adds no fabricated
clones, SKILL points, inventory items, wallets, boosters, ships or effects and
does not modify the shared installer, deployed native server, production
persistent tables, client asset or existing world. **Publishing these files
is not gameplay acceptance and does not automatically enable a mechanic.**

## Native functionality audited

| Native subsystem | Real pinned source | Behavior and risk |
| --- | --- | --- |
| Medical/home station | `services/character/homeStationService.js` | Valid station candidates and school/corporation office/current station, explicit remote-change confirmation, **365-day remote cooldown**, persisted `homeStationID` and `cloneStationID` |
| Jump clones | `services/station/jumpCloneRuntime.js`, `jumpCloneService.js`, `jumpCloneRules.js` | Installed jump clone IDs/locations/implants, jump action, same-station swaps, skill-based limit, **24 hours minus Infomorph Synchronizing skill level**, installations/activation charges, structure ACL/service checks |
| Ship clone bay | `jumpCloneRuntime.js:1300–1424` and `space/transitions.js:3658+` | Online fitted Clone Vat Bay I, genuine target ship/distance/offer, ship clone, space arrival; runtime's installation offers are process-local and not restart durable |
| Implants | `dogma/implants/implantRuntime.js:228–358`, `activeImplantModifiers.js` | Inventory owner/location, unique slot, skills, consume item, write character implants, dogma brain effects; consumption and character-state write are not one atomic transaction |
| Boosters | `skills/boosters/boosterRuntime.js:403–543` | Owner/location, expiration, age, duration, slot, side effects; item consumption precedes booster state write |
| Pod death | `jumpCloneRuntime.js:1448–1503`, `space/transitions.js` | Destructible active implants lost, explicitly non-destructible implants can survive, stored jump-clone data remains; home-station respawn uses native capsule/ship transition |
| Inventory & persistence | `character/characterState.js` and `inventory/itemStore.js` | Per-character durable records, real active ship/capsule and item locations, independent account ownership |

**Critical native problem:** `jumpCloneRuntime.performCloneJump` calls
`transitions.jumpSessionToStation` and the latter calls
`dockShipToStation(activeShip.itemID,...)`. If the active ship is a fitted
noncapsule, native station travel can relocate that actual ship with the
pilot, violating "previous ship remains at source." Therefore the
Chat 34 preflight **rejects noncapsule clone jumps** until a native
capsule-switch/park flow is verified. It does not silently transport a
ship, discard its fitting, or create a substitute capsule.

**Critical security problem:** stock jumpCloneService exports
`Handle_ResetLastCloneJumpTime`, and stock homeStationService exposes
`Handle_reset_remote_change_time`. A normal client must not be able
to invoke either time reset. The guard supplies `privilegedReset` and
denies it absent a verified server-side admin entitlement. The shared
native service RPC hooks must enforce this, not merely hide UI buttons.

**Native multi-write problem:** install clone writes clone before wallet
charge; clone jump transitions ship before clone records/ISK update; implant
and booster consumption precedes state write. Crash/exception boundaries can
leave partial results. The new persistent fence avoids *automatic replay*
of an ambiguous native action but does **not** make cross-table writes atomic.

## New code

### `integration/coopCloneNativeGuard.cjs`

`createCloneGuard` takes injected **trusted native callbacks**:
`getSessions`, `getCharacterRecord`, `getActiveShip`,
`getInventoryItem`, `getStationByID`, `getStructureByID`,
`canDockAtStructure`, `hasCloneService`,
`getCharacterCloneLimit`, `getCloneCooldownHours`,
`getWalletBalance`, `getImplantTypeInfo`,
`validateImplantItem`, `getBoosterTypeInfo`,
`validateBoosterItem`, `getOwnedShipsAtLocation`,
`getHomeStationCandidateIDs`, `getNativeSchoolHQStationID`,
`getCloneInstallationFee`, `getCloneActivationFee`,
`verifyDeathEvent`, `isAuthorizedAdmin`, `isCapsuleShip` and
`nowFiletime`.

These must be wired from **the pinned native authoritative services**.
In particular, `getHomeStationCandidateIDs` must use the same
`collectHomeStationCandidates` policy as `homeStationService`, not
client-supplied IDs; `getNativeSchoolHQStationID` must use native
school profile, not request fields; `getCloneInstallationFee` and
`getCloneActivationFee` must use real native pricing. Admin/death
authority callbacks must be server-trusted, never permissive defaults.

- `actor(session)`: one connected native session, persisted account and
  character identity, persisted active ship ownership, unique clone IDs,
  globally unique implant itemIDs and one implant per clone slot.
- `installClone(session,{cost})`: real docked station/structure,
  clone service access, skill limit, location uniqueness, exact native
  fee and funded wallet; does not mint the clone.
- `jump(session,{cloneID,destLocationID,confirmed})`: exact owned
  persisted clone, native station/structure and ACL, FILETIME/skill
  cooldown, explicit structure/replacement confirmation, native capsule
  type, fee and a snapshot of separately owned parked ships.
  **Ship VAT target jumps** return
  `SHIP_VAT_TARGET_REQUIRES_NATIVE_BAY_ATTESTATION` until the live
  bay/distance/online/service authority integration is built.
- `homeStation(session,{stationID,allowRemote})`: native station
  candidate, own current home, remote permission and persisted 365-day
  cooldown. A source-supplied school-HQ bypass is impossible.
- `consume(session,{kind:"IMPLANT"|"BOOSTER",itemID})`: own native
  inventory, native type/skill/expiration/slot validation and no duplicate
  installed implant itemID.
- `podDeath(session,{deathEventID})`: event must be unique, verified
  by server-native death authority and tied to the actual capsule/owner.
- `privilegedReset(session,{kind})`: only verified native admin can
  reset `CLONE_COOLDOWN_RESET` or `REMOTE_HOME_COOLDOWN_RESET`;
  never authorize based on client-side role fields.

The module returns read-only preflight proofs; it does not bypass
stock validation, skill checks or native RPC return values.

### `integration/coopCloneNativeReceipts.cjs`

`createCloneReceipts` takes trusted native record/ship/item/wallet reads,
actual dogma active implant effects, actual active boosters, owned ship
inventory and native clock. `capture(proof)` records before state.
`check({proof,before,nativeResult})` compares true native post-state:
- paid clone installation makes exactly one new owned clone;
- destination capsule arrival uses the original capsule itemID,
  stored target consumed/replaced per jump rules, cooldown updates,
  target implants restored with actual dogma effects, and **each parked
  source ship remains at the source with the same owner and flag**;
- implant/booster inventory item stack is reduced by exactly one,
  native character record is updated and dogma/booster runtime reflects
  it, rather than merely a success RPC return;
- home station updates both persisted station IDs and verifies the
  native next-remote-change FILETIME around 365 days ahead;
- pod death destroys eligible implants, retains installed jump clones,
  and leaves the character at native home station.

The verifier is deliberately conservative: legacy implants without
unambiguous itemID/slot, an unverified dogma projection, impossible
ship location, or concurrent item changes may be rejected for operator
reconciliation rather than risk duplication.

### `integration/coopCloneActionFence.cjs`

`createCloneActionFence({file})` accepts a persistent absolute JSONL path,
such as `/var/lib/evejs/coop-native-clone-actions.jsonl`.
The single-writer lock, append-only `PREPARED → SETTLED | UNKNOWN` state
machine and `fsync` happen before each trusted native action.
`execute({proof,captureNative,nativeExecute,verifyNative})` invokes
exactly one native action after durable reservation. A crash, torn
journal, stale lock, failed readback or uncertain native result **blocks
all replay** for that key pending manual reconciliation; the implementation
never deletes a stale lock to "fix" the state.

Operation keys isolate different characters and action types:
- installation keyed by character, location, existing clone IDs;
- jump by character, source/destination, clone ID, previous last-jump;
- implant/booster by character and consumed inventory itemID;
- home change by character and previous/new station;
- death by character and verified unique native death-event ID.

The journal must be on a backed-up persistent volume. This cannot
guarantee no **lost** actions under mid-write crashes; a native
single-transaction GameStore refactor is required for automatic exactly
once completion instead of safety quarantine.

## Integration contract (Chat 01 / shared installer owner)

Do **not** alter existing central `scripts/patch-evejs-coop.cjs` in this
chat. Register the modules only after Chat 01 reviews and integrates
default-OFF hooks guarded by
`EVEJS_COOP_NATIVE_CLONE_SAFETY=1`. Required RPC boundaries:

1. `jumpCloneService.Handle_InstallCloneInStation` and
   `Handle_InstallCloneInStructure` (native fee + installation receipt).
2. `jumpCloneService.Handle_CloneJump` (before transition; per-character
   FILETIME, destination ACL and parked-ship check).
3. `jumpCloneService.Handle_ResetLastCloneJumpTime` (**must deny
   normal player requests**); `homeStationService.Handle_reset_remote_change_time`
   (**must deny normal player requests**).
4. `homeStationService.Handle_set_home_station` (native candidates +
   remote 365-day cooldown).
5. `implantRuntime.installImplantItem`, `boosterRuntime.useBoosterItem`
   (before first inventory consume and after dogma sync/readback).
6. Native pod death event before `clearActiveImplantsForPodDeath` and
   respawn transition. Use verified unique death event ID; confirm
   active destructible implant loss and stored clone survival.

The stock `jumpCloneService` client flow, callbacks and user errors must
remain intact; one native operation per reservation. Do not duplicate
native response, invent a client popup or override default ship ownership.
For a safe fitted-ship clone jump, Chat 01/Chat 06 must implement an
explicit native **leave fitted ship docked → activate existing capsule →
transition capsule**, with read-back before permitting a previously
blocked noncapsule jump. Ship VAT activation and offer persistence require
an independently verified native bay/space authority path.

## Tests and acceptance

Committed tests:
- `tests/coop-clone-native-guard.test.mjs` — 15 scenarios;
- `tests/coop-clone-native-receipts.test.mjs` — 10 scenarios;
- `tests/coop-clone-action-fence.test.mjs` — 10 scenarios;
- `tests/coop-clone-coop-cycle.test.mjs` — 1 two-character integration
  fixture (one pilot jumps capsule while fitted ship remains docked,
  second installs implant and loses it to verified pod death).

**36/36 isolated JS regressions passed** in an in-memory V8 harness on
the exact committed module/test blobs. Not an official Node+EveJS test,
not a Docker run and not two real clients.

For actual verification, on a disposable owner-approved EveJS deployment:
```sh
node --test tests/coop-clone-*.test.mjs
node scripts/patch-evejs-coop.cjs --code-path "$EVEJS_COOP_CODE_PATH" --dry-run
node scripts/patch-evejs-coop.cjs --code-path "$EVEJS_COOP_CODE_PATH" --check
```
Use two real independent accounts. Validate native home station candidates,
clone limit by trained skill, distinct personal clone and implant IDs, BPO/
cargo preservation on prior fitted ship, paid clone installation,
native implant & booster inventory removal and actual dogma effects,
cooldown with/without skill, same-station swap, structure docking/service
refusal, real capsule jump and arrival, reconnect after every step,
pod death with non-destructible exception, home respawn and world restart.
Inject process crashes after each native inventory/wallet/character write;
check persisted account wallet, capsule item IDs, ship fitted module IDs,
parked ship location, clone locations, current dogma, active boosters,
timers and journal. Do not enable ship VAT or bypass clone skill limits
unless their native source and UI are separately accepted.

**No claim of full gameplay completion is made here.** Code and tests
can be pushed now without hooking gameplay. Chat 01 integration and live
two-client acceptance remain mandatory.
