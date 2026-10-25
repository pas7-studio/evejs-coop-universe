# ALIFE-INTEGRATION-01 — reuse native NPC directors instead of rebuilding A-Life

Status: **P0 source integration, IMPLEMENTED_UNVERIFIED**. No Docker, game data, CI or production flags changed. Built on pinned EveJS and current coop overlay. Existing COOP-043 owns native market/industry authority; do not duplicate the GameStore/Rust adapter.

## Actual runtime findings and correction

The world already has ONE 30-second tick in coopVirtualWorldRuntime.cjs, genuine native NPC raid/tactics/ammo/loot/market drivers, a physical order bridge with an arbiter, a read-only native economy PERCEIVE/DECIDE observer, an in-game event board and a read-only probe log.

Concrete integration regression: enabling EVEJS_COOP_ALIFE=1 already implies alifeOrderArbitrationEnabled(), but **seven director guards** also required the old EVEJS_COOP_NPC_ORDER_ARBITER=1 variable. Personal goals, squad raids, ammo shortage handling, earned-ISK rearm, wreck recovery/custody and loot-station delivery therefore remained disconnected even when selecting the A-Life master authority. All seven now call the existing helper; each independent gameplay feature flag is still mandatory.

No new scheduler, native order, NPC, trade or asset was introduced.

## Planning versus real native settlement

An alife-economy-intent is NOT an authoritative transaction or reward. Existing runtime market and rearm directors already emit factual living-native-market-trade and living-npc-earned-rearm records. The read-only scripts/alife-audit.cjs --reconcile option correlates a previously planned intent with a later reported native outcome.

Strict matching requires:
- Exact named pilotID, positive physical entityID, solar system, and (for buying) native station.
- Event after intent inside a bounded time window (default 10 minutes).
- Settled buy outcome TRADE_SETTLED, positive cargo/type/quantity and matching nested buyReceipt, positive decimal market order ID, actual RPC acknowledgment, native cargo verified, NPC ledger only.
- Or a truly fitted NATIVE_NPC_CHARGE_LOADED outcome, positive cargo and module IDs, native module visible, no free ISK and no extra cargo created.
- Each real market order+cargo or fitted module+cargo receipt identity can be counted only once, even if the telemetry file replays records.
- Invalid or forged intent metadata, another NPC/station/system, attempted sell as buy, or merely bought-but-not-loaded ammo cannot satisfy the evidence gate.

Output statuses: NATIVE_OUTCOME_OBSERVED (separate director reported a matching native result; **not proof ALIFE dispatched it**), NO_AUTHORITATIVE_ACT_PROOF, INTENT_NOT_CONNECTED_TO_ACT, INVALID_INTENT_IDENTITY, NO_ALIFE_INTENTS_OBSERVED. Unsupported actions MINE, HAUL, DELIVER, REFINE, MANUFACTURE, COMPLETE_JOB and LIST_OUTPUT remain unproved, not silently successful.

Read-only command on a copied/sanitized events log:

    node scripts/alife-audit.cjs /path/to/coop-events.jsonl --reconcile

Never mints items, changes ISK, invokes market RPC, publishes native orders or reads player secrets. Existing summary and --timeline modes remain available.

## Tests and manual scenarios

- Focused source/arbiter cases in tests/coop-alife-order-authority.test.mjs.
- 13 new native proof and replay scenarios in tests/coop-alife-native-intent-reconciliation.test.mjs.
- Existing 22 local economic scenarios remain NOT_RUN in tests/scenarios/alife-native-economy-e2e.json.
- New 8 local integration scenarios remain NOT_RUN in tests/scenarios/alife-native-authority-integration.json, covering two-client events, competing native orders, ammo rearm, one-time purchase, mining-to-market, restart and crash faults.

Local tests (without Docker):

    pwsh -File scripts/Run-Alife-Economy-Tests.ps1

Or:

    node --test tests/coop-alife-order-authority.test.mjs tests/coop-alife-native-intent-reconciliation.test.mjs tests/coop-alife-integration-acceptance.test.mjs

**Evidence actually run:** existing runtime source parses with seven legacy-only guards removed; 18 focused order-authority and reconciliation cases passed in isolated V8. Full repository Node test runner, live Docker/real native GameStore and two-client gameplay have NOT been run here.

## Remaining ACT/SETTLE integration

1. COOP-043 provides a read-only authoritative native GameStore/Rust market/industry station snapshot. Current runtime still supplies readStationEconomy:()=>null, intentionally.
2. Route chosen A-Life intents through existing order owners and native GameStore/Rust transaction authorities. Never introduce another worker, scheduler, item origin or ISK ledger.
3. Add real settlement evidence for each currently unsupported stage with exact object IDs and before/after custody. Stop on ambiguous RPC and preserve replay fences.
4. Execute the 22+8 NOT_RUN scenarios in a disposable local world with two authorized clients. Collect native controllers, cargoID, itemID, jobID, orderID, wallet delta and reboot evidence. Only then claim A-Life E2E PASS.

**All relevant runtime flags stay OFF until explicit local acceptance.**
