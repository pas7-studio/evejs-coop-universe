# FW-001 — Faction Warfare authoritative state (first code slice)

Status: **source implemented, not deployed.** 21 isolated Node tests passed locally across FW-001/002 on the corresponding source. **Real EveJS SQLite / NPC / two-client gate not yet executed.**

## Delivered
- `integration/coopFactionWarCore.cjs`: pure fail-closed transitions for territory registration, declaration of war, supply-gated campaign, deployed assault, proven objectives, military-only occupation, verified ceasefire and per-character militia enlist/leave with cooldown.
- `integration/coopFactionWarStore.cjs`: native GameStore transactional boundary, one namespaced `corporationRuntime` record, source-event replay protection, default-OFF `EVEJS_COOP_FACTION_WAR=1` gate.
- `tests/coop-faction-war-core.test.mjs`, `tests/coop-faction-war-store.test.mjs`: negative proofs, state transitions, replay/conflict, disabled state and write failures.

## FW-002 native militia agent (source-level, NOT gameplay-verified)
New files: `coopFactionWarAgent.cjs`, `coopFactionWarNativeProofs.cjs`,
`scripts/coop-faction-war-agent-patch.cjs`. The existing stock
`agentMgrService.Handle_DoAction` and mission briefing are extended by
reversible one-call hooks. The militia handler runs before the existing
corporate convoy handler, but an actual native agent mission wins before both.

Only an authenticated, unique live character session docked at the
**actual SDE agent station** can receive the faction offer. The SDE
agent's corporation must resolve to a real faction with a real
`militiaCorporationID`. Only operator-allowlisted faction IDs are eligible.
Native faction standing >=0 is required for enlistment, not for resignation.
The request-local proof is checked again at the atomic transition.

Flags, all default OFF:
- `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1` (existing native SQLite safety gate)
- `EVEJS_COOP_FACTION_WAR=1` (domain state gate)
- `EVEJS_COOP_FACTION_MILITIA_AGENT=1` (stock agent dialogue)
- `EVEJS_COOP_MILITIA_FACTION_IDS=<comma-separated native SDE faction IDs>`
  (empty means no faction can recruit).

The native stock client action `Accept` enlists a character. On an
already active matching service desk the stock `Decline` action explicitly
ends militia service with a 24-hour cooldown. This is an MVP compromise
using stock button labels; richer leave UX requires pinned-client
verification. Neither action modifies the character's real corporation
membership, NPC ownership, inventory, standing or ISK.

`coopFactionWarNativeProofs` provides canonical native identity,
SDE territory ownership and bidirectional stargate checks. It refuses
supply, fleet deployment, objective, capture and ceasefire proof until
those subsystems exist. Real war declaration also requires an explicit
trusted operator-side `allowDeclaration` callback; no automatic
declaration from merely seeing two faction IDs.

**DO NOT enable these flags on the live server based only on source tests.**
The pinned AgentMgr/EVE client dialogue and real GameStore SQLite still
require local gameplay/transaction acceptance.

## FW-003 native warship ownership / order-lease policy (first slice)

**Implemented in source, NOT accepted for live combat:**
- `coopWarFleetRegistry.cjs` persists a 1:1 exclusive mapping between
  physical `entityID`, named `pilotID`, faction/corporation, campaign
  and fleet ID in the existing `corporationRuntime` native SQLite row.
  One event key commits only once; mismatching replays are blocked.
  Corrupt records stop operations; a missing physical ship does not
  silently remove its reservation.
- `coopWarFleetNativeProofs.cjs` validates original native NPC store,
  already-existing scene ship, controller, durable named identity,
  real SDE faction and the *same SQLite transaction's* active war and
  currently preparing or assaulted campaign. Initial registration
  requires the ship to be idle and not warping or fighting.
- Existing `coopNpcOrderArbiter` now recognizes non-preemptive `WAR`.
  `TACTICS` emergency orders may preempt it. `RAID`, `PATROL`,
  `GATE`, `CIVILIAN` and another `WAR` order cannot steal its lease.
- Existing `coopNpcOrderBridge` adds strict `warShipClaim` authority:
  `WAR` must be explicitly registered; other directors cannot retask
  a reserved warship even after a nominal order-lease expiry. Unknown
  registry state fences unsafe orders (TACTICS survives).
