# Market settlement fence — port design note (261108.1)

Task: re-establish the co-op P2P settlement guarantees on EveJS 261108.1's market,
or decide in writing that some are no longer needed.

Status: **not started on purpose.** `services/market/marketProxyService.js` in the
port refuses to load with any fence flag on (`COOP_MARKET_FENCE_NOT_PORTED`), so a
half-ported fence can never look active. Everything below is the work needed to
remove that refusal honestly.

## What the old proxy was, and what the fence protected

Our fork's proxy (4 198 lines, +4 565/−4 254 vs the pin) built player-to-player
settlement by hand on top of the daemon RPC:

1. **Match check** — `coopPlayerMarketFill.checkSellMatch/checkBuyMatch` recomputed
   the expected volume/price before the RPC, so a fill could not be applied twice.
2. **Settlement fence ticket** — `coopPlayerMarketSettlementFence.begin/confirmRust/
   complete` made the irreversible Rust side (wallet/items) and the Node side
   (escrow, journal) one two-phase operation, with `assertClear`/`assertStationClear`
   refusing to start while another settlement was open for that order/station.
3. **Rust claim** — `coopPlayerMarketRustClaim.claim/finalize` gave the daemon an
   idempotent handle so a retry after a timeout could not double-settle.
4. **Custody proofs** — `coopMarketSellCustody.assertSellEscrow/assertSellReturned`
   and `coopMarketCancelCustody.assertMatchingBuyEscrow/assertCancelledAck` proved
   the escrowed item ids matched the order before and after the move.
5. **Buy reserve** — `coopPlayerMarketBuyReserve(.Runtime).assertExisting/place`
   plus the refusal to reconstruct GameStore escrow from an unfunded Rust row
   (`P2P_BUY_RESERVE_...` errors).
6. **NPC corporate settlement** — `coopNpcCorporateBuyRuntime.buyFromOrder` with
   `EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT[_PROOF]`.
7. **Environment guards** — `coopPlayerMarketEnvGuards.assertP2pSettlement/
   assertP2pAtomic/assertBuyReserveEnv`: a flag combination that cannot be honoured
   fails at the call, never silently.

## What 261108.1 gives us instead

From the release notes and the code: a durable market with a **completion saga**,
idempotency keys per leg, order matching by price **and issue time**, broker fees on
private contracts, structure market hubs, a 1 % structure tax, refunds for failed
sell orders, "Buy Multiple", and durable expiry/fill-recovery jobs
(`DURABLE_EXPIRY_JOB_TYPE`, `DURABLE_FILL_RECOVERY_JOB_TYPE`,
`handleDurableMarketFillRecovery`, `reconcileDurableMarketOrders`).

That maps to our fence like this:

| Our guarantee | Upstream equivalent | Verdict |
| --- | --- | --- |
| idempotent Rust claim | idempotency key per leg in the saga | superseded |
| fill match recomputation | matching by price + issue time inside the daemon | superseded |
| two-phase ticket (`assertClear`) | saga phase + durable recovery jobs | mostly superseded; a per-order serialisation lock may still be needed for *concurrent* player orders |
| escrow custody proofs | escrow rows + saga item legs + `itemCustody` journal | needs a check: does the new proxy verify escrowed item ids, or only quantities? |
| buy reserve (no escrow from unfunded rows) | escrow state machine (`MARKET_ESCROW_STATE_PLACING/ACTIVE`) | likely superseded; verify a buy order cannot exist with unfunded escrow |
| NPC corporate settlement | nothing upstream-specific | **must stay ours** — it is a co-op feature |
| env guards | nothing | **must stay ours** — cheap and strictly protective |

## Recommended plan

1. **Read the new proxy's fill/cancel/expire paths** and write down, per guarantee,
   whether the new code already enforces it. Do not write any ported code before
   that table is filled with line references.
2. Keep two things unconditionally, ported as small guards into the new paths:
   `coopPlayerMarketEnvGuards` (flag combinations) and the NPC corporate settlement.
3. Only port the custody/fence machinery where step 1 shows a real gap — most
   likely the escrow item-id proof and a per-order lock for two players trading the
   same order concurrently.
4. Delete the `COOP_MARKET_FENCE_NOT_PORTED` refusal **in the same commit** that
   makes every flag in its list either honoured or explicitly retired.
5. Acceptance: with the fence flags on, two clients must complete and abort a P2P
   trade on the agents stack, with `coop-events.jsonl` showing the fence events and
   the wallet/escrow deltas matching `COOP_LOOP_ACCEPTANCE.md`. Until a human has
   seen that, the flags stay off.

## Why this is not done already

The port's rule was: never write code whose only verdict would be "it compiles".
The settlement fence is exactly the kind of thing that must be exercised by real
clients before it may be called wired, and the machine had no Docker daemon and no
client session during the port. The refusal in `marketProxyService.js` is the
honest placeholder; this note is the queue entry.
