# Chat 24 + 31 — Stage E2B1: Original Corporation-Owned SELL Escrow

**2026-10-26 — source implemented, NOT live, NOT market settlement. PR #287 Draft.** E2B1 is strictly an original custody primitive, not a corporate SELL feature in playable EveJS yet. All features default OFF.

## Native market contract and why this stage is blocked in production

Pinned \`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f\`:

- Original \`marketProxyService.assertPersonalMarketOnly(useCorp)\` explicitly refuses corporation SELL orders. Stock \`executeSellEntry\` only accepts character-owned items in a personal station hangar. **Do not pass native corporate ore to that path.**
- The original escrow location rule is \`MARKET_ESCROW_LOCATION_BASE + order_id\` where the base is **9,200,000,000**. We use the same bijective safe-integer mapping, rejecting unsafe order IDs.
- Original P2P Rust claim/fence and original GameStore settlement are explicitly **\`is_corp:false\`**; they must not be repurposed or tricked into crediting a corporate wallet.
- There is **no native Rust \`PREPARED_UNPUBLISHED\` corporation SELL order in the pinned server**. We intentionally require such an independently authenticated, unfilled and *not yet published* order before corporate custody can bind. A Rust OPEN order is always refused because it could fill before the physical stock is secured. This means the E2B1 writer is **not callable by existing live gameplay**, even if the flag is enabled.
- Rust corporate order preparation, later publication and corporate wallet settlement must be added in distinct patches to the pinned native Rust and market adapter. An original Rust live order with a fake client-side \`verifiedNative\` boolean is not an acceptable authority.

## Corporate SELL custody primitive

\`integration/coopPlayerMiningCorporateSellCustody.cjs\` exports \`createOriginalCorporateSellCustody\` with two operations.

### \`reserve(...)\`

Requires all of:

1. A trusted server-provided, authenticated corporation member with current Industry + Wallet 1000 + corporate hangar TAKE rights; genuine office/station and signed Session authority.
2. Stage C1's original paid ore title transfer with exactly one original physical \`itemID\` / \`cargoID\` / unchanged owner and office division flag 115–121. Stage E2A \`readiness.inspect()\` must verify the complete original wage/ore-purchase wallet and original native title ledger. Missing or duplicated cargo marker rejects.
3. A separately verified native corporate SELL **prepared but unpublished** Rust order, same exact seller corporation, cargo item type, quantity, station, and a server-authorized price. \`order_id\` must fit original bijective native escrow location arithmetic. An already OPEN/partially filled order is not accepted.
4. A clean \`gameStore.coopAtomicNativeRows\` writer (single lock/COMMIT), empty original order ID/marketEscrow key and no item at that escrow location, no original cargoID already reserved, no conflicting item/order reservation.

One original native GameStore atomic transaction over **\`items\` + \`corporationRuntime\` + \`marketEscrow\`**:

- Moves the **same itemID** from the original player corporation office hangar to the original sell-order escrow location (\`9,200,000,000 + orderID\`), changes flag from 115–121 to 4, **preserves owner corporation** and type/quantity/provenance marker.
- Writes an authentic corporation-owned \`marketEscrow[orderID]\` row \`isCorp:true\` and a durable, source-linked \`coopPlayerMiningCorpSell\u001fcargoID\` receipt in the original native \`corporationRuntime\`. Both say \`ESCROW_BOUND_UNSETTLED\`.
- Creates **no Rust order**, no fill, no ISK credit, no new stack/character/wallet. It cannot be considered a realized sale. An uncertain COMMIT is marked for manual repair rather than blindly reissued.

### \`returnUnsold(...)\`

Returns **the same itemID** to the same original corporate office folder/flag in **one** original GameStore transaction, retaining a terminal \`RETURNED_UNFILLED\` receipt and marketEscrow tombstone. Requires a fresh trusted original Rust \`CANCELLED\` or \`EXPIRED\` proof for the exact order and corporation with \`totalFilled===0\` and \`totalPaidCents===0\`, unchanged original escrow item/owner/type/quantity/marker, and current corporate office TAKE rights. A partial fill, unknown Rust ACK, missing original item or revoked role cannot be silently refunded.

The persisted tombstone prevents order ID or cargoID reuse after restart. We do not yet implement partial-fill restitution; such cases remain fenced for the upcoming original Rust claim, fill/cancel and corporate wallet implementation.

### Flags and deployment

\`EVEJS_COOP_PLAYER_NPC_MINING_CORP_SELL_ESCROW\` is declared in \`docs/coop-flags.json\` and defaults OFF. The primitive is present in the reversible \`integration/*.cjs\` overlay but has **no Agent/client action, Rust order preparation callback or live configured service**. The feature flag **does not make corporate SELL available** by itself.

A new \`coopPlayerMiningCorpSell\` group is registered with the original pinned \`sqliteStore.ROW_GROUPS.corporationRuntime\`, preventing the ordinary stock GameStore flush from corrupting source-linked escrow receipts.

### Evidence

- **20/20 isolated exact-source JS corporate escrow unit tests PASS**: original item/owner custody, exact native location, atomic 3-table receipts, duplicate and foreign order denial, role/office/source mismatch, unknown ACK fences, repeated reserve/return, zero-fill Rust cancel requirement, blocked partial fill, already-open order and duplicate cargo marker.
- The exact pinned native \`sqliteStore.js\` source with all mining row groups, including \`coopPlayerMiningCorpSell\`, parses, installs idempotently, uninstalls exactly back to source and round-trips native escrow receipts. This is a JS source simulation, **not a real SQLite database restart**.
- Previous E2A **15/15** source market-readiness tests and Agent **19/19** tests already passed.
- **NOT RUN:** exact native Rust \`PrepareCorpSell\`, \`PublishCorpSell\`, corporate full/partial \`ClaimFill\` (these do not yet exist), native SQLite crash/restart, original market proxy client workflow or two-player EVE gameplay. No live native market order or ISK credit has occurred.

## Stage E2B2 — private original Rust corporate SELL preparation + GameStore proof

- Added a **reversible, pinned Rust market-server extension** with `PrepareCorpSell`, `GetCorpSell` and `VerifyCorpSellEscrow`. The prepared corporate order is **not open or matchable**; it is uniquely bound to the real ore `itemID`, `cargoID`, corporation, station, quantity, price and source operation. Original `PlaceOrder` is guarded against source `coop-corporation`.
- Rust itself opens original GameStore SQLite in **read-only mode** and checks the exact original corporate SELL receipt, item owner/location/provenance, and genuine `marketEscrow` order row before exposing a successful proof. A client `verifiedNative` boolean is never accepted as a substitute for the physical SQLite evidence.
- The original Node bridge performs: authorized original corporation and price → private Rust prepare → independent Rust get → E2B1 atomic GameStore cargo escrow → independent Rust GameStore audit. Unknown outcomes fail closed without retry or ISK credit.
- **`PublishCorpSell` intentionally refuses** after its read-only verification. Live original Rust full/partial claims, corporate buyer debit and seller-wallet/tax settlement have not been built. Enabling early order matching would produce unbacked trades.
- Evidence: **9/9** isolated bridge tests, **10/10** Rust source installer safety tests, pinned Rust state/rpc patch install-uninstall exact roundtrip; actual Rust compiler, SQLite process and two EVE clients **NOT_RUN**.
- See [CHAT24_31_RUST_CORPORATE_SELL_PREPARE.md](CHAT24_31_RUST_CORPORATE_SELL_PREPARE.md) for secure configuration, manual commands, remaining settlement acceptance and rollback.

## E2B2 remaining engineering and acceptance gates

1. Original Rust market daemon needs a dedicated authenticated **\`PrepareCorpSell\`** (durable unpublished state, one-time nonce and quote) plus **\`PublishCorpSell\`** allowed only after the exact original ItemStore and marketEscrow receipt has been durably verified. Never place an OPEN order first.
2. Original corporate order ID source proof must be authenticated by the server, not a client boolean, and tied to the same orderbook generation/version, station, type, quantity and pricing. Publish ACK uncertainty must remain fenced.
3. Extend original Rust full/partial market fill claim/finalize for **\`is_corp:true\`** without loosening existing personal P2P admission. One original GameStore atomic COMMIT must debit the actual buyer, credit the actual seller **corporation wallet** net of native taxes/fees, transfer/consume exact original escrow item quantities, and record immutable bidirectional receipts.
4. Full/partial cancel, expiry, crash and restart must re-verify the remaining original itemIDs and quantity; no double sale, free ore, forged ISK, or personal wallet contamination.
5. After a completed native corporate wallet credit is independently verified, add an expense/profit reader scoped to **realized fills**, wages, ore title purchases and actual verified fees, not guessed market prices.
6. Reconcile the Draft feature branch with the fast-moving \`main\`, run the complete Node/SQLite/Rust suite on a disposable pinned checkout, then two authenticated clients.

**Do not enable on a preserved game world.** This stage intentionally cannot place or settle a corporation order until E2B2 is implemented and integration-tested.