- Existing A-Life runtime creates the verified GameStore-backed registry
  only when explicitly enabled. Existing shared NPC order bridge uses the
  claim dynamically, so late flag changes cannot bypass native custody.
  No second scheduler and no synthetic NPC ships have been added.

**Additional opt-in flag:** `EVEJS_COOP_FACTION_WAR_FLEETS=1`, requiring
`EVEJS_COOP_FACTION_WAR=1`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`
and shared order arbitration `EVEJS_COOP_ALIFE=1` (or the
existing `EVEJS_COOP_NPC_ORDER_ARBITER=1`).

**Safety boundary:** this code does not declare wars by itself, consume
corporation ISK, spawn native ships, fire weapons, grant loot or move
NPCs between scenes. Direct battle commands and their native hostility
permission are deliberately **not** connected before combat objective
proof, verified enemy ownership, ammo debit and AI life-safety guards
are tested. The WAR owner is a fenced authority ready for that next step.

**Validation still required:** local real SQLite with its FULL
synchronous/restore/cache invalidation contract; 2-player EVE session;
reversible overlay and installed `.js` module load; 30s tick performance,
especially repeated GameStore reads on large fleets; physical NPC
combat evidence and restart with an already leased fleet.

## FW-003B native faction battle pass (opt-in, source code)

This phase **connects actual native attack orders to the original 30s A-Life
scheduler**. It does not create ships, damage, kills, fake loot, earned money,
automatic war declarations, stargate travel or territory conquest.

Code:
- `coopWarCombatPolicy.cjs`: both entities MUST be current physically real
  native NPC ships, with exact real SDE corporation-to-faction mapping,
  native controllers and durable war-fleet assignment. Both must be on
  opposite sides of ONE active war, in ONE `ASSAULT` campaign, inside its
  physical target system. Friendly/allied/unregistered/player ship attacks
  are forbidden. Native damage permission also requires an exact
  explicit `manualOrder.type=attack` against the same enemy.
- `coopWarCombatAuthority.cjs`: reads existing native GameStore cache
  **without creating an SQLite write transaction per weapon hit**, verifies
  native NPC records and active war/fleet states, and fails closed if
  a ceasefire, corruption, mismatched SDE, missing hostile order or missing
  strict-ammo flags invalidates the pair.
- `coopWarBattleDirector.cjs`: bounded to two orders per 30-second pass,
  same already-loaded scene, <=250km real physical separation, ordered
  deterministically and cooldown per ship; no attack when either NPC is
  warping, the controller is already engaged in unrelated PvE/player
  combat, or ammo-survival/tactical retreat is active. The existing
  `coopNpcOrderBridge.issue({owner:"WAR",action:"attack"})` serializes
  true `npcRuntime.issueAttackOrder`. **ACK is not evidence of a hit.**
- `coopNpcHostility.cjs` native NPC-vs-NPC gate now prioritizes
  active Faction Warfare over previous virtual faction rivalry;
  even if `EVEJS_COOP_RIVAL_NPC_COMBAT=1`, the registered warship cannot
  bypass an ended war, neutral target, mismatched faction or missing
  attack proof through a legacy virtual tag. The original pinned
  `npcBehaviorLoop` overlay hook now accepts independent war-combat opt-in.
- `coopNpcWeaponAmmoGate.cjs` disables **synthetic hull weapon** free-fire
  fallback for registered warships. Existing native fitted weapon ammo
  bank/debit/outcome mechanisms still own all actual damage/charge cycles.
- Hot-path warship claims in `coopWarFleetRegistry.cjs` now read the
  GameStore cache, not a fresh `BEGIN IMMEDIATE` on every NPC order.
  Corrupt/unavailable cache does not automatically free its ships.
- `coopWarFleetNativeProofs.cjs` can now register physical defenders in
  their actual target system, not only the attacker fleet.

All of the following must be **explicitly enabled**:
`EVEJS_COOP_FACTION_WAR=1`,
`EVEJS_COOP_FACTION_WAR_FLEETS=1`,
`EVEJS_COOP_FACTION_WAR_COMBAT=1`,
`EVEJS_COOP_ALIFE=1` (or `EVEJS_COOP_NPC_ORDER_ARBITER=1`),
`EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`,
`EVEJS_COOP_NPC_STRICT_AMMO=1`,
`EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE=1`,
`EVEJS_COOP_NPC_BANK_ATOMIC=1`,
`EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS=1`.

**No installed native campaign source exists yet:** live combat requires
an already-existing, valid war/assault plus two truly physical,
explicitly assigned opposing fleets. There is NO fallback to virtual
reinforcements or phantom supply. Next prerequisite is a trusted
native mobilization/supply producer and safe fleet route handoff.

**Not certified:** live SQLite data migration, pinned overlay roundtrip,
native client 2-player PvE coexistence, physical weapon/ammo firing under
the new hostility gate, crash recovery while war order lease is issuing,
and real stargate transport. Run all in local test environment before
enabling any combat flag. A war battle accepted order remains
`NATIVE_ATTACK_ORDER_ACCEPTED`, never a kill/capture result.

## FW-003C finite native war-patrol mobilization (source only)

The original 30-second living-world tick now calls `advanceNativeWarMobilization`
**before** native war combat; it creates no extra timer or background world.

- `coopWarMobilizer.cjs` scans at most 16 active PREPARING/ASSAULT campaigns
  and at most 512 uniquely linked **already materialized** patrol NPCs in
  visited, already-loaded scenes. It never recruits pirates, traders,
  miners, haulers, players, unlinked NPCs or duplicated pilots.
- Real native `corporationID → factionID` determines the side. In PREPARING,
  defenders muster in the target system, attackers in their verified source
  system. An ASSAULT attacking ship must **physically exist in the target
  system** before it can be recruited there. No virtual faction tags or
  fabricated teleports.
- `coopWarMusterReadiness.cjs` inspects actual native NPC module/cargo rows:
  at least one **real fitted online compatible weapon with loaded charges**,
  or a native charge-optional turret. Pure synthetic hull guns do not qualify,
  and no cargo is minted or debited by recruitment.
- Native patrol must be stationary/not warping, idle, not owned by an
  existing active/uncertain Arbiter lease, not in tactical retreat and
  not player-controlled. Native store record, live physical scene,
  controller, durable identity and corporation all must agree.
- The existing `coopWarFleetRegistry.execute(ASSIGN)` performs actual
  native SQLite atomic reservation with a same-transaction active campaign
  proof. In-process snapshot and processed event ledger prevent duplicate
  claim and survive restart. A failed or uncertain native transaction
  never produces a successful mobilization notification.
- Hard limits: 2 new ship assignments per tick, 2 per campaign/faction side
  (defaults), no extra patrol spawn or free wallet/industry inventory.

**New default-off flag:** `EVEJS_COOP_FACTION_WAR_MOBILIZE=1`, requiring
`EVEJS_COOP_FACTION_WAR=1`, `EVEJS_COOP_FACTION_WAR_FLEETS=1`,
`EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`, native ammo safety flags
`EVEJS_COOP_NPC_STRICT_AMMO=1`,
`EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE=1`,
`EVEJS_COOP_NPC_BANK_ATOMIC=1`, and existing single tick enabled by
`EVEJS_COOP_ALIFE=1` or `EVEJS_COOP_NPC_ORDER_ARBITER=1`;
also requires `EVEJS_COOP_VIRTUAL_WORLD=1` for the current runtime.

**Scope boundary:** this does NOT initiate a new war or manufacture a supply
reservation. The FW-001 `START_CAMPAIGN` operation still requires trusted
native proof of reciprocal stargate adjacency and finite supply;
an operator-supplied mock proof is NOT suitable for real deployment.
Attackers do not automatically jump: native military travel/relocation
is a separate FW-007 acceptance gate.

**Local tests for agent QA:**
`node --test tests/coop-war-muster-readiness.test.mjs
tests/coop-war-mobilization.test.mjs
tests/coop-war-fleet-native-proofs.test.mjs
tests/coop-war-fleet-registry.test.mjs`.
Then pinned overlay --check/roundtrip, SQLite FULL synchronous restart,
combat ammo/Rust and 2-client physical battle verification. Keep OFF until
all these pass; no main merge or production enablement is implied.

## FW-005A — native corporation military treasury (source-only)

This stage introduces `coopWarTreasury.cjs` and
`coopWarTreasuryNative.cjs`, a real NPC-corporation ISK reservation
and refund ledger. It is a **budget funding primitive**, NOT yet the
complete military supply flow.

### Native transactions

- Uses the **existing** `gameStore.coopAtomicNativeRows.transact(["corporationRuntime"])`,
  which enforces SQLite `BEGIN IMMEDIATE`, `synchronous=FULL` and
  subsequent native GameStore cache reconciliation.
- Looks up the exact native corporation row
  `corporations\\u001f<corporationID>`, its real wallet division `1000`
  (not a virtual corporation balance), and the authoritative war state
  in the same SQLite transaction.
- Requires a real NPC corporation (`corporationState.getCorporationRecord`
  with `isNPC === true`) mapped by the canonical native SDE faction table
  to the active war's attacker faction. A player corporation cannot be used.
- `RESERVE` subtracts an exact positive amount in integer **cents** from
  the spendable NPC-corporation wallet, enforces a caller-defined minimum
  remaining wallet reserve, creates an escrow claim under the
  `coop-faction-war\\u001ftreasury-v1` row and appends a matching internal
  debit journal/transaction record. Both changes commit atomically.
- `REFUND` can only restore the exact originally held cents when the
  native war is ended or the campaign is cancelled, **AND** a trusted
  injected server-side `authorizeRefund` returns true. The default native
  adapter denies refunds. Both ledger and native wallet are updated once.
- Stable event IDs and complete command signatures reject conflicting
  replays. An uncertain SQLite commit throws; callers must **re-read the
  committed receipt**, never retry with a new event ID as if no charge
  happened.
- Hard caps: 500 reservations, 2,000 processed event IDs and a bounded
  native-wallet journal, with no automatic expiration or arbitrary refund.

### Flags and constraints

The new gate `EVEJS_COOP_WAR_TREASURY=1` requires both
`EVEJS_COOP_FACTION_WAR=1` and
`EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`; **all default OFF**.
There is no public client/UI endpoint, automatic spending loop or API
that creates these reservations without a trusted server caller.

**This is not native military supply yet.** The escrow claim represents
real withheld ISK but does not prove any ammunition, fitted ship, fuel,
mineral, manufacturing job, market settlement or physical delivery.
It must NOT be accepted as the sole `START_CAMPAIGN.supply` proof. For
the latter, additionally implement a native item/cargo custody proof and
atomic, one-time allocation to the actual war fleet. Campaign logistics
and real stargate military transfers remain separate.

**Acceptance before any enablement:** run
`node --test tests/coop-war-treasury.test.mjs
tests/coop-war-treasury-native.test.mjs`, then original pinned
GameStore/SQLite FULL durability, native corp-wallet UI/journal entry
compatibility, crash/commit-unknown replay, and restart reconciliation.
The internal wallet journal currently uses `entryTypeID: 0`; validate
the pinned client's display behavior before enabling in-game. The
existing `evejs-data` volume must remain untouched.

## FW-007A — war fleet movement to real stargates, NOT intersystem travel

The new `coopWarGateStaging.cjs` reuses **`coopNpcGateTravel`** for
physical NPC warship navigation. No new scheduler, warp simulator,
virtual `systemID` assignment, fake gate or newly created ship.

- Starts only for an already-authorized `PREPARING` campaign whose
  origin system is physically loaded and visited. Attackers must have
  existing native warship custody records in the source system.
- Requires the campaign's `supplyReservationID` to correspond to the
  real `HELD` NPC-corporation treasury claim from FW-005A.
  The real `START_CAMPAIGN` must already have passed its own independent
  native route AND physical item supply proofs. Treasury escrow alone
  is **NOT** permission to start the campaign.
- `connectedGates()` verifies two real reciprocal EveJS gate entities
  and their original SDE destination references.
- Uses the same `WAR` NPC Order Arbiter and actual
  `npcRuntime.warpToEntity` with its native warp start/broadcast,
  rather than moving coordinates or skipping space.
- Only one confirmed native warp order per tick by default; tactical
  retreat and ammo resupply activity take precedence. In-flight native
  warp and unrelated manual commands remain blocked by the shared bridge.
- An observed ship within the original EveJS 2.5 km **surface**
  activation range of the real gate is recorded as
  `AWAITING_NATIVE_WAR_FLEET_TRANSFER`. It does **not** transfer.
  The old `entityID`, `systemID`, pilot link, cargo and modules
  must remain unchanged until a separate native transfer adapter can
  update the identity and war registry with crash-safe reconciliation.
- The original `coopNativeGateTransfer` supports non-war ships but
  has an independent recovery journal; it must NOT be attached to
  these military hulls without a new two-registry handoff protocol.

**Additional default-off flag:**
`EVEJS_COOP_FACTION_WAR_GATE_APPROACH=1` requires
`EVEJS_COOP_FACTION_WAR=1`, `EVEJS_COOP_FACTION_WAR_FLEETS=1`,
`EVEJS_COOP_WAR_TREASURY=1`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`,
and `EVEJS_COOP_ALIFE=1` (or legacy arbiter). The hosting
`coopVirtualWorldRuntime` also requires `EVEJS_COOP_VIRTUAL_WORLD=1`.

**Validation:** `node --test tests/coop-war-gate-staging.test.mjs`,
full original pinned overlay dry-run and reversibility,
native stargate geometry/warp arrival on two physical NPCs,
a simultaneous player warp and combat conflict, restart with a
staged ship, and a database crash during pending warp. No real
cross-system movement is accepted for FW-007A yet.

## FW-007B — physical military gate transfer with durable quarantine

**Experimental, opt-in.** This slice integrates the existing pinned
`coopNativeGateTransfer` physical EveJS ship dematerialize/materialize
with military custody. The world, native NPC entity/controller data,
`coopIdentityRegistry` JSON file and `coopWarFleetRegistry` SQL row
are **different durability authorities**, not one ACID transaction.
The implementation uses a proof-backed, fail-closed handoff saga.
Do not describe it as cross-store atomic.

- `coopWarTransferLedger.cjs` records `PREPARED` in the same native
  SQLite `corporationRuntime` fleet row **before** the first native scene
  movement. It verifies original physical ship, unique pilot link, native
  controller, exact campaign, active attacker war and real held ISK budget.
  Loaded native module/cargo rows are hashed for identity/quantity drift.
- The original `coopNativeGateTransfer` verifies reciprocal stargates
  and true 2.5 km jump-range proximity, then performs actual native
  dematerialization and rematerialization with unchanged `entityID`,
  fitted modules and cargo; it keeps its **separate fsynced intent
  journal**. It has not been replaced with a virtual system relocation.
- The injected `registry.relocate()` facade first verifies destination
  native scene and module/cargo fingerprints, commits the fleet row and
  marks `NATIVE_COMMITTED` in native SQL. Then the original
  `coopIdentityRegistry.relocate` durably fsyncs the JSON pilot link.
  Finally `FINISH` verifies all authorities and marks `COMPLETE`.
- A genuine native rollback may mark `ABORTED` only after a physical
  source, original cargo fingerprints and source pilot identity are
  positively verified. An uncertain result leaves the ship's transfer
  unresolved and prevents automatic replay or reassignment.
- The native NPC Order Arbiter blocks normal war/other orders while
  a transfer is `PREPARED` or `NATIVE_COMMITTED`. Native gate
  staging uses `WAR` order ownership and only reports
  `VERIFIED_NATIVE_GATE_TRANSFER` after the exact native transfer
  and durable authorities have all acknowledged.
- Both native transfer journals and the NPC identity JSON file now
  fsync the temp file and containing directory; unexpected temporary
  files are considered recovery blockers, not a clean boot.
- The startup handoff audit runs BEFORE identity pruning/materialization.
  It refuses incomplete SQL transfers, mismatched completed native
  entity/controller/cargo/pilot records and orphan low-level journal
  files. **No automatic speculative recovery** is attempted before
  physical scenes are known to be restored.

