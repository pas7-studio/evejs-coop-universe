# Chat 24 + 31 — Stage E2A: Original Corporate Ore Market Readiness and Actual ISK Costs

**Implemented source on Draft PR #287; LIVE_UNVERIFIED; default OFF.** Corporate market order creation is deliberately unsupported until a genuine original native corporate SELL/fill path exists. This stage adds no sale, market quote, escrow, inventory mutation or ISK credit.

## Pinned native blocker (verified against original EveJS source)

At \`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f\`:

- \`Code/server/src/services/market/marketProxyService.js\` implements \`assertPersonalMarketOnly(useCorp)\`, which rejects \`useCorp=true\` with the explanation that corporation market orders have not been wired to corporation wallets or hangars.
- \`executeSellEntry\` requires \`item.ownerID===session.characterID\`, \`item.locationID===stationID\`, \`item.flagID===ITEM_FLAGS.HANGAR\`. Our original mining ore correctly belongs to **player corporation**, sits in a native corporation office folder and has an office division flag 115–121. Calling this personal SELL function cannot legitimately sell it.
- The existing \`coopPlayerMarketFill\`, \`coopMarketSellCustody\` and \`coopPlayerMarketAtomicSettlement\` expressly require **\`is_corp===false\`** and original character wallet / character market escrow. Reusing them for a corp sale would bypass their type/custody contract.
- Therefore do **not** transfer ore free to a player's personal hangar, misrepresent a character as seller, assume a Rust orderbook match is settlement or credit corporate ISK without a verified original full/partial fill.

## What Stage E2A actually does

\`integration/coopPlayerMiningMarketReadiness.cjs\` reads the original native GameStore, native ItemStore, existing native corporate offices and \`coopPlayerCorporationAccess\`; it makes **zero mutations**. Its two query methods are:

- \`inspect({session,corporationID,operationID,cargoIDs})\` — a scoped explicit original-cargo request.
- \`inspectShift({session,corporationID,operationID})\` — server-only enumeration of the \`coopPlayerMiningOreTitle\` GameStore group, filtering exactly this funded shift and company. The client cannot omit a cost-bearing cargo ID to make profits look larger; a corrupt or oversized index blocks.

Every response requires an authenticated original character session, corporation membership, Industry + Wallet 1000 roles. It independently reads the same real \`coopPlayerMiningShift\` contract, matching unique \`coopPlayerMiningFleet\` index, **both corporations' original wallet transactions and journal entries** for the paid shift and every selected original ore-title transfer. It rejects missing reciprocal debits/credits, wrong original operation IDs, duplicate cargo/item IDs, altered cost cents, inaccessible office or absent moved/duplicated original ItemStore stock.

A verified read provides only:

- \`wagePaidCents\`: actual corporate wallet debit proven by the wage receipt and **both** original journals;
- \`orePurchasedCents\`: actual corporate wallet debits for original title purchases for this shift only;
- \`verifiedCashOutflowCents\`: the sum of these **verified costs**, not a full historical P&L (other fees, rent and taxes are not yet included);
- \`originalCorporateOre\`: physically verified, individually tagged original native items still in the corporation office;
- \`marketOrderCreated:false\`, \`realizedRevenueCents:null\`, \`netProfitCents:null\`, \`priceIsBinding:false\`, \`status:"NATIVE_CORPORATE_SELL_UNSUPPORTED"\`.

An incomplete source, missing original wallet journal due to rotation, moved/consumed item, missing office role, broken GameStore index or unavailable data returns **BLOCKED**. No fabricated zero revenue is emitted.

\`coopPlayerMiningAgent.cjs\` adds a read-only optional manager-only display in the existing stock Agent dialogue: verified scoped ISK expenses and explicit "corporation market SELL unavailable; revenue/net profit unverified." This does not alter the older View/Request/Accept fleet selector and cannot initiate a market order.

## Activation

Only if an authorized disposable native world has been proven and the user wants to view expenses:

\`\`\`ini
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_PLAYER_NPC_MINING_COMPANY=1
EVEJS_COOP_PLAYER_NPC_MINING_AGENT=1
EVEJS_COOP_PLAYER_NPC_MINING_MARKET_READ=1
\`\`\`

**All remain OFF by default.** This flag does not authorize SELL and cannot be used to infer support for corporate market orders. Native server adapter lazily reads original corporation, member, office, wallet and ItemStore sources; no new scheduler or shadow market.

## Tested

- **15/15** isolated source-level market readiness tests: real expenses, no phantom profit, full shift source scanning, wallet and title tamper, item ownership, office rights, missing/duplicated receipts and disabled state.
- **19/19** Agent tests including explicit manager-only verified cash-cost display and failure to invent profits if source unavailable.
- Existing D2 Agent hiring 10/10 and D3 Agent fleet selection 8/8 remained green in isolated exact-source JavaScript tests.
- The whole pinned native Node/SQLite/Rust and two authenticated clients **NOT_RUN**. No native market trade or ISK credit has been executed.

## Stage E2B1 — original corporation-owned SELL custody primitive (source implemented)

- Added original source-bound `coopPlayerMiningCorporateSellCustody`: one actual native `items + corporationRuntime + marketEscrow` transaction moves **the same original ore itemID** into the real `9,200,000,000 + orderID` SELL escrow location without changing its corporate owner. Writes authenticated `isCorp:true` escrow and persistent `coopPlayerMiningCorpSell\u001fcargoID` receipt.
- An original native Rust corporate SELL must first exist in **`PREPARED_UNPUBLISHED`** state with no fill and binding source quote. This Rust state is **NOT implemented upstream**, so this isolated writer remains **NOT LIVE**; already-open orders are rejected to avoid unbacked fills.
- A native `CANCELLED/EXPIRED` and **zero-fill** witness permits the original item to return to the same corporate office in one transaction. Unknown commits and partial fills fail closed; no duplicate cargo, synthetic ore or fake ISK credit.
- Registered `coopPlayerMiningCorpSell` in the reversible pinned native SQLite group mapping, plus a default-OFF feature flag. **20/20** isolated escrow/return tests and exact pinned SQLite row-group roundtrip PASS. Actual Rust corporate order publication and corporate settlement remain future engineering.
- See [CHAT24_31_CORPORATE_SELL_ESCROW.md](CHAT24_31_CORPORATE_SELL_ESCROW.md) for source contract, tests and next actual native `PrepareCorpSell → escrow → PublishCorpSell → ClaimFill` requirements.

## Stage E2B2 — private original Rust corporate SELL preparation + GameStore proof

- Added a **reversible, pinned Rust market-server extension** with `PrepareCorpSell`, `GetCorpSell` and `VerifyCorpSellEscrow`. The prepared corporate order is **not open or matchable**; it is uniquely bound to the real ore `itemID`, `cargoID`, corporation, station, quantity, price and source operation. Original `PlaceOrder` is guarded against source `coop-corporation`.
- Rust itself opens original GameStore SQLite in **read-only mode** and checks the exact original corporate SELL receipt, item owner/location/provenance, and genuine `marketEscrow` order row before exposing a successful proof. A client `verifiedNative` boolean is never accepted as a substitute for the physical SQLite evidence.
- The original Node bridge performs: authorized original corporation and price → private Rust prepare → independent Rust get → E2B1 atomic GameStore cargo escrow → independent Rust GameStore audit. Unknown outcomes fail closed without retry or ISK credit.
- **`PublishCorpSell` intentionally refuses** after its read-only verification. Live original Rust full/partial claims, corporate buyer debit and seller-wallet/tax settlement have not been built. Enabling early order matching would produce unbacked trades.
- Evidence: **9/9** isolated bridge tests, **10/10** Rust source installer safety tests, pinned Rust state/rpc patch install-uninstall exact roundtrip; actual Rust compiler, SQLite process and two EVE clients **NOT_RUN**.
- See [CHAT24_31_RUST_CORPORATE_SELL_PREPARE.md](CHAT24_31_RUST_CORPORATE_SELL_PREPARE.md) for secure configuration, manual commands, remaining settlement acceptance and rollback.

## Native corporate SELL required before Stage E2B can be truthfully called live

1. Native market service must create a **real corporation-owned SELL order** from the original office warehouse itemID with authentic corporation roles and full order-price/quantity/tax authorization. Character-only SELL admission cannot be reused unchanged.
2. Original ItemStore must move **exactly those itemIDs** into a uniquely identified, reversible native corporate market escrow, never changing the owner to a character or creating new stacks without exact provenance.
3. Rust orderbook claim needs real full/partial fill, buyer debit and immutable one-order/one-cycle witness; never credit an open but unfilled order. This must be compatible with already implemented P2P atomic market fencing.
4. One original GameStore transaction must consume original escrowed stock / move title and **credit the real corporate wallet** net of native fee and tax, retaining a bidirectional original buyer/seller ledger and immutable receipt for reconciliation.
5. On cancellation, expiry, crash or unknown Rust ACK, exact original unsold itemIDs/quantities must return to the right corporate office (not personal hangar); outcome unknown blocks retries, preserving item and ISK conservation.
6. Only after actual settled buyer/seller fees and independently verified wallet deposits may a report fill \`realizedRevenueCents\` and derive *realized* P&L. Additional rent/escort/salaries must be included or clearly excluded with a declared reporting scope.

**Next implementation:** do corporate SELL as a separate pinned original native market extension, using the existing Rust claim/fence/atomic settlement architecture, with original office/ownership/cancel/refund tests before any runtime activation. This is not claimed implemented in E2A.
