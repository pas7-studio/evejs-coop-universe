# CHAT-30 — Native contracts, escrow, wallets and paid jobs

**Status:** CODE_READY / INTEGRATION_PENDING_CHAT01 / LIVE_TWO_CLIENT_UNVERIFIED.
**Pinned upstream:** `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` (2026-10-25).
**Safety:** No live `evejs-data`, market.sqlite, NPC jobs, client binary or transition runtime altered.

## Native support reality (no imaginary services)

- `server/src/services/_other/contractMgrService.js` exposes stubs. Existing repo `scripts/coop-native-contract-routing-patch.cjs` optionally aliases it to genuine `contractProxy` with `EVEJS_COOP_NATIVE_CONTRACTS=1`. Do **not** add a parallel RPC service or duplicate contract state.
- `server/src/services/_other/contractProxyService.js` + `services/contracts/contractRuntimeState.js` actually support native **item exchange** and **courier**: real itemStore custody and sealed courier package (typeID 3468), real personal/corporate wallet debits, reward and collateral escrow, native acceptance/completion/failure, cancel and expiration checks. Existing courier actor-authorization patch is left intact.
- `Handle_PlaceBid` and `Handle_FinishAuction` in pinned proxy are stubs; auction creation is refused by `ensureSupportedCreateInfo`. **Auctions are NOT implemented.** Do not advertise auction payouts or create artificial bids.
- `server/src/_secondary/express/gatewayServices/freelanceGatewayService.js` currently provides mostly empty response fallbacks, not funded job creation and payout. **Native Freelance Jobs are NOT implemented.** The existing co-op `/jobs` board is a different, backed NPC Event/Escort workflow, not a Freelance replacement.
- Existing `integration/coopNpcJobBoard.cjs`, `coopEscortNativeFunds.cjs`, `coopEscortContractSettlement.cjs`, volunteer receipts and verified refund logic remain the sole authority for native NPC escort jobs. This change does not create free ISK, shadow balances or a second payout path.

## Confirmed P0 risk

Original `contractRuntimeState.createContract`, `acceptItemExchange`, `acceptCourier`, `completeCourierContract`, `failCourierContract`, and `deleteContract` perform sequential itemStore/corporate-or-character wallet/contractRuntime mutations, **not one atomic transaction**. Example: native `completeCourierContract` moves real items, removes the plastic wrap, credits real collateral and reward, then saves status FINISHED. Process death after one step can leave a genuinely changed wallet/stock and the old status, making a blind replay dangerous. A valid contract status alone does **not** prove custody or wallet transfer. We cannot claim crash-atomicity without a native SQLite cross-table transaction with cache synchronization.

## Added guarded operation path

`integration/coopNativeContractMutationFence.cjs` is a **strict optional safety companion**, not an alternative native contract engine. A reversible patch `scripts/coop-native-contract-mutation-fence-patch.cjs` gates the five existing `contractProxy` native method calls with `EVEJS_COOP_NATIVE_CONTRACT_MUTATION_FENCE=1`, default OFF. It leaves their original arguments, return shapes, service alias and native implementations intact.

- For one authenticated native character and one exact request/contract ID, derive a bounded deterministic operation key; `wx`-lock its contract scope and fsync both file and directory.
- Save immutable `PREPARED` receipt **before** any actual native item or wallet action. Same operation replay, existing lock or unfinished receipt refuses mutation. No automatic retry or lock removal after ambiguous outcomes, including restart.
- Call the original `contractRuntimeState` once. Re-read native `contractRuntime`, native itemStore escrow/wrap/owner/quantity/locations, original character wallets, and require the exact expected wallet balance delta in **integer ISK cents**.
- Require successful original GameStore `flushTableSync` for `items`, `characters`, `corporationRuntime`, `contractRuntime`, then re-read and verify the same item/contract/wallet state. Only then fsync `COMMITTED` and release the writer lock. A failed read, flush, or success acknowledgment stays quarantined.
- For item exchange, verify offered physical item owner/quantity after transfer and exact buyer price / seller proceeds / reward delta. For courier, verify physical wrap, original cargoID/itemID, real accepted owner, destination custody and exact collateral/reward movement. Issuer cancellation must return physical items and native reward escrow.
- **Strict personal character mode only**: corporate item-contract issuance/acceptance/completion/delete is blocked until original corporation director permission scopes and wallet divisions have separately proven authoritative roles. Native bulk delete is blocked to prevent ambiguous partial-success retry. These are supported upstream but deliberately fail closed when this extra feature is ON; original behavior is unaffected with flag OFF.

