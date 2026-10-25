# Native atomic trade — P0 integration / current-main rebase

**Review branch:** `integration/coop-p0-native-trade-20261025`, based on `main` `d1e3450c7f8edce532535475890f8c62883e1b70`.

## Why the original PR #19 cannot be applied mechanically

The branch `fix/native-trade-atomic-items-20261025` independently edited `scripts/patch-evejs-coop.cjs` and `scripts/Deploy-Coop-RuntimeProbe.ps1` before the newer `coopAgentDialogue` integration landed in main. Copying these two files outright would **remove the agent-dialogue module, its native source transform and the operator deployment flag**. PR #15 exploration also changes both files; it remains separate until review.

## Exact resolution

- Start from the **current main** installer and deployment script, not the older trade branch versions.
- Register the `coopNativeTradeAtomic` L2 module as an additional module (do not replace `coopAgentDialogue`).
- Register `server/src/services/inventory/itemStore.js` with the existing L1 spec and invoke the reversible atomic-trade helper for only that file and native `tradeMgrService.js`. Preserve existing native fleet-trade guard, native agent-dialogue hook and pinned SHA checks.
- Add explicit PowerShell `-EnableAtomicCoopTrade` opt-in. It requires `-LivingCoop`; only that explicit switch adds `EVEJS_COOP_ATOMIC_TRADE=1`. Standard LivingCoop is **unchanged and OFF** for native atomic trade.
- Copy from PR #19 only the independent source helper, native module, contracts and documentation. Do not add GitHub CI or a second patcher.

## Validation performed

1. The **actual pinned EveJS SHA** `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, retrieved directly from the upstream source, was used for `itemStore.js` and `tradeMgrService.js`.
2. The individual `coop-atomic-trade-patch.cjs` applied to both pinned files, was idempotent on repeat application and restored **byte-exact original** source after rollback. Both parse after patch: **2/2 PASS**.
3. The **full current-main integrated** `patch-evejs-coop.cjs.transform` with the same pinned files, plus the existing fleet-trade spec, also parsed, re-applied without changes and removed to byte-exact original: **2/2 PASS**.
4. Source-level `tests/coop-native-trade-atomic.test.mjs` from the branch was executed against its real `coopNativeTradeAtomic.cjs` implementation in an isolated V8 harness: **14/14 PASS**, including nested ship/module custody, manifest drift, active-ship rejection, zero-money guard and uncertain flush.
5. All tests above are **isolated JS execution**, not the official Node `--test` binary running in Windows, not a native live trade or actual SQLite durability fault injection. Run the original suites on the authorized pinned checkout.

```powershell
node --test tests/coop-native-trade-atomic.test.mjs tests/coop-atomic-trade-overlay-contract.test.mjs
node --test tests/coop-crossstream-overlay-roundtrip.test.mjs
node scripts/patch-evejs-coop.cjs --check --code-path C:\Games\EveCoop\upstream-evejs\Code
```

## Unresolved P0 acceptance blocker

**An interrupted trade while items are still in the temporary native trade container is NOT recovered by this atomic-completion patch.** Stage custody is already altered before confirmation, and loss of in-memory trade state can strand assets. Before turning this optional mode ON for a real save, implement persistent staging-origin capture and controlled recovery or prove the native upstream already recovers such assets across restart. This must be verified on a disposable cloned volume, never by forced crashes on `evejs-data`.

The new guard also only atomically batches the **items** table. It intentionally **rejects nonzero ISK offers**, because the wallet table and item table are not in one transaction. No claim of crash-safe real money-item trades, EVE UI confirmation or two-client trade PASS is made. No Docker, main, player inventory, market, native SQLite DB or CI was modified by this review.

**Integration rule:** treat this branch as a rebase/superseding candidate for PR #19. Do not merge both implementations independently.
