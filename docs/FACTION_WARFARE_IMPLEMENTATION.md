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
