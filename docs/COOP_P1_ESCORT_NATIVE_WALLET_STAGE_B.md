# COOP-ESCORT Stage B — native EveJS escrow and two-player wallet transaction

**Draft infrastructure, not a playable contract release.** This branch is stacked on PR #54 (GameStore atomic-row bridge). It implements the missing `nativeFunds` adapter required by PR #64 (Escort Contract settlement fence), but the two branches have **not** been integrated, and no deploy flag or live runtime hook is installed.

## Pinned native schema and ownership

Inspected `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`:

- Native player wallet is `characters[characterID].balance` with a `walletJournal` on the existing SQLite-backed `characters` table.
- Native corporation cash division is in the `corporationRuntime` table, split by `sqliteStore` into the actual row key `corporations\\u001f{corporationID}`, under `wallet.divisions["1000"]`.
- `coopGameStoreAtomic.cjs` already owns the same SQLite connection with `BEGIN IMMEDIATE`, GameStore worker reconciliation, and cache synchronization. This PR extends its allowlist to **characters**, with character row replacement after commit so `characterState.getCharacterRecord()` does not return a stale memoized normalized wallet.
- Native escrow receipts are held as a **co-owned additive row** `corporationRuntime.coopEscortEscrows` (version 1, bounded to 512 entries), in the **same** SQLite-backed GameStore table as the corporate wallet. No independent JSON wallet, virtual credits, newly minted funds, new client items or market-seed stock.

## Atomic lifecycle

1. `reserveAtomic(contract)` validates the NPC corporation, both ordered real character rows, existing native division #1000 balance and an original manifest identity. Within **one** native GameStore transaction it subtracts ISK from the corporation's existing wallet, appends a native-shaped corporate journal record and creates a durable keyed `RESERVED` escrow receipt. Repeating the contract or using the same manifest under another contract fails.
2. `verifyReservation(contract)` reads the authoritative escrow from native SQLite, not an in-memory promise. It rejects wrong identity and corrupt records.
3. `settleAtomic({contractID,corporationID,amountISK,credits})` consumes only an existing exact `RESERVED` escrow, credits both exact native character wallet rows and appends both character journal entries, and changes the escrow to `SETTLED`. **Both credits and the escrow state share one SQL COMMIT.** No separate wallet service calls.
4. `verifySettlement(contract)` uses the committed native escrow to confirm two exact recipients, amount, immutable contract identity and consumed escrow. It never re-awards on retry.

The existing Stage A contract journal (PR #64) still controls transitions and blocks ambiguous results. **No automatic refund or escrow release** is included; failed, abandoned or lost convoys remain reserved pending a separate safe refund design. A successful client-visible operation also needs native wallet change notifications and confirmation of the real client balances; those notifications are **not yet wired**.

## Feature guards and supported scope

- Requires `EVEJS_COOP_NATIVE_ATOMIC_ROWS=1` **and** `EVEJS_COOP_NATIVE_ESCORT_WALLET=1`; both default OFF. Direct use of the adapter is also blocked unless supplied with a genuine trusted `gameStore.coopAtomicNativeRows` provider.
- Adapter is **not installed** by the overlay, no production installer, PowerShell deploy flags or native hooks are added.
- One immutable trip/one hauler, one corporation, two ordered characters, integer even positive ISK reward `<= 1,000,000,000`, 50/50 credits, zero implicit balance defaults.
- The corporate balance must actually be funded via an authorized native income path; starting an NPC contract does not top up funds.
- Same-transaction corporate debit, native escrow receipt, character credits, ledgers; any validation failure or thrown SQL mutation is rolled back by the trusted GameStore bridge.
- Wallet transactions and standard bounded wallet journals are native-shaped. Durable escort transaction identity remains the **contract ID + escrow record**, not a bounded display journal that can rotate.

## Local isolated evidence

`node --test tests/coop-escort-native-funds.test.mjs`: **12/12 PASS** on disposable file-backed `node:sqlite`; covers exact balance conservation, all-or-nothing dual credit, insufficient native funds, cross-contract manifest replay, escrow corruption, mismatched recipients/amounts, duplicate payouts, default-off flags, and reopening SQLite.

The direct `coopEscortNativeFunds.cjs` code was tested with a **transaction-compatible fixture provider**, not the actual pinned `better-sqlite3` GameStore adapter. No full upstream tests, Docker, persistence worker, real NPC corporation source, native source compatibility installation, game client wallet display or power-loss injection were performed here.

## Next implementation and acceptance gates

1. First merge or coherently compose PR #54 and this PR. Add trusted server-only `createEscortNativeFunds({atomicRows:gameStore.coopAtomicNativeRows,isNpcCorporation:corporationState.isNpcCorporationID})` construction after the native persistence worker has bootstrapped; do not accept wallet authority from clients.
2. Compose with PR #40 → #59 → #64 and independently #48 → #53, retaining all newer L2 installer registrations and deploy switches.
3. Add **pre-warp** funded offer/accept gate, durable terminal `DELIVERED` event, real client wallet change notifications and an explicit reserved-fund refund policy for failed/lost contracts.
4. On a backed-up disposable server run the real pinned `better-sqlite3` worker and restart tests: corporate wallet, both character wallets, concurrent transfers and uncertain COMMIT, GameStore cache, client-visible balance and native journal.
5. Only after a real two-client accepted run and rollback proof enable a separate production flag.

**Safety:** No Github Actions, no `main` merge, no Docker restart, no live `evejs-data` modifications, no real ISK transfers in this PR.