**Additional opt-in flag:** `EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER=1`,
requiring `EVEJS_COOP_FACTION_WAR_GATE_APPROACH=1`,
`EVEJS_COOP_FACTION_WAR=1`,
`EVEJS_COOP_FACTION_WAR_FLEETS=1`,
`EVEJS_COOP_WAR_TREASURY=1`,
`EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`,
`EVEJS_COOP_DURABLE_NPC_SHIPS=1`,
`EVEJS_COOP_NATIVE_GATE_APPROACH=1`,
`EVEJS_COOP_NATIVE_GATE_TRANSFER=1`, plus existing A-Life/Order
Arbiter and virtual-world runtime opt-ins. All default OFF.
Dedicated native journal directory:
`EVEJS_COOP_WAR_TRANSFER_JOURNAL_DIR` (default
`/var/lib/evejs/coop-war-native-transfers`); preserve this volume
between restarts.

**Hard limitations requiring independent local validation:** physical
native scene transfer and SQLite/JSON cannot commit in one transaction.
An operator recovery tool/UI to resolve ambiguous native transitions
is **not yet provided**, so an ambiguous restart intentionally blocks
the wartime handoff and may require manual repair. Persisted wrecked
hulls after combat also require explicit war-fleet release before
unrestricted startup auditing. Native transfer requires real durable
ship provisioning, real SDE reciprocal gate, original cargo/fitting
identity and a still-open approved war campaign. No new ships,
station supplies, fabricated inventory, kill credit or conquest.

