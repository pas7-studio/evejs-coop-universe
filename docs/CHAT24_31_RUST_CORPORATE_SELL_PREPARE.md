# Chat 24 + 31 — Stage E2B2: Rust Corporate SELL Preparation and Original GameStore Escrow Proof

**Status 2026-10-26: SOURCE IMPLEMENTED / PREPARATION AND VERIFICATION ONLY / PUBLISH DISABLED / LIVE_UNVERIFIED.** Draft PR #287, not merged. All features default OFF. This is not a playable, filled corporate market order.

## Pinned original daemon

Original market-server: \`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f\`, files \`Code/externalservices/market-server/src/state.rs\`, \`rpc.rs\`, and \`market-common/src/lib.rs\`.

Existing stock \`PlaceOrder\` creates **open** orders immediately. That would be unsafe for an unsold corporation ore item: a fill could occur before original physical ItemStore/escrow COMMIT. Existing P2P Rust claims and original stock fills do NOT support corporation-owner credits. Corporate order source \`coop-corporation\` must never pass through ordinary \`PlaceOrder\` or a personal \`is_corp:false\` settlement.

## Implemented Rust source

\`rust/coop_corp_mining_sell.rs\` adds a separate **original market-server SQLite** table \`coop_corp_sell_prepared\`. Unique \`operation_id\`, \`cargo_id\`, \`item_id\`, \`order_id\`; immutable corporation, shift, station, item, quantity and exact price cents. Requires feature gate \`EVEJS_COOP_RUST_CORP_SELL_PREPARE=1\` plus a server-only random **at least 32-character** token shared with the trusted Node backend as \`EVEJS_COOP_RUST_CORP_SELL_TOKEN\`. Never send the token to the EVE client or put it in the repo.

| RPC | Source behavior |
| --- | --- |
| \`PrepareCorpSell\` | Creates exactly one \`state='prepared'\` corporation-owned \`source='coop-corporation'\` SELL order **invisible to standard open-order matching**, plus unique original source reservation. Repeated identical requests return the same order; differing payloads fail. |
| \`GetCorpSell\` | Returns read-only, source-bound original Rust prepared order witness (\`PREPARED_UNPUBLISHED\`). |
| \`VerifyCorpSellEscrow\` | Opens the **real GameStore SQLite read-only** and compares three exact original persisted records: \`corporationRuntime.coopPlayerMiningCorpSell\u001fcargoID\`, \`items[itemID]\`, and \`marketEscrow[orderID]\`. Requires original corporation owner, cargo tag, exact item ID/type/quantity, original native order-derived escrow location \`9,200,000,000 + orderID\`, and matching stored station, corporate order and phase. Does not create or alter anything. |
| \`PublishCorpSell\` | **Explicitly refuses** with \`CORP_SELL_NATIVE_FILL_SETTLEMENT_NOT_IMPLEMENTED\` after read-only escrow proof. No transition to \`open\` exists. This guard MUST remain until authentic corporate buyer debit + seller wallet credit + Rust full/partial claims and GameStore settlement are implemented. |

The Rust verifier requires an administrator-configured absolute real SQLite file path in \`EVEJS_COOP_RUST_CORP_SELL_GAMESTORE_DB\`. It opens with \`SQLITE_OPEN_READ_ONLY\`, not a duplicate economy database. It **does not** access or modify original EVE client state, and it never trusts a client-sent \`verifiedNative=true\` boolean.

\`scripts/coop-rust-corp-mining-sell-patch.cjs\` is a pinned **reversible manual Rust source installer**: injects RPC param types and four private method arms, guards the stock \`PlaceOrder\` path against \`source="coop-corporation"\`, and includes the extension in the original Rust \`state.rs\`. It refuses a different upstream revision, supports \`--dry-run / --check / --remove\`, and rolls back modified files on a write failure. It does not create workflows or deploy a new daemon. Existing NPC pending Rust patches can be composed in either order on the pinned source.

### Authoritative Node bridging

\`integration/coopPlayerMiningCorporateSellBridge.cjs\` is the trusted backend (not a client handler). It needs an explicitly configured approved server price function and the pre-existing original corporate readiness/roles. Its only operation is:

\`\`\`text
actual funded company + original ore purchase/office/corp roles
  -> server quote priceCents (not client selected)
  -> deterministic coop-corp-sell:<sha256 prefix 32> operation ID
  -> PrepareCorpSell (native Rust private, not open)
  -> GetCorpSell (separate original Rust source read)
  -> Stage E2B1 GameStore atomic items+corporationRuntime+marketEscrow
  -> VerifyCorpSellEscrow (Rust directly reads original GameStore)
  -> ESCROW_PROVEN_NOT_PUBLISHED
\`\`\`

After an unknown Rust ACK, unknown original GameStore COMMIT or unsuccessful secondary receipt verification, **no automatic retry/refund/cancellation** is issued. Cargo ID is fenced for operator reconciliation. Even on success, \`marketOrderCreated:false\`, \`realizedRevenueCents:null\` and \`netProfitCents:null\`; a prepared unpublished order is not a sale. No automatic Agent/client action is attached until the separate full economic pipeline passes.

This bridge is overlaid as a source module only. Its constructor defaults to disabled; it requires injected genuine original daemon, authoritative GameStore, corporation access, operator-approved price, and token. Merely enabling the Rust flag **does not** enable a client market order.

## Evidence, exact scope

- **9/9** isolated Node-to-Rust-interface orchestration tests PASS (source-level mock RPC/GameStore, not live daemon).
- **20/20** E2B1 original corporate escrow and zero-fill return tests PASS in the previous cycle.
- **10/10** Rust installer + source safety tests PASS in isolated JS.
- Exact pinned original Rust \`state.rs\` and \`rpc.rs\` tested with the reversible installer: installs idempotently, uninstall returns original bytes, CRLF roundtrip, both patch orders compose with the existing NPC pending Rust overlay.
- **NOT_RUN:** native Rust compiler/Cargo, pinned original real Rust service executable, original GameStore SQLite database COMMIT/crash/restart, stock market fill, actual in-game client. This runtime has no Rust toolchain; these results are not compiled Rust tests. The doc and code are intentionally source-only.
- No automatic CI or remote workflow created.

## Manual E2B2 gates before deployment

On an operator-approved disposable pinned checkout, apply the manual Rust overlay and run source/Node tests locally:

\`\`\`bash
node --test tests/coop-rust-corp-mining-sell-patch.test.mjs tests/coop-player-mining-corp-sell-rust-bridge.test.mjs tests/coop-player-mining-corporate-sell-custody.test.mjs
node scripts/coop-rust-corp-mining-sell-patch.cjs --code-path /path/to/EveJS/Code --dry-run
# After auditing the diff, operator applies --code-path ... (no dry-run)
cd /path/to/EveJS/Code/externalservices/market-server
cargo test
\`\`\`

Only a disposable world: confirm Rust prepared order stays **invisible**, original corporate ore has the same owner/item/cargo IDs, \`VerifyCorpSellEscrow\` refuses mismatches, unknown ACK never triggers a second operation, and \`PublishCorpSell\` is **always blocked**. Disable flags and reverse source overlay if any native invariant breaks.

## E2B3 still needed before real ISK sales

1. Rust **claim/release/finalize of corporate full and partial order fills**, with original orderbook volume and immutable fill generation; no stock buyer credit/debit shortcut.
2. One native GameStore atomic transaction for exact original buyer wallet debit, corporation seller wallet credit, broker tax and fees, and partial corporate escrow item custody/identity. No second sale after ACK uncertainty, no per-item duplication.
3. Only then implement and enable a truly guarded \`PublishCorpSell\`, invalidate native orderbook caches, validate cancellation/expiry with unfilled remaining quantity, and prove restart recovery.
4. After actual filled and accounted sales, compute a scoped corporate P&L from genuine earnings minus actual payroll, ore purchases and taxes/fees. Complete two-client original gameplay acceptance and integrate PR #287 against the moving \`main\`.

**Security:** never use example tokens as real credentials; never expose this unsupported game server beyond loopback. Do not enable on preserved game data.
