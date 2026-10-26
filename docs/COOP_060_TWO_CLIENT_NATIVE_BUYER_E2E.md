# COOP-060 — Native NPC buyer end-to-end acceptance

## Automated backend E2E (real SQLite, Rust RPC simulator)

Run on an isolated developer machine with Node 22+:

```bash
node --test tests/coop-npc-buyer-two-session-sqlite-e2e.test.mjs
```

`tests/coop-npc-buyer-two-session-sqlite-e2e.test.mjs` creates a fresh temporary on-disk SQLite database with real `corporationRuntime`, `characters`, `items`, `marketEscrow` and `npcMarketFills` rows. It executes the production `createNativeNpcBuyerBindings`, `createNpcCorporateBuyer`, `createNpcBuyerCoordinator`, `createNpcMarketCompletionNotifier`, native SQLite writer, cross-database audit and `createLocalNpcBuyerRecoveryControl` (signed loopback HTTP). It also exercises two separately keyed simulated client sessions, SELLER and OBSERVER, and verifies that the observer never receives the seller's wallet or order notification.

**Important qualification:** native Rust `GetOrder`, `GetOrders`, `ClaimNpcCorpPlayerSell`, `FinalizeNpcCorpPlayerSell` and `GetNpcCorpPlayerClaim` are handled by a persistent **protocol simulator**, with state in a second temporary file. This tests crash boundaries and contract semantics but does NOT launch the actual Rust market daemon, load its production SQLite database, or render a real client. The on-disk SQLite GameStore is real. No existing `evejs-data` file or Docker volume is touched.

Covered automated scenarios:

- Real SQLite full-stack sale with seller and independent observer sessions: original item, corporation gross ISK, player net ISK, tax, Rust-protocol history count, durable receipt and order/wallet events.
- Seller offline during purchase; restart SQLite connection; reconnect and send missed notification exactly once only to the seller.
- Rust finalize lost ACK with real SQLite COMMIT and PREPARED journal; ordinary A-Life tick must refuse replay; authorized same-key journal ACK after restart must not debit or mint again.
- Wrong operator recovery action must leave journal PREPARED and wallets/items/history unchanged.
- Wrong seller escrow and insufficient NPC wallet fail before any money or history transfer.
- Missing Rust history evidence after payment must block reconnect notification without corrupting already paid GameStore rows.
- Real host-loopback HTTP HMAC audit ticket → operator approval → `recoverApproved` → same-key settlement, with one-time replay and fsynced operator audit log.

## Actual live game E2E: separate mandatory acceptance

The twelve scenarios under `tests/scenarios/coop-060-native-player-seller-live-e2e.json` are intentionally `NOT_RUN`. They require **two actual independently authorized clients**, a disposable native EveJS world and the **real pinned Rust market daemon**. They include real order creation, claim, physical source item custody, ISK/tax accounting, verified market history, live seller/observer notifications, reconnect and separate Rust/GameStore process crash/restart. Capture every item ID, wallet/escrow/market-history delta and operator log from the disposable world.

Never run mutating tests on your existing `evejs-data` volume. Keep all native trading and operator recovery feature flags disabled in permanent-world configuration.

## CI and merge gates

`.github/workflows/coop-native-economy-gate.yml` has been restored with two isolated jobs:

1. Node 22 `node:sqlite` preflight; direct COOP-060 backend E2E; complete `Run-Alife-Economy-Tests.ps1 -IncludeExistingEconomyTests` and 12-scenario `NOT_RUN` honesty gate.
2. Exact `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` checkout, sequential reversible Rust market overlays, `cargo test --locked --all-targets`, and removal verification. This does **not** claim real networked Rust/gameplay E2E.

Merge this test PR only once the two actual GitHub jobs PASS on its exact SHA; then repeat the workflow on merged main and collect manual-world evidence before enabling native trades. Unrelated faction-warfare and living-world draft PR stacks remain separate integration domains and should not be blindly mass-merged.