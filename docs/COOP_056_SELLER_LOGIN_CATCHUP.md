# COOP-056 — Native seller reconnect notification catch-up

**Draft / flags default OFF.** Builds on COOP-055 seller UI notifications. All operations are strictly on the server side; no player slash command, order mutation, wallet credit, or secondary market system is added.

## Problem solved

In COOP-055 an offline seller was not marked notified. Without a login hook, the existing GameStore receipt remained durable and the market/wallet state was correct, but the client would not automatically receive a missed `Filled` event when the seller returned.

## Native, bounded on-login implementation

1. Added `notifyPendingForSeller({sellerID,maxNotifications=4})` to `coopNpcMarketCompletionNotify.cjs`. It reads the actual native GameStore `npcMarketFills` table in a single read-only atomic transaction. Only the selected seller's unclaimed, internally valid paid receipts are candidates.
2. The scan rejects more than **20,000 total receipts** or **128 eligible seller receipts** (explicit fail-closed caps). Candidate order is oldest committed first; at most **4 per login** by default, configurable per call from 1 to 8.
3. Every candidate invokes existing `notifyCommitted`, which independently rechecks the original immutable receipt, Rust `FILLED + finalized + price_history` witness, actual `GetOrder` owner/price/quantity, session ownership, and current native wallet, then atomically claims only the UI event.
4. Added server-only `notifyPendingSellerOnLogin(characterID)` with an in-flight seller-ID fence and lazy dependency initialization. The function handles market/GameStore failure without interrupting character login or modifying settlement.
5. Updated the **reversible pinned EveJS overlay** to add an opt-in, deferred callback immediately after `sessionRegistry.indexCharacterSession` binds a verified live character session. This does not add a poller or background interval, and it does not expose a gameplay command or HTTP endpoint.
6. **Extra flag required:** `EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP=1`; both `EVEJS_COOP_NPC_BUY_NOTIFY=1` and the existing native GameStore/market feature flags must also be ON. All default OFF; do not enable in the protected `evejs-data` world without disposable E2E.

## Player experience

- Player A lists a real item; NPC corporation buys it while A is offline.
- Original item transfers to native NPC hangar, native ISK and sales tax settle, Rust market price history is recorded exactly once; no message is claimed because A has no live session.
- When A reconnects, the server looks up up to 4 unclaimed receipts for **A only** and sends native `OnOwnOrdersChanged(Filled)` and `OnAccountChange` using the **current** wallet balance.
- Player B (another client) receives neither A's order nor A's account update.
- Second login or duplicate ACK does not repeat a previously claimed message.

## Delivery semantics / remaining limitations

This is an **at-most-once send attempt**. A client crash after the durable notification claim but before rendering can still lose an event. Refreshing authoritative market history/order/wallet remains the fallback; this is not an acknowledged durable messaging queue.

The on-login scan is bounded but uses a full GameStore receipt scan; for very large universes introduce an indexed SQL query rather than disabling safety limits. Market/Rust outage during login leaves receipts unclaimed; no timer retries in the background.

Existing real two-client gameplay E2E and real separate-process crash tests remain **NOT_RUN**. The patch does not enable trading or authorize the recovery API. It only adds a server-origin notification read path and an optional UI event stamp.

## Test coverage

- Five new seller catch-up scenarios: offline → login, deduplication, observer privacy, independent feature-flag gate, invalid/burst limits.
- Two new pinned-overlay contract tests: reversible session-registry hook, no polling timer, bounded and opt-in catch-up.
- COOP-055's existing seller notifier tests also cover Rust proof, escrow owner, native tax, cross-transaction receipt swaps, concurrent duplicate sends, seller/observer event isolation and failed sockets.
- Standard gate: `pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests`; disposable pinned Rust compile/test and overlay reversibility via GitHub Actions.

**Acceptance:** disposable world with 2 live clients, NPC buys real escrow while seller offline, reconnect sends exactly one event to seller only, and no second ISK/item/history mutation.
