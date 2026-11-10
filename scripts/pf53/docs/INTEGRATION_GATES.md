# PF-53 Original Native Integration Gates

**Candidate only; keep OFF.** All checks must pass on an isolated WORK checkout of `pas7-studio/EveJS` before native wiring.

## Confirmed original sources (GitHub blob SHA-1 identifiers)

| Original source | Blob SHA-1 |
|---|---|
| `Code/server/src/space/coopGameStoreAtomic.js` | `2b28b48145f3fbc989ce7346384487ee75e52280` |
| `Code/server/src/services/account/walletState.js` | `ef4799d896ce8dbb854e75b810057b1208932e13` |
| `Code/server/src/services/character/characterState.js` | `8a002d190899b6cb1e1068a565451e6d1d808401` |
| `Code/server/src/services/corporation/corporationRuntimeState.js` | `1e87597539389567716e75de565519c9cb19a977` |
| `Code/server/src/services/account/plexVaultLogState.js` | `62a03b8578a390f5614fc67b6693ffa74b2b2ee5` |
| `Code/server/src/space/coopPlayerMiningCompany.js` | `9371434b4c80866940e47402505200ea95ec244c` |
| `Code/server/src/space/coopWarFleetRegistry.js` | `d8bce76a9d033bf9c33e22b8b9d26852a23c92ed` |

Original row contract: `characters` / key `characters` is a character-ID keyed object; `corporationRuntime` / key `corporations\u001f<corpID>` owns corporation division 1000 and journals. Exact adapter supports `characters` and `corporationRuntime` in one SQLite transaction. Stock `walletState` journal is newest-first, capped 100; corp journals are capped 100/2000. No extra wallet table is created.

## P0 acceptance gates

1. An original player wallet owner confirms `characters/characters` current raw rows and accounting/cache invalidation on WORK. The new path cannot run alongside un-fenced `setCharacterBalance`, market transfers or stock corp wallet changes.
2. Original NPC Agent offer source must provide signed/server-authenticated `offerID`, `revision`, `ownerCharacterID`, `pilotID`, `contractID`, `agentID`, `employerCorpID`, integer `amountCents` and expiry. The **current native mining corporate-shift hire is not a personal NPC employment contract** and may NOT be reused as one.
3. Existing original named pilot must be proven with the actual native identity source, not an arbitrary `coop-pilot-123` string or a synthetic `npcEntities.pilots` test row. Availability must be fenced against all competing actor writers.
4. Native company recipient is independently verified as an original NPC employer. The injected `originalTransactionID` uses the original wallet ID owner and `verifyJournalID` checks global collisions; the durable PF53 key reserves it for this feature.
5. `pf52` adapter must be exactly shared with PF52; this is NOT a new second roster. Confirm replay, transaction recovery, observer notifications, race tests with real ItemStore move/sell/trade/dock and end-to-end original wallet UI balance change.
6. Run actual original GameStore with `PRAGMA synchronous=FULL`, `BEGIN IMMEDIATE`, internal cache invalidation and a real WORK SQLite file; force SIGKILL at each original row write boundary, including post-commit cache refresh; confirm no double ISK.
7. Only when all reciprocal original wallet, inventory, WAR, Mining, Exploration and spawning writers enforce the ownership authority may `allWalletWritersFenced` ever return true. Otherwise default OFF and block all paid hires.
8. Test with two genuine player sessions and an original NPC Agent: Offer -> PAY -> original wallet journal -> PF52 roster -> native itemID hangar assignment. Then verify deployment, payroll, orders, loss and docking separately; these are **not implemented by PF53**.

## Scope limits

- Direct `characters`/`corporationRuntime` writes through in-process original GameStore are only safe once stock single-writer owners are migrated to reciprocal atomic transactions. A standalone mock's success **does not prove** this.
- `notifyOriginalWallet` runs after COMMIT; failure cannot be compensated by another debit. Resynchronization is required; no background retry is promised.
- The original `getTransactionID()` is time/random based, not a mathematically collision-free global allocator. A native uniqueness verifier is required.
- The `deps/pf52-reference-hangar.cjs` copy is only a test fixture. Shipping it as a second live roster authority would be a P0 bug.
- Keep Personal Fleet OFF, PF42 restriction, PR #350 Draft. Do not run GitHub Actions, deploy to PLAY, or merge to main.