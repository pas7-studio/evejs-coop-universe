# Chat 24 + 31 — Stage D2: Native NPC Mining Hiring through the stock Agent

**Status: SOURCE IMPLEMENTED / LIVE NOT VERIFIED.** Added to Draft PR #287 on October 26, 2026. All native economy and hiring flags remain OFF by default.

## In-game hiring flow

1. A pilot opens an **actual EveJS SDE station NPC Agent**, in the corporation and system where an original startup mining fleet physically exists. Paid convoy and faction agent hooks plus ordinary native missions retain precedence.
2. The server confirms exactly one eligible **uncontracted original NPC mining fleet** for that agent, an already-mounted system scene and real NPC ships, native controllers and employer. Zero offers or more than one candidate => no automatic fleet selection.
3. The pilot is an authenticated member of a real player corporation with **Industry** and **wallet division 1000** authorization.
4. An **operator-approved employer wage policy** must exist on the server. Stock EveJS has no NPC mining-wage quote, so this deliberately does **not** infer salary from market prices or fabricate an employer offer.
5. Agent **View** displays the true miner/hauler counts, the fixed **3-cycle** wage and that all mined ore still belongs to the NPC employer until a separately paid title transfer. The exact quote is pinned to the same authenticated server session for **120 seconds**; a restart or relogin requires reopening the agent.
6. Agent **Accept** revalidates the **same fleet, price, policy revision, corporate permissions, original NPC owner, uncontracted GameStore fleet index and current quote**. Only then it calls the pre-existing `createPlayerMiningCompany.hire` native GameStore atomic payment. The buyer corporation pays its actual ISK wallet, the employer receives the same amount, and the same physical fleet gets one FUNDED contract.
7. The durable shift `operationID` is derived from SHA-256 of the original fleet identity, agent, corporation IDs, wage policy revision, ship IDs, cycle count and quoted total, not supplied by the client. After a successful hire the Agent reopens in **funded-fleet command** mode from Stage D1.
8. Repeated Accept, stale role, missing or changed policy, already funded fleet, invalid source, expired quote and ambiguous payment outcomes are rejected or require explicit operator reconciliation. Unknown states are never silently refunded or retried.

## Operator-owned configuration

No salary policy file = **NO HIRING OFFER**. With an authorized disposable game server, the operator can explicitly create:

`$EVEJS_DATA_ROOT/coop-npc-mining/wage-policy.json`

Example **illustrative** policy (replace `9911` with a verified real employer NPC corporation ID and balance-tested rates before use):

```json
{
  "version": 1,
  "employers": {
    "9911": {
      "enabled": true,
      "revision": 1,
      "minerCycleCents": 10000,
      "haulerCycleCents": 5000,
      "maxCycles": 6
    }
  }
}
```

Values are **integer ISK cents**, *not* dollars or a native market price. The current first-version Agent hires **exactly 3 cycles**, so with two real miners and one hauler this example would quote (2 × 10,000 + 5,000) × 3 = **75,000 cents = 750 ISK**. This is an operator-defined balancing policy, **not an earned or guaranteed profit**. Do not confuse the wage with ownership of ore: the separate Stage C1 title purchase is required.

The file must reside in server-owned persistent game data with administrator-controlled write access. Use an atomic file replacement for tariff edits and **increment `revision`** when changing rates. Corrupt JSON, missing employer, non-positive or non-integer rates, overlarge amounts and disabled profiles all fail closed.

The three separate opt-ins are:

```ini
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_PLAYER_NPC_MINING_COMPANY=1
EVEJS_COOP_PLAYER_NPC_MINING_AGENT=1
EVEJS_COOP_PLAYER_NPC_MINING_HIRING=1
```

Leave **all OFF in the preserved world** until the disposable native SQLite and two-client acceptance gate has passed. No shadow wallet, ore mint, synthetic character/agent, duplicate scheduler or admin chat command was added.

## Code and evidence

- `integration/coopPlayerMiningHiring.cjs`: original employer policy reader, physical-fleet quote, per-session 120-second confirmation, amount-bound deterministic operation ID, original atomic wallet-funded hire, guarded `player-mining-hire` event.
- `integration/coopPlayerMiningAgent.cjs`: native Agent uncontracted-offer View/Accept path alongside existing funded fleet View/MINE path; no fake mission record.
- `integration/coopPlayerMiningFleetTick.cjs`: reuses the original native-only fleet witness through its trusted `verified()` export. Reading an Agent **never** calls `ensureScene()`.
- `scripts/overlay-spec.cjs` and `docs/coop-flags.json`: reversible overlay copy and registry of default-OFF flag.
- `tests/coop-player-mining-hiring.test.mjs`: **18/18** isolated JS tests PASS, using mock in-memory GameStore and a deterministic test-only stand-in for SHA-256.
- `tests/coop-player-mining-agent-hiring.test.mjs`: **10/10** isolated JS tests PASS.
- Existing `tests/coop-player-mining-agent.test.mjs`: **17/17** isolated JS tests PASS after the enhancement.

These are **not full Node/SQLite/Rust/physical EVE client tests**. GitHub access is via the connector; the execution container cannot resolve github.com, so the complete current project checkout and original SQLite process were not available in this session.

## Remaining stages and acceptance gate

- Run full `node --test tests/coop-player-mining-*.test.mjs` and the pinned overlay `--dry-run`, `--check` on a disposable copy of the original EveJS world. Verify GameStore row grouping, cache refresh after COMMIT, SQLite restart, corporate wallet journals and exactly-once hire across crash boundaries.
- Test original Agent dialogue on two actual authenticated clients; role with wallet+industry sees Accept, ordinary member cannot fund, stock missions and existing NPC job agents still take priority.
- Add a native in-game **multi-fleet selector** and safe **HOLD / HAUL / RETREAT** controls; stock Accept/View cannot express four distinct orders.
- Complete a real corporate ore title purchase, stock order/sale and fee/tax/ISK profit trail; record exhausted wages, renewal and recovery.
