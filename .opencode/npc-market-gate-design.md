# NPC market — design of the disposable verification gate (COOP-0xx, pre-implementation)

Status: design only. Nothing executed. Live world must stay untouched.
Binding docs: `docs/NATIVE_NPC_MARKET.md`, `docs/DEVELOPMENT_DOCTRINE.md`,
`docs/GAMEPLAY_TESTING.md`.

## 1. Objective and non-goals

Objective: prove that an existing native NPC can (a) sell real cargo into a real
`source="seed"` buy order and earn ISK, and (b) later spend only that earned ISK on real
seeded stock, with exact native cargo/ledger accounting and no duplicate settlement.

Non-goals: independent NPC-owned order book listings (needs upstream wallet/escrow),
player wallet interaction, any change to the live world, client rendering proof.

## 2. Isolation design

| Concern | Decision |
| --- | --- |
| Compose project | `-p evejs-npcmkt-test` (separate project name ⇒ separate named volumes) |
| Volumes | Fresh `evejs-data` for that project only; live `evejs-data` never mounted |
| Image | Reuse the already-built `evejs-local`; no source change, no rebuild of code |
| Overlay | Same deployed overlay in `Code` (no code delta for this gate) |
| Ports | Override file republishes 40110→41110 and server ports to 15222/1443/16100-16102, or `!reset` to none; no client is needed |
| Client | Not required; Play.bat stays closed |
| Market | Fresh seed inside the test volume (`market-tools rebuild v1 --solar-system-id <target>`) |

Rationale: a test that shares volumes or ports with the live world cannot prove
"nothing leaked", and a client connection is not needed for NPC trading.

## 3. Preconditions (all must be true before a single RPC)

1. `docker compose -p evejs-npcmkt-test ... ps` shows `server` and `market` healthy.
2. The test volume has its own `market.sqlite` (verify `market-tools snapshot-info` inside the test project).
3. `EVEJS_COOP_NATIVE_NPC_MARKET=1` only in the test project.
4. Empty allowlists are proven to do nothing (negative control) **before** setting real types.
5. A native NPC exists with real cargo: mining fleet ACTIVE, hauler loaded (`living-native-industry`
   ACTIVE plus `living-real-ore-delivery`/`loadedOreShips>0`), and its ship is physically
   within 10 km of a native station in the same system.
6. Live world untouched: record live order count/`coop-events.jsonl` size before the test and compare after.

## 4. Data discovery (read-only, before enabling anything)

1. Pick the target system with both a station and a working mining fleet (Perimeter 30000144
   in the current world).
2. Query the test market for orders at that station: keep type IDs where a `source="seed"`
   **buy** order exists with positive remaining quantity and a sane price.
3. From the NPC's actual cargo (`nativeNpcStore`), intersect with (2). If the intersection is
   empty, stop: no trade is possible and no RPC may be attempted.
4. Buy allowlist = the cheapest 1–2 types that the same station actually stocks (`source="seed"`).
5. Record the exact IDs in the evidence file; never invent a type.

## 5. Test configuration (test project only)

```
EVEJS_COOP_NATIVE_NPC_MARKET=1
EVEJS_COOP_NPC_MARKET_SELL_TYPES=<intersection from 4.3>
EVEJS_COOP_NPC_MARKET_BUY_TYPES=<from 4.4>
EVEJS_COOP_NPC_MARKET_MAX_QTY=1
EVEJS_COOP_NPC_MARKET_MAX_PRICE=1000
EVEJS_COOP_NPC_MARKET_COOLDOWN_MS=60000
```

Rationale for the smallest numbers: any accounting error is visible at once, and one unit
cannot hide a double fill or a wrong price.

## 6. Execution order (each step gated)

1. **Negative control**: allowlists empty, flag ON → expect zero trade events after 10 minutes.
   This proves the flag alone cannot trade.
2. **Sell path**: sell allowlist set, buy empty → expect exactly one settled sale per cooldown,
   market buy-order quantity reduced by 1, cargo reduced by 1 unit, ledger up by the exact price.
3. **Buy path**: after the ledger is positive, set the buy allowlist → expect one purchase,
   ledger down by exactly the price, one new cargo item with a unique cargo ID and finite volume.
4. **Restart test**: restart the test server, wait two ticks → no duplicate fill, journal
   shows the settled transaction, ledger unchanged.
5. **Failure injection** (optional, only if the harness allows): stop the market container mid-trade
   → expect `RPC_OUTCOME_UNKNOWN`/`NEEDS_OPERATOR_REPAIR` and no retry, no duplicate cargo.

## 7. Evidence matrix (what must be captured per step)

| Claim | Evidence |
| --- | --- |
| Trade settled | `living-native-npc-market` probe event with market order ID (string), type, price, qty |
| Order really moved | market `GetOrders` before/after for that station+type, quantity delta = 1 |
| Cargo really moved | `nativeNpcStore` item quantity before/after, and live `ship.nativeCargoItems` |
| Money is earned, not granted | ledger 0 before the first sale; equals sale price afterwards |
| No duplicate | journal entry count unchanged across one restart |
| Isolation | live project order count and events file unchanged during the whole test |

Redaction: no pilot names, order IDs beyond the ones needed, no wallet balances of players.

## 8. Rollback and teardown

1. `docker compose -p evejs-npcmkt-test down -v` (test volumes only).
2. Delete the test override file and the test seed; never copy its DB into the live volume.
3. Re-verify live world: `-Action Status`, order count, `coop-events.jsonl` size.
4. Record teardown in the evidence file.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Double fill after timeout | journal + `RPC_OUTCOME_UNKNOWN` halt; never auto-retry (already in code) |
| Wrong type ID (unseeded) | discovery step 4 plus negative control 6.1 |
| NPC trades with player cargo | preflight excludes player hulls; assert event actor is `coop-pilot-*` |
| Port/volume collision with live world | separate project name, override ports, no client |
| Seed rebuild disturbs live market | rebuild runs only inside the test project |
| Silent price/quantity drift | exact before/after deltas, qty 1, max price 1000 |

## 10. Exit criteria

PASS only if steps 6.1–6.4 pass with the evidence in §7 and the live world is byte-identical
in order count and event count. Anything less is `PARTIAL` or `BLOCKED`, never "done".

Still unproven after a PASS: NPC-owned independent orders, escrow, taxes, multi-NPC competition,
client-visible market UI for NPC trades.

## 11. Effort and checkpoints

- Setup + seed: ~15–20 min (second volume set, seed for one system).
- Negative control: 10 min idle observation.
- Sell + buy: ~15 min with cooldowns.
- Restart + teardown: ~10 min.
- Owner checkpoints: after 6.1 (nothing traded), after 6.2 (first real sale), after teardown
  (live world intact).
