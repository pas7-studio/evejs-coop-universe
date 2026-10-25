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
