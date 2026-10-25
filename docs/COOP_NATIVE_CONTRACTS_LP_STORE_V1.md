# Co-op contracts + native LP Store — implementation / acceptance (2026-10-25)

**Scope:** first slice of the native EveJS mechanics gap audit. **Upstream pin:** `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. **Working branch:** `feat/npc-personal-memory-20261024`, [Draft PR #2](https://github.com/pas7-studio/evejs-coop-universe/pull/2).

## Current delivery

| Operation | Delivery | Evidence / next gate |
|---|---|---|
| A's authentic EVE client calls `contractMgr` → real `contractProxy` | **IMPLEMENTED as opt-in source route**, no synthetic contract records | `scripts/coop-native-contract-routing-patch.cjs` aliases after both services register; `machoNet` advertises `contractProxy` only when enabled. Two real clients still needed. |
| Character-to-character item exchange | Native `contractRuntimeState` supports actual escrow and itemStore/wallet transfer | Route now available; **not yet live accepted**; stock mixed item/ISK processing is not crash atomic |
| Native courier delivery | Native `contractRuntimeState` creates real sealed package, collateral/reward escrow, destination completion | Route now available; native own package movement/settlement must be tested with two clients |
| Third-party courier `Complete/Fail` | **GUARDED**: session must match accepted individual character or corporate owner ID and saved acceptor wallet | `scripts/coop-native-contract-routing-patch.cjs`. Ownership guard remains active even when routing flag is OFF, to protect direct `contractProxy` calls. Corp member roles are NOT additionally verified. |
| LP Store purchase (LP + ISK + input items → native goods) | **ALREADY NATIVE** via `LPStoreMgr.Handle_TakeOfferForCharacter` and `takeStaticOfferForCharacter` | No co-op wallet or free item grants; do not confuse this with stub `LPSvc.Handle_TakeOffer`. Actual client purchase unverified |
| LP Store faction/corp standings prerequisite | **IMPLEMENTED as opt-in read-only native standings gate**, checked before first LP/ISK/item mutation | `integration/coopNativeLpStandings.cjs`, `scripts/coop-native-lp-standing-patch.cjs`; effective standings from `character/standingRuntime.getCharacterEffectiveStanding` |
| LP Store bulk quantity | **GUARDED in overlay**: max 100 offers per request and safe integer requirement | Prevents enormous mass grants. Applies regardless of LP-standings flag, with native error message |
| Native gold/LP/reward double-spend after abrupt crash | **NOT DONE / BLOCKER** | Native upstream writes itemStore/wallet/contract records in sequence without a global transaction. Requires durable transaction receipt/outbox or rollback/recovery before broad deployment |

## Why there was no need to rewrite contracts or LP

In the pinned EveJS stock source:

- `server/src/services/_other/contractMgrService.js` creates a service named `contractMgr`, but important RPC handlers are empty/stubs.
- `server/src/services/_other/contractProxyService.js` creates `contractProxy`, with real `Handle_CreateContract`, `Handle_AcceptContract`, `Handle_CompleteContract` backed by `contracts/contractRuntimeState.js`.
- `server/src/services/machoNet/machoNetService.js` announces `contractMgr` but not `contractProxy` in the initial service list. `serviceManager` supports aliases, so opt-in routing is a small, reversible improvement.
- `server/src/services/evermarks/lpStoreMgrService.js` already has an actual purchase operation. The `LPService` stub is a *different* service and is not evidence that the whole native store is unavailable.
- `loyalty/lpStoreOfferCatalog.js` exposes a `requiredStandings` field for static offers; stock purchase did not enforce it. The new gate recognizes an `{ownerID,value}` requirement, bare numeric requirement for offer corp, pair `[ownerID,value]`, or an array of them; anything unknown fails closed when enabled. Effective standing includes native bonuses.

## Actual files changed

- `scripts/coop-native-contract-routing-patch.cjs` — reversible patch for server startup routing, serviceInfo and courier settlement actor guard.
- `scripts/coop-native-lp-standing-patch.cjs` — reversible patch for LP store standing/quantity checks and errors.
- `integration/coopNativeLpStandings.cjs` — pure, read-only native standing constraint evaluation; gets copied into stock `server/src/space` by standard overlay.
- `scripts/patch-evejs-coop.cjs` — adds four additional native sources to transactional pin-verified patch manifest.
- `scripts/Deploy-Coop-RuntimeProbe.ps1` — adds separate `-EnableNativeCoopContracts` and `-EnableNativeLpStandings` switches.
- `tests/coop-native-contracts-lp-integration.test.mjs`, `tests/coop-native-lp-standings.test.mjs` — source/logic regression tests, wired into `scripts/Verify-Local-Coop.ps1`.

Both deployment switches remain **OFF by default**, even under `-LivingCoop`. This is intentional: an internal contract transfer of real assets is more dangerous than source-only NPC behavior.

## Source checks performed in this agent conversation

Against full files fetched from the **exact pinned upstream commit**, V8 source-level checks passed:

1. `server/index.js`: first patch changes code, second patch changes nothing; single remove returns original bytes, source parses.
2. `server/src/services/machoNet/machoNetService.js`: same.
3. `server/src/services/contracts/contractRuntimeState.js`: same.
4. `server/src/services/evermarks/lpStoreMgrService.js`: same.
5. Both courier completion and failed-completion guards accept original character and reject different character; guard does not rely on alias flag.
6. Native contract alias switches from stub to genuine proxy with flag ON, stays stub with flag OFF.
7. LP standing gate: qualified owner passes, lower real standing fails, unknown requirement fails closed, no requirement passes.
8. LP purchase batch: 1 and 100 allowed; 101 and unsafe huge amounts rejected before debit.

**Limitations:** these are V8 source/logic evaluations in an isolated tool and test files committed for actual Node execution; they are **NOT** proof of `node --test` across the repository, Docker service startup, original game-client protocol, wallet replay safety, or two-player live gameplay.

## Explicit local test (only once user approves deployment)

1. Keep original `evejs-data` and do not reset/reseed it. Back it up and record balances/inventory/standing for BOTH real characters.
2. From co-op repository root (not EveJS `Code`), run source and negative case tests against the pinned EveJS checkout:

```powershell
$env:EVEJS_COOP_CODE_PATH = 'C:\Games\EveCoop\upstream-evejs\Code'
node --test tests/coop-native-contracts-lp-integration.test.mjs tests/coop-native-lp-standings.test.mjs
```

3. Run `scripts/Verify-Local-Coop.ps1` and its original dry-run/rollback of patch plan.
4. **Only with explicit deployment permission and validated volume backup**, set `-EnableNativeCoopContracts -EnableNativeLpStandings` alongside the existing authorized deployment profile (e.g. `-LivingCoop`). The deployment script is not run by the current agent.
5. A: owns actual low-cost, easily replaceable item; A creates a private item-exchange contract for B. B sees it through native client UI, accepts. Validate one item owner/location change and price exactly once, both clients, relog and restart.
6. A creates a low-value courier contract for B at different stations. B accepts, receives native plastic wrap, undocks and manually flies from source to destination, docks and completes. **B** alone gets collateral return and reward; **A**, any unaffiliated third pilot or a duplicate client session must not be able to force `Complete` or `Fail`. Verify exact final wallet+inventory state.
7. A and B each earn real faction LP by individually completing accepted missions. Each attempts a genuine `LPStoreMgr` offer. Check LP, ISK, input items and output item after relog, plus a specific insufficient-standing negative case, with no fabricated SP/ISK/LP.
8. Force controlled failpoints between escrow move, wallet debit, record write and item grant on a **disposable test database**, never the friend's only world. Track orphaned escrow, duplicate payout and compensating actions; finish before declaring the feature production ready.

## Open work and ownership

| Priority | Remaining gate | Suggested owner |
|---|---|---|
| **P0** | Create/accept/complete private item exchange in two stock EVE clients, reconnect and inventory proof | Social/Economy + gameplay QA |
| **P0** | Courier real 2-player haul; no unauthorized Complete/Fail; escrow conservation and crash-recovery | Social/Economy |
| **P0** | Durable idempotent native contract ledger across interruption between item/wallet/record mutations | Finance/Inventory/Contracts |
| P1 | Native LP Store purchase from earned LP; matching standing requirement enforced client/server; actual offer data | LP/Faction agent |
| P1 | Corporate contract issuer/acceptor roles and corporate wallet division checks | Corp/Permissions agent |
| P2 | Auction and bids in native contract proxy are stubs; not promised in this release | Future market agent |

**Definition of done:** log from two distinct authenticated capsuleers, native UI requests, authoritative before/after inventory and wallets, exact one-time LP/item debit and actual game relog/restart. Until then status is **CODE_READY / LIVE_UNVERIFIED**; do not mark gameplay DONE.
