# EveJS Co-op — global integration round 2 (2026-10-25)

## Provenance and merge order

Primary P0 PR #21 (native co-op mission, loot, reliability, fleet UX) merged directly to main: `0ef58c302dad7ef635aea770a28af59067edc7e2`.
P0 native trade custody PR #28 merged into PR #23; consolidated PR #23 merged to main: `a4df48f89b418d3c85c28af6760f2e0c0fe33786`.

This canonical branch integrates original PR heads:
- #27 native MarketGroups catalog read-only diagnosis and optional market catalog source hook.
- #25 OFFLINE-only additive Manifest market candidate and opt-in importer; **no database mutation was performed**.
- #30 duplicate native ship/pilot owner rejection for real fleet warp/arrival.
- #15 native scan receipt and permissioned fleet bookmarks, explicit operator opt-in.
- #24 verified two-pilot NPC raid briefing roles (interceptor/escort), not automatic combat skills.
- #20 durable native hauler ore custody and source-debited receipts; fail-closed audit at the world runtime boundary.
- #26 explicit-only native NPC station ore settlement primitive. **Not an automatic manufacturing/market economy cycle**.
- #29 and #31 NPC agency and native industrial economy designs, clearly proposals, not delivered gameplay.
- #33 reject duplicate active physical native ship custody in two-pilot scene evidence.
- #32 default-off witnessed NPC raid hunting; original authoritative stock raid safety gate remains first.

## Cross-stream conflict decisions

Use one overlay installer with 22 unique pinned upstream source specs and no copy of older trade installer files. The merged installer retains atomic trade plus durable custody, agent dialogue, LP standing, native market catalog and exploration hooks. Modules are copied only from this repository. All new player-affecting features remain default-OFF or require an explicit operator/manual action; do not modify `evejs-data`, rebuild markets, run CI, or deploy here.

`Verify-Local-Coop.ps1` dynamically enumerates `tests/*.test.mjs` now: never overwrite it with stale hardcoded test lists from earlier PRs.

## Verification and known limits

Using the pinned public EveJS source `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, the **combined** native installer transform passed JavaScript parse, idempotence, and byte-for-byte rollback for all five highest-conflict native paths: itemStore, marketProxyService, scanMgrService, tradeMgrService and beyonceService. This is source-only V8 verification, not local Node/Docker or actual client acceptance.

Manual next: run `node scripts/coop-state.cjs --verify` and `Verify-Local-Coop.ps1` on the authorized host against a fresh source checkout; repeat installer `--dry-run` and `--check`, inspect market read-only first, and obtain separate owner approval before any database writes, deployment or real-client acceptance. The previous state bundle predates this merge and must not be treated as runtime evidence for this revision.

## Remaining P0 acceptance

Two independent authenticated clients: validate unique physical owners, fleet warp, NPC killmail, physical source-debited loot, native mission peer settlement, trade fault recovery and reconnect. Economy: native station ore credit is an explicit primitive, not automatic refining, production, sale or wallet settlement; do not label the closed-loop economy complete.
