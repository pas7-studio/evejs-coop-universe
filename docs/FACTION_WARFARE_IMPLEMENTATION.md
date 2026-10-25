# FW-001 — Faction Warfare authoritative state (first code slice)

Status: **source implemented, not deployed.** 10 isolated Node tests passed locally on the corresponding source. **Real EveJS SQLite / NPC / two-client gate not yet executed.**

## Delivered
- `integration/coopFactionWarCore.cjs`: pure fail-closed transitions for territory registration, declaration of war, supply-gated campaign, deployed assault, proven objectives, military-only occupation, verified ceasefire and per-character militia enlist/leave with cooldown.
- `integration/coopFactionWarStore.cjs`: native GameStore transactional boundary, one namespaced `corporationRuntime` record, source-event replay protection, default-OFF `EVEJS_COOP_FACTION_WAR=1` gate.
- `tests/coop-faction-war-core.test.mjs`, `tests/coop-faction-war-store.test.mjs`: negative proofs, state transitions, replay/conflict, disabled state and write failures.

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
