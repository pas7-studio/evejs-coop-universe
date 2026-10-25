# COOP-052 — Exactly-once native market history for NPC purchases

**Draft, flags OFF.** Stacked after COOP-049/051 in PR #120. Real NPC buyer already debits the corporation and credits the player (gross/tax/net) in a single GameStore SQLite transaction; Rust's `FinalizeNpcCorpPlayerSell` closes the independently durable market order.

## The source bug

Stock EveJS `RecordTrade` increments `price_history.volume` and `order_count` on **every RPC**. Invoking it after an NPC buy, independently of Rust finalize, would duplicate market volume when the acknowledgement is lost and the coordinator retries. `recordTrade` itself cannot provide an idempotency key.

## Fix

- Extended `rust/coop_npc_corp_buy_player.rs` to create `coop_npc_corp_buy_history` with unique `claim_key`, `fill_id` and `order_id`.
- The **same SQLite transaction** changes Rust market order `settling → filled`, records the precise native `price_history` daily OHLC/weighted price/volume/order count, persists history receipt, then transitions the claim `claimed → finalized`. A failed step rolls back **all** Rust-side changes.
- Replaying an already-finalized claim **returns the same receipt** and never calls RecordTrade or changes the price history again. A legacy finalized claim with **no receipt** is rejected for manual reconciliation; no silently fabricated history.
- Rust Claim/Inspect/Finalize return `history_recorded` and `history_day`. The GameStore buyer refuses to claim paid **SUCCESS** until both Rust finalize and subsequent inspect agree on a durable history witness.
- Added four Rust real `rusqlite::Connection::open_in_memory()` regression tests for one buy, two weighted buys, duplicate replay and rollback; added JS replay/missing-proof regressions.

## Native safety and limits

This fixes **Rust-side** idempotence; the Rust database and GameStore remain two distinct durable stores. The write-ahead `PREPARED` claim key bridges them, but operator reconciliation of stale lock files and an unclean process crash across stores is still a separate gate. No claim that a fully distributed transaction exists.

No tests run against the protected user's `evejs-data` volume. Live two-client market gameplay remains **NOT_RUN**, and the parent Draft PR currently has conflicts targeting `main`.

## Local and GitHub CI

`pwsh -File scripts/Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests` covers the Node A-Life/SQLite suite. `.github/workflows/coop-native-economy-gate.yml` checks out the **pinned EveJS** into a disposable directory, sequentially patches COOP-034/035/047/048 Rust, compiles and runs `cargo test --locked --all-targets`, and checks reversible overlay removal. Four new Rust tests are picked up by this cargo test.

Acceptance for history: each successful NPC-to-player `fillID` must produce exactly one Rust `coop_npc_corp_buy_history` row and one unit change to daily `price_history.order_count`; a lost ACK or duplicate RPC must leave these totals unchanged.
