# Chat 23 / 30 / 37 — post-merge integration, ownership and review handoff

**Date:** 2026-10-25. **Repository:** `pas7-studio/evejs-coop-universe`.
**Pinned upstream:** `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
**Status:** source reconciliation proposed in one review commit; **not deployed or live two-client accepted**. This document is a coordination receipt, not a gameplay PASS.

## Exact original deliveries already on main

| Owner | Original commit | Payload | Reconciliation status |
| --- | --- | --- | --- |
| Chat 23 — native wormholes | [`40b23b7a0f8bf8d4e44318529dee8608202ba76f`](https://github.com/pas7-studio/evejs-coop-universe/commit/40b23b7a0f8bf8d4e44318529dee8608202ba76f) | `integration/coopWormholeJumpFence.cjs`, `scripts/coop-wormhole-jump-fence-patch.cjs`, 2 tests, contract | Already registered in central installer by separate Chat-01 integration (`docs/COOP_CH23_WORMHOLE_INSTALLER_INTEGRATION_20261026.md`). Leave original transition runtime and its owner Chat 06 untouched. |
| Chat 30 — native player contracts | [`98f8f8665a5bf9f64fe07962adaf70eb5e4ecf68`](https://github.com/pas7-studio/evejs-coop-universe/commit/98f8f8665a5bf9f64fe07962adaf70eb5e4ecf68) | `integration/coopNativeContractMutationFence.cjs`, pinned proxy patch helper, 2 tests, contract and acceptance scenarios | Module was in the installer **names** but its native `contractProxyService.js` **spec and transform hook were missing**. This review adds both and preserves the existing `contractMgr` to native `contractProxy` alias and courier actor guard. |
| Chat 37 — SDE and item balance | [`bdb37050bf915ee7984cf317f87dc1714ea272f6`](https://github.com/pas7-studio/evejs-coop-universe/commit/bdb37050bf915ee7984cf317f87dc1714ea272f6) | Correct Small Skill Injector ID `45635`, read-only `scripts/coop-sde-supported-audit.cjs`, 2 tests and compatibility note | Already committed. Intentionally **no static-content import or gameplay flag**; retain ID check and require actual native/2026 SDE snapshots plus client assets/RPC before any SDE update. |

The three original commits were verified to be ancestors of main through GitHub compare, not replayed/cherry-picked. The patch avoids unrelated modules changed by other parallel agents.

## What this reconciliation changes

1. Add `server/src/services/_other/contractProxyService.js` **once** to the authoritative `specs` array of `scripts/patch-evejs-coop.cjs`, with `patches:[]`. This is a native source file in the exact existing pinned tree, not a fabricated RPC.
2. Call `scripts/coop-native-contract-mutation-fence-patch.cjs:patch(text,spec.file,remove)` from the same central `transform()`, scoped ONLY to that contractProxy file. It protects five existing contract mutation call expressions; it is reversible byte-for-byte and has no effect unless `EVEJS_COOP_NATIVE_CONTRACT_MUTATION_FENCE=1`. The original `contractProxy` method and wallet/item custody implementation remain the sole authority.
3. Remove the second registration of `coopCourierRuntime` from the post-42 `names.push(...)` additions. Keep the original entry; do not remove courier functionality.
4. Add `tests/coop-chat23-30-37-reconcile.test.mjs` to assert unique module/spec identities, exact hooks, default-OFF behavior, LF/CRLF apply-reapply-remove, pinned native source when available, and the SDE Small Skill Injector ID.
5. Document module provenance, verification limits, operator steps and review owners here. No Docker volumes, private server listeners, client binaries, SDE archives, NPC escrow or Rust wallet transactions are modified.

## Required sequencing, one central installer

**Chat 01 (central runtime/installer):** Review the new contractProxy spec and transform before merging. Keep the old `server/index.js` / `machoNetService.js` / `contractRuntimeState.js` native contract-routing patch intact. Preserve `coopWormholeJumpFence` native spec and copy mapping. Confirm `names` and `specs` have zero duplicates and all `integration/*.cjs` modules used by names exist. `--dry-run` and `--check` are the only acceptable live-host preflight commands until approval; do not apply to the populated world.

**Chat 06 (shared transitions):** Chat 23 calls original `wormholeMgrService.Handle_WormholeJump` and original `jumpSessionToSolarSystem` with real `anchorType:"wormhole"`. Verify the same native ship identity, actual destination scene and movement handoff; do not replace this with `jumpSessionViaStargate` or rewrite `space/transitions.js` for this PR.

**Chat 30 and Chat 40 (player contracts and transaction reliability):** The optional file-journal fence prevents an uncertain *replay* after an original partial write. It **does not make inventory, characters, corporate wallets and contractRuntime one atomic SQLite transaction**. Reconcile lost ACK and post-crash GameStore state with native wallet and item-store receipts. Keep strict mode default OFF on populated worlds and do not claim exact-once payouts from file fsync alone. New strict mode deliberately rejects corporate contracts and batch deletion until native roles and reconciliation are proven.

**Chat 37 (SDE client compatibility):** Run the read-only auditor against a timestamped *official 2026* JSONL SDE and original native GameStore snapshots before changing any hull, module, ammo, Dogma, skills or market category. `STATIC_DATA_MATCH_CLIENT_UNVERIFIED` is not enough: verify actual older client assets/UI RPC and game implementation per `typeID` before importing changes. The existing `Small Skill Injector` typo is corrected; do not mutate the live skill-injector market to make a test pass.

**Chat 42 (independent QA):** Test actual two clients, real corp escrow, native cargo identities, real wallet changes, native wormhole mass/polarization and reconnect/restart. Separate unit/integration/native-runtime/client observations. No invented PASS or synthetic events.

## Local evidence vs required game acceptance

- Source review on current GitHub main: the wormhole **spec and transform existed**, the contract module had a copied L2 entry but the **contractProxy L1 spec/transform did not**, and `coopCourierRuntime` occurred twice in `names`.
- Prior Chat23/30/37 modules and their six focused Node files: **55 PASS, 0 FAIL** in isolated, local Node 22.16.0 fixture runs on 2026-10-25. Their original earlier test counts (Chat23 19, Chat30 19, Chat37 17) are historical per-package evidence; total 55 is the freshly rerun combined suite.
- This reconciliation's new wiring regression tests should run in the complete repository. An authorized exact-pinned EveJS Code checkout is required for the optional pinned-native roundtrip (otherwise skipped).
- **NOT RUN:** complete official Node test suite in full checkout; native better-sqlite3 worker; actual 2026 SDE-vs-native database; Docker deployment; two authenticated EVE clients; crash/power-loss replay; restarted persisted world. Never describe this PR as a completed gameplay acceptance.

## Reproducible operator-only gates (no remote CI)

```powershell
node --check scripts/patch-evejs-coop.cjs
node --test tests/coop-chat23-30-37-reconcile.test.mjs tests/coop-wormhole-installer-integration.test.mjs tests/coop-wormhole-jump-fence.test.mjs tests/coop-native-contract-mutation-fence.test.mjs tests/coop-native-contract-mutation-fence-patch.test.mjs tests/coop-sde-supported-audit.test.mjs tests/coop-skill-market-seed-id.test.mjs
$env:EVEJS_COOP_CODE_PATH = 'C:\Games\EveCoop\upstream-evejs\Code'
node --test tests/coop-chat23-30-37-reconcile.test.mjs
node scripts/patch-evejs-coop.cjs --code-path $env:EVEJS_COOP_CODE_PATH --dry-run
node scripts/patch-evejs-coop.cjs --code-path $env:EVEJS_COOP_CODE_PATH --check
```

Feature enablement requires an approved disposable copy of original GameStore data, persistent and access-controlled directories for the separate wormhole and contract file receipts, one authoritative writer process, verified native flush/replay semantics and explicit human approval. Neither this commit nor its PR sets these flags to `1`. Do not run GitHub Actions, install the overlay on a populated world, or rewrite/deinitialize a Docker volume.

## Merge and rollback

The PR is one reconciliation commit on a feature branch, targeting main for **review by Chat 01, 06, 30, 37 and 42**. If central installer code changed again, recheck the expected main ancestry and re-run all tests before merging. Revert only the reconciliation commit to undo its hook registration and duplicate-name fix; the three original feature commits are independent and must not be reverted to roll back this integration. In deployment, disable `EVEJS_COOP_NATIVE_CONTRACT_MUTATION_FENCE`, then apply the central supported remove/dry-run process to an approved disposable checkout; never hand-edit native EveJS files.