**QA for future agents:** `node --test
tests/coop-war-transfer-ledger.test.mjs
tests/coop-war-gate-handoff.test.mjs
tests/coop-war-gate-staging.test.mjs
tests/coop-war-fleet-registry.test.mjs`, then pinned overlay
install/uninstall, SQLite `synchronous=FULL` fault injection before
and after native materialization, file fsync/restart and
2-client cross-system observation of one intact NPC hull. Test
separately all intermediate crash points: PREPARED, source
dematerialized, destination entity written, destination materialized,
native SQL moved, JSON identity moved, COMPLETE, and cleanup.
No claim of successful live testing until these gates pass.

## FW-007C — guarded recovery for partially moved real warships

FW-007B deliberately quarantines a ship after an ambiguous three-owner
handoff. FW-007C provides a **local-only** privileged repair surface:
`coopWarTransferLedger.witness`,
`coopWarRecoveryConsole`, `coopWarRecoverySocket`, and
`scripts/coop-war-recovery-cli.cjs`. Nothing is attached to a player
EveJS RPC, chat command, website or public HTTP port.

### Independent native evidence and permitted steps

A trusted server operator must first `review` an entity. A read-only
witness requires BOTH physically loaded scenes, exactly ONE real native
ship, its canonical native controller and corporation, one unique
persistent pilot link, and the original module/cargo ID+quantity hashes.
Missing scenes, missing/doubled hulls, stale owners, lost items and
contradictory native records are **UNSAFE / manual repair only**.
An action is derived from the observed phase; clients cannot choose
another system, owner, quantity, faction, fleet or pilot.

| SQL phase | Real physical hull | Pilot JSON | One permitted action |
| --- | --- | --- | --- |
| PREPARED | source | source | ABORT |
| PREPARED | destination | source | NATIVE_COMMIT |
| NATIVE_COMMITTED | destination | source | RELOCATE_PILOT |
| NATIVE_COMMITTED | destination | destination | FINISH |
| NATIVE_COMMITTED | source | source | RESTORE |
| COMPLETE | destination | destination | CLEANUP_JOURNAL (if present) |
| ABORTED | source | source | CLEANUP_JOURNAL (if present) |

A successful step **does not automatically execute the next one**.
After every step, the operator must review again and provide the new
SHA-256 witness token. The service re-reads the sources immediately
before any action; a stale token always fails. Every authorized
mutation first records an attempt with the privileged principal,
witness, action, operator's reason and timestamp in the existing native
SQLite fleet row (`recoveryAudit`). This is an audit of the **attempt**,
not evidence that it succeeded if a crash happened later.

A matching, completed native journal is moved into a sibling
`<journalDir>.recovered` archive with directory fsync; it is never
silently discarded. Unknown files, symlinks, excessive sizes and
orphan temporary files block recovery. The original low-level native
journal is NEVER automatically replayed while scenes are only partly
restored.

### Local operator channel (Linux server / Docker container)

Enable explicitly and **only after local testing**:
`EVEJS_COOP_WAR_RECOVERY_ADMIN=1` and
`EVEJS_COOP_WAR_RECOVERY_SOCKET=1`. Requires all FW-007B gates as
well. Default socket:
`/run/evejs/coop-war-recovery.sock`.
Default credential path:
`/run/secrets/evejs-war-recovery-key`.

