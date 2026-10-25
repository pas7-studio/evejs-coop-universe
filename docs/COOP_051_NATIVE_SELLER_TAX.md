# COOP-051 — Native Player Seller Tax Parity in NPC Corporate Buy

**Status:** Implemented in the Draft chain; all feature flags default **OFF**. No production data or Docker volume modified.

## Source of truth

Pinned upstream `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, `Code/server/src/services/market/marketRules.js` and `marketProxyService.js`:

- Ordinary sell settlement computes `sellerMarketContext = buildCharacterMarketContext(null, sellerCharacterID, stationID)`, then `computeSalesTaxAmount(sellerMarketContext, grossAmount)`.
- The market tax base is 8%, reduced by Accounting skill (`0.11` per level) and eligible location discounts. It is a **sink**: player receives gross market credit followed by a separate transaction-tax wallet debit. **Structure broker fee** is a distinct order-placement charge, not a second sales-tax recipient.
- Existing EveJS `JOURNAL_ENTRY_TYPE.MARKET_TRANSACTION=2`, `JOURNAL_ENTRY_TYPE.TRANSACTION_TAX=54`.

## COOP-051 code

- `integration/coopNpcSellerTaxAuthority.cjs`: computes an authoritative tax quote using the *installed EveJS* `getMarketContext({characterID:sellerID,stationID,session:null})` and `computeSalesTaxAmount`; verifies seller/station identity, native rate range, nonnegative cent-exact tax, gross cap; rejects missing context rather than falling back to zero tax.
- `integration/coopNpcBuyerNativeBindings.cjs`: loads `../services/market/marketRules` in deployed server and injects its real functions into the existing native GameStore buyer. Unit tests inject a compatible rule implementation; deployed code never uses hardcoded 8%.
- `integration/coopNpcCorporateBuyerAtomic.cjs`: same **five-table GameStore SQLite transaction** now records corporate gross debit, player gross market credit, native player sales-tax debit (54), net seller balance, moved original item and immutable `npcMarketFills` receipt with `grossCents,taxCents,netCents,taxPolicy`. The tax journal uses a deterministic second transaction ID. Existing receipt prevents a second credit, charge or item move after Rust ACK loss.
- `scripts/patch-evejs-coop.cjs`: installs seller tax authority into pinned `.js` runtime as part of the reversible integration overlay.

## Financial conservation example (no Accounting or location discount)

| Account / sink | Before | Movement | After |
|---|---:|---:|---:|
| NPC corporation wallet | 1,000.00 | -25.00 | 975.00 |
| Player seller wallet | 100.00 | +25.00 -2.00 | 123.00 |
| Native transaction-tax sink | 0.00 | +2.00 | 2.00 |

**Accounting identity:** `grossBuyerDebit = netSellerCredit + taxSink` (`25 = 23 + 2`). Sale never mints extra player ISK. If native context yields an effective zero-cent tax, no fake tax journal is created.

## Actual CI

[GitHub Actions Node/SQLite, COOP-051](https://github.com/pas7-studio/evejs-coop-universe/actions/runs/40227811263) — **344/344 tests PASS**, including real Node `node:sqlite` seller tax, atomic rollback, ACK replay, cross-module bridge and native tax quote. Rust compilation of pinned overlay is a separate job in the same workflow. A previous pinned Rust build also passed.

**E2E NOT_RUN**: real two-client gameplay, actual market history event reconciliation, physical corporate stock arriving in factory after purchase, simulated cross-DB process crash, Docker deployment. The native player-to-NPC buyer still supports only one verified full remaining escrow stack.

## Remaining production guardrails

- Do not enable `EVEJS_COOP_NPC_BUY_PLAYER_ASK` or A-Life ACT on the protected persistent `evejs-data` until two-client conservation and structure station tax/broker-fee parity are verified.
- Tax calculation reads the real installed skill/location context synchronously inside GameStore commit. If the native context cannot be resolved it fails closed. A Rust order may remain `SETTLING` after failure; reconcile the **same durable claimKey** rather than creating another purchase.
- Confirm that sale history and notifications are recorded once; the new protocol does not yet call stock `recordTrade` and cannot claim complete market-history/UI parity.
- Handle stale coordinator lock files by operator reconciliation of Rust claim, GameStore receipt and durable journal; do not silently delete or regenerate claims.