### Integration contract for Chat 01 (central installer owner)

1. Copy `integration/coopNativeContractMutationFence.cjs` to `server/src/space/coopNativeContractMutationFence.js` through the existing one-owner, byte-identical deployment manifest. Source file MUST remain within the pinned overlay and never be added to an independent installer.
2. Add the original file `server/src/services/_other/contractProxyService.js` as an L1 native spec. Compose `scripts/coop-native-contract-mutation-fence-patch.cjs:patch` into existing `transform()` **after** verifying the original pinned upstream. The helper patches only the five native entrypoint **call expressions** in the original proxy. Apply twice is idempotent; remove is byte-exact and newline-independent.
3. Do **not** alter `scripts/coop-native-contract-routing-patch.cjs`, the original contractRuntimeState patches, the NPC Job Board or escort wallet modules. This gate layers on top of existing `EVEJS_COOP_NATIVE_CONTRACTS=1` rather than replacing the alias.
4. Do not enable the new flag without operator-approved **disposable** private GameStore copy, positive permissions and honest 2-client tests. Set `EVEJS_COOP_NATIVE_CONTRACT_FENCE_ROOT` to an absolute, backed-up server-local directory **not** within a client-uploaded or network-served path. Use one original GameStore writer process, one shared journal path, no unverified symlinks.
5. Perform pinned `--dry-run`, `--check`, native source apply/reapply/remove/roundtrip, full `node --test` suite and two real EVE clients in private loopback environment. Do not run GitHub Actions or CI.

### Important limitations

- `PREPARED` is a **crash fence**, not a 4-table SQL transaction. A crash between native item movement and wallet debit can still leave a partial result, which is quarantined for **manual native inventory/wallet/journal reconciliation**. No automatic rollback, bonus, refund or second grant.
- File-system fsync is not cross-database atomicity. Concurrent independent GameStore writers are unsupported. Another unguarded RPC path or unchecked administrative write can bypass this proxy; audit all authority entrypoints before production enablement.
- The strict ledger expects no concurrent independent character wallet write during one synchronous contract RPC. An external competing wallet change forces reconciliation, not a fabricated success.
- Source-provided serialized input is normalized through existing native `normalizeContractInfo` before computing its fingerprint, so real EVE marshal dictionary instances do not need to be plain JS objects. Repeated same-input creation is intentionally blocked until operator review, including a legitimate desire to create identical contracts.
- This change does **not** implement auctions or Freelance; it does **not** prove any actual client, real SQLite, two-character gameplay or expiry scheduler. There is no real-world acceptance proof until separate local run evidence exists.

## Verified source and local tests

- Exact pinned `contractProxyService.js` contains each of the five call anchors **once**. Read-only source transform apply/remove is byte-exact and preserves the existing native `contractProxy` entrypoints.
- Locally: `node --test tests/coop-native-contract-mutation-fence*.test.mjs` — **19 PASS, 0 FAIL** on Node 22.16.0, using real disk fsync journals, injected native-shaped item/wallet/contract stores and simulated crashes. Covers both independent actors, price+reward and collateral flows, cargo custody, failed source/credit, duplicate attempts and restart quarantine. This is **isolated fixture evidence**, NOT native SQLite or live world evidence.

### Remaining required physical two-client scenarios

See `tests/scenarios/chat30-two-player-native-contracts-e2e.json`; all `NOT_RUN`. Must confirm actual auth and permissions; issue an item exchange with both paid price and escrow reward, accept with another client and verify physical item and two native wallets. Then issue courier: real package moved by B to destination, complete, verify original item IDs, collateral release and native reward exactly once. Repeat after reconnect and after killing server between each mutation. Also prove an expired offer cannot be accepted, issuance doesn't double-debit, cancelled escrow returns only original items, unsupported auction/Freelance endpoints reject honestly, and existing `/jobs` escort refund/duo payouts remain unaffected.