The credential file must contain a strong **32+ character random
base64/URL-safe secret**, owned by the server process and mode `0600`;
the socket directory must be owned by that process and mode `0700`.
Mount a Docker secret or pre-provision the file with your deployment
secrets manager; do not commit it. The server checks the secret in
constant time and never trusts a caller-supplied operator field.
The local audit principal is `local-war-operator`; individual human
attribution must additionally come from the host's Docker/SSH audit
logs. Stale socket inode after an unclean shutdown requires operator
inspection before manual cleanup; the service will not remove an
unexpected existing socket.

From a privileged shell inside the Linux container, using the overlay
repository's scripts:

```bash
node scripts/coop-war-recovery-cli.cjs review 501
node scripts/coop-war-recovery-cli.cjs apply 501 NATIVE_COMMIT <64-hex-witness-from-review> "Confirmed native hull, controller, fittings and cargo"
node scripts/coop-war-recovery-cli.cjs review 501
```

Never expose the socket to remote clients. These steps cannot move a
missing ship, conjure inventory or resolve an unverified physical
transit automatically.

### Not yet acceptance-certified

FW-007C adds guarded administrative operations but **does not** make
the underlying native scene, SQLite and JSON stores ACID. After
hard crashes some states still require offline operator recovery.
The current fleet registry retains the most recent transfer per ship:
multi-hop route cycling requires a further safe cleanup/rotation
protocol before a second trip can begin. Avoid enabling multi-hop
military AI on this PR alone.

New source suites:
`node --test tests/coop-war-recovery-console.test.mjs
tests/coop-war-recovery-socket.test.mjs
tests/coop-war-transfer-ledger.test.mjs
tests/coop-war-gate-handoff.test.mjs`.
Also validate the real pinned overlay install/rollback, SQLite FULL
sync, actual Docker socket permissions, SIGKILL after **each** native
handoff phase, native ammo and cargo conservation, and two-client
observation before any production enablement. All flags default OFF.

## Security and native authority
This core **never mutates** NPC ships, native station or SDE ownerID, standings, corp membership, wallets, items or combat. `militaryControllerFactionID` is only an independent military-control field, NOT native station sovereignty, docking permission or client political map.

Every state mutation requires a trusted server-side proof callback from the caller, independently verifying original native records. Test callbacks like `()=>true` are strictly forbidden in deployment. Client-supplied proof IDs, kill counts, attack orders and faction tags never by themselves authorize capture. Without a callback the write is blocked. `START_CAMPAIGN` requires both reciprocal route and native supply reservation; `CAPTURE_TERRITORY` requires an independent capture verdict from a real objective bridge.

A single `GameStore.transact` call applies a transition. If it throws, the store does not acknowledge the operation. The immutable deduplication ledger has a 10,000-event cap which fails closed and must receive a planned migration; 500 recent events are diagnostic history only.

**Current scope limitation:** this is a domain foundation, not a live military gameplay mode. No native proof provider, character agent interaction, fleet issuance, resource debit, tick scheduler or station ownership update is installed yet.

## Next implementation slices
1. **FW-002:** native faction/system proofs and verified in-game militia enlistment via actual agent sessions.
2. **FW-003:** WAR controller through existing A-Life order arbiter, persistent native fleet membership, verified stargate travel and survival priorities.
3. **FW-004:** native war-operation objectives, per-character contribution evidence, wallet-safe escrow and exactly-once payout.
4. **FW-005:** real military inventory + supply reservations, NPC manufacturing / replacement integrity.
5. **FW-006:** military siege and CAS territorial settlement, hard native objective proofs (no fictitious sovereignty).
6. **FW-007:** cross-system campaign / crash-safe transfer and materialization handoff.
7. **FW-008:** resource-conserving offline simulation which never invents native killmail or loot.
8. **FW-009:** treaties, faction chronicle, agent notifications and client visibility.

## Release gates
- `node --test tests/coop-faction-war-*.test.mjs`
- Real local SQLite GameStore transaction test and injected restart/crash cases.
- Read `docs/DEVELOPMENT_DOCTRINE.md` and `docs/GAMEPLAY_TESTING.md`.
- Reversible pinned overlay `--dry-run`, roundtrip and `--check` **if/when native hooks are introduced**.
- Test actual physical NPC engagements and two game clients separately from unit tests.
- No GitHub Actions, no deployment without approval, no `evejs-data` reset or rewriting historical faction state. Feature remains OFF by default.
