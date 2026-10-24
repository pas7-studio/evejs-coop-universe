# Native NPC merchants — actual seeded-market trading (P1, guarded)

**Implementation status: complete first safe seed-order trading slice, OFF by default. Actual EveJS Docker/client gameplay has NOT been verified.** This slice is distinct from independent NPC-owned persistent orders; those still require upstream wallet/escrow settlement integration.

## Native market contract

Pinned EveJS contains a Rust **market daemon** with `GetOrders`, `FillOrder`, `AdjustSeedStock` and `RecordTrade`. The Node `marketProxyService` treats `source="seed"` buy orders and sell stock specially, delivering real bought items and consuming player inventory through the normal player path. **An ordinary `PlaceOrder` RPC alone is NOT enough** for an NPC-owned order: the Node server additionally expects a character wallet and correctly persisted escrow. Creating an anonymous owner order would produce a broken item and ISK settlement path.

The opt-in `integration/coopNativeNpcMarket.cjs` implements safe **NPC participation in existing seeded market orders** without spoofing an authenticated session:
- **Sell:** named native trader/hauler with real cargo, physically within 10 km of a native in-scene station, offers existing unmodified physical cargo to a real `source="seed"` **buy** order; `FillOrder` reduces the authoritative market buy quantity. The exact sold items disappear from the native cargo store and live `ship.nativeCargoItems`. Sale proceeds are credited only to this NPC's persistent **earned-ISK trading ledger**.
- **Buy:** a native pilot with sufficient previously earned ISK buys actual `source="seed"` station stock via `AdjustSeedStock` with a negative delta. The purchase adds a properly typed, uniquely allocated native cargo item to both the NPC store and the live ship cache, and deducts the price from that pilot's trading ledger.
- **No initial grant:** NPC trading wallets start at **0 ISK**. An NPC must sell genuinely held cargo before it can buy anything. The ledger is deliberately separate from player character wallets; no fake player character, fake session or synthetic market profit is created.
- No orders are opened on behalf of player accounts, no modification of player-owned escrow, no player-market orders matched by the NPC trader, and no independent NPC-owned order book listings yet.

A trade is eligible only when a persisted `coop-pilot-NNN` identity matches the original physical `nativeNpc` ship and exact system. Both static station metadata (`stationID`, region, solar system) and the actual corresponding station entity in the EveJS scene must exist. Active combat/warp routes are excluded by the background driver.

## Financial and inventory invariants

- Separate allowlists of exact **type IDs** for buying and selling. Empty allowlists mean **no trades**. Only unpackaged native cargo (`moduleID=0`, non-singleton) can be sold, never charges fitted into modules.
- Bounded order quantity (default 5, maximum configured 20 per runtime tick), max unit price (default 10,000 ISK, capped at 1,000,000), two NPC trades per world tick maximum, 5-minute per-pilot cooldown by default.
- Native market preflight also excludes authenticated player-controlled hulls, live native combat targeting/manual attack orders and ships in native warp.\n- Read the actual market `GetOrders` book from the station's region. Accept only explicit `source="seed"`, matching station and type, finite price, positive available stock. Preserve Rust's 64-bit market order IDs as decimal **strings** rather than passing them through unsafe JavaScript numeric conversion.
- Revalidate the physical NPC, its station proximity, cargo and ledger balance after awaiting the market book and before any mutating RPC.
- Native ship hull type data must provide a **finite cargo capacity**; all current native cargo types must have known finite volumes. A purchase is capped by actual spare hull volume and earned wallet balance. Unknown capacity/volume fails closed.
- After `FillOrder` or `AdjustSeedStock`, verify the exact returned station, type, order/filled quantity where available, and matching price. A changed or ambiguous remote acknowledgement is **not silently settled**.
- The authoritative native cargo store is updated first; then EveJS's active `ship.nativeCargoItems` is rebuilt directly from the native store, including each item volume. Only then is the earned-ISK ledger saved and the trade declared **`TRADE_SETTLED`**.
- A durable per-pilot transaction journal prevents duplicate fills after restart. An acknowledged RPC with a local inventory-write failure can be resumed exactly once without a second market RPC. If an RPC timed out after being sent, its result is unknowable: **`RPC_OUTCOME_UNKNOWN` / `NEEDS_OPERATOR_REPAIR`**, never an automatic retry.
- Recorded trade history is best-effort after final settlement; history failure does not repeat a market operation.

## Configuration (all defaults preserve current playtest)

```ini
EVEJS_COOP_NATIVE_NPC_MARKET=0
EVEJS_COOP_NPC_MARKET_SELL_TYPES=
EVEJS_COOP_NPC_MARKET_BUY_TYPES=
EVEJS_COOP_NPC_MARKET_MAX_QTY=5
EVEJS_COOP_NPC_MARKET_MAX_PRICE=10000
EVEJS_COOP_NPC_MARKET_COOLDOWN_MS=300000
```

Only on a disposable, backed-up world with a running native EveJS market daemon, enable the flag and choose **actually seeded** item types for the chosen station and region. For example, a native hauler may carry an ore/mineral type that the station already buys. Without a real matching `source="seed"` counterparty in the market, no RPC mutation occurs. With zero earned funds, buys cannot occur.

Persistent state is under `/var/lib/evejs/coop-native-market`: `ledger.json` and `tx/coop-pilot-NNN.json`. Back up this directory **together with** the native NPC store and Rust market daemon database. A journal marked unknown RPC outcome must be manually reconciled against market order/stock state **before** considering clearance; never simply delete it.

## Verification

```powershell
node --test tests/coop-native-npc-market.test.mjs tests/coop-world-report.test.mjs
.\scripts\Local-Two-Client-Test.ps1 -Action Market -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

The manual Market report requires **a real settled native seed buy-order sale followed by a seed-stock purchase by the same pilot and ship**, within its evidence window, both with confirmed market RPC and actual native cargo mutation. It returns `AWAITING_NATIVE_MARKET_TRADE` when those facts are missing. The report does **not** prove a player client sees an NPC name as an order owner, nor that other players interacted with a personal NPC-owned order.

For acceptance on a real EveJS server, verify original cargo decreases, a real seed buy order decrements, earned ISK increases once, then a second real seed sell stock row decrements, a new cargo ID appears in the exact same native ship, wallet decreases appropriately, and the player-visible market matches the daemon. Repeat with a disconnected market daemon and a forced crash after RPC acknowledgement; there must be **no duplicate cargo or ISK**.

**Current isolated evidence:** 13/13 native market transaction assertions, 24/24 strict world/report assertions PASS in a JavaScript test harness. Not a live game test or end-to-end multiplayer verification.

## Next slice — independent NPC orders

Creating true **independent NPC-owned market orders** is a separate feature. It needs a dedicated NPC market owner type and correct durable wallet reservation, sell escrow, owner-order expiry/cancellation, player settlement, taxes, trade-history and inventory delivery in both Rust market daemon and Node market proxy. Do not substitute `PlaceOrder` alone: it can make a visible but unfulfillable or unfunded order. Complete those upstream integration points, migrations and real player/NPC round-trip tests before enabling personal NPC market making.

Repository owner policy: NO GitHub Actions or remote CI. Do not merge without explicit approval.
