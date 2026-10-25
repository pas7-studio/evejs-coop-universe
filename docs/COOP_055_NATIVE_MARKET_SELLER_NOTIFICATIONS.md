# COOP-055 — Native NPC market seller UI notifications

**Status: Draft, all trading flags OFF.** Stacked after COOP-054 → #132 → #130 → #127 → #120. Does not change `main`, the live server, or the protected `evejs-data` volume.

## Source-backed protocol

The pinned upstream EveJS `marketProxyService.js` uses `OnOwnOrdersChanged` with `"charid"` scope, `[buildList([buildKeyVal(order)]), "Filled", 0]` to inform the **seller** that their order is filled. The pinned `walletState.js` exports `syncWalletToSession` and `emitAccountChangeToSession`, which sends `OnAccountChange` using the player's **current native wallet**, not a fake balance.

## COOP-055 implementation

`integration/coopNpcMarketCompletionNotify.cjs`:

1. Strictly gated behind opt-in `EVEJS_COOP_NPC_BUY_NOTIFY=1`, `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1`, `EVEJS_COOP_NPC_BUY_PLAYER_ASK=1`.
2. Requires the full original `npcMarketFills` receipt with exact `claimKey/fillID`, verified seller, buyer corporation, order, original item, and conserved `grossCents = netCents + taxCents`.
3. Fetches authoritative Rust `GetNpcCorpPlayerClaim` with **FILLED + finalized + history_recorded**, and `GetOrder` with matching **player sell owner, type, station, order, filled quantity and price**.
4. Only when a verified seller is online, reads their **current native wallet**. It never impersonates a session or sends a message to a different character.
5. Atomically stamps `sellerNotifyClaimedAt` and `sellerNotifyProtocol` **inside the existing native GameStore `npcMarketFills` row** before dispatching the transient message. Two concurrent senders cannot both claim the event.
6. Emits the upstream-shaped `OnOwnOrdersChanged("Filled")` and native `OnAccountChange` for the verified seller. It does **not** call the non-idempotent Rust `RecordTrade`, update any wallet, move an item, or change the original settlement receipt identity.
7. `coopNpcBuyerNativeBindings.cjs` invokes the notifier **only after** confirmed successful coordinator `tick()` or operator-approved `recoverApproved()`. An unavailable notification transport never turns a settled paid purchase into failure.

## Delivery semantics and limitations

**At-most-once send attempt, NOT exactly-once display.** A process crash between the durable claim and the session send, or a client disconnect during send, can lose the transient UI event. This avoids duplicate notifications and never causes a second credit, tax, stock transfer or market-history increment. The client can refresh authoritative market orders and wallet; a durable replay/ack protocol for missed transient client events is a future feature. An offline seller is **not** marked notified so a later explicit settlement/recovery notification attempt can be made; the game does not yet schedule a background notification pump.

The operator recovery endpoint is still not exposed to gameplay and requires a separate trusted admin authenticator. Slash commands in the pinned upstream EveJS are a client-exposed surface and must not authorize financial recovery.

## Tests

`tests/coop-npc-market-completion-notify.test.mjs` uses a **real `node:sqlite` transaction**: native seller order and wallet notifications, exact receipt proof, duplicate ACK, offline seller, Rust/history or owner mismatch, untrusted seller tax, network failure, invalid wallet, disabled gate, client disconnect after durable claim, invalid claim ID and no duplicate Rust RPC.

`tests/coop-npc-buyer-native-bindings.test.mjs` also checks two cross-module cases: send **after** confirmed native paid success and no send on rejected A-Life material demand.

All run through `scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests`; Rust pinned upstream compile/test gate remains required. Two-client live E2E is still NOT_RUN.
