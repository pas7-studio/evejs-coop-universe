# Chat 23 — Wormhole native mass-commit fence and transition contract

**Status:** CODE_READY / HOOK_NOT_INSTALLED / LIVE_UNVERIFIED. Reviewed pinned upstream `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, main at audit `0d06aa87577700630e7468296253cdcb7631104d` (recheck HEAD before integration). This is an **opt-in repair of native wormholeMgr**; it does **not** invent wormhole records, coordinates, sites or shortcuts.

## Verified upstream native capability

- `services/exploration/signatures/providers/wormholeSignatureProvider.js` exposes actual wormhole signature targets for probe scans; existing `bookmarkService`, probe scanning and normal warp mechanics remain authoritative.
- `services/exploration/wormholes/wormholeRuntimeState.js` persists paired endpoints, mass, lifetime, states and `polarizationByCharacter` in original GameStore table `wormholeRuntimeState`. `wormholeRuntime.js` handles pair creation/expiration, K162 visibility, mass regeneration, polarization, collapse, spawned exit positions and native static wormhole entities.
- `wormholeMgrService.Handle_WormholeJump` calls **generic `jumpSessionToSolarSystem` with `wormholeRuntime.buildJumpSpawnState()`**, not `jumpSessionViaStargate`. It checks real source entity and proximity.
- Confirmed bug: `completeWormholeJump` invokes `jumpSessionToSolarSystem` first and then `wormholeRuntime.commitJump` **ignores the mass-commit result**. A successful ship transition can thus precede an unsuccessful/non-durable mass debit. Two overlapping players can start with a stale positive `prepareJump` result; expiry/collapse can occur in the 1500ms delay.

## Chat-23 changes

1. `integration/coopWormholeJumpFence.cjs`: native-source/ship revalidation, a fresh `prepareJump` at handoff, pair identity and destination consistency, range check, exact ship mass and native item ID, one durable `PREPARED` ticket, then **original** `wormholeRuntime.commitJump` before travel.
2. Verify pair remaining mass reduction, collapse state and 5min polarization by exact character/endpoint; require a successful **original** `gameStore.flushTableSync('wormholeRuntimeState')` acknowledgment before travel. This is a single-process contract, not a guarantee of SQLite power-loss atomicity.
3. Persist `MASS_COMMITTED` journal receipt before calling original `jumpSessionToSolarSystem` with native `anchorType:wormhole`; after a successful transfer verify exact same ship ID in original destination scene and record `ARRIVED`. **Never call stargate-specific transition.**
4. Incomplete/ambiguous `PREPARED` or `MASS_COMMITTED` tickets persist across restart. `mayBegin(session)` refuses a further transit for that character until an operator reconciles original wormhole row, original ship's real system and the ticket; no automatic mass refund, no invented destination and no retry of an ambiguous jump. Tickets use exclusive-create/fsync/rename/fsync-dir under an operator-supplied absolute path.
5. `scripts/coop-wormhole-jump-fence-patch.cjs` adds two L1 one-call hooks **only in pinned `wormholeMgrService.js`**, removable byte-for-byte, LF/CRLF; does not modify `space/transitions.js` or `wormholeRuntime.js`. Flags OFF => vanilla upstream behavior. Helper is not a second live installer.

## Chat-01 ownership handoff (and Chat-06 transition review)

Central installer `scripts/patch-evejs-coop.cjs` and `space/transitions.js` remain Chat-01/Chat-06 controlled. To integrate the opt-in code safely, Chat-01 must:

1. Add L2 module `integration/coopWormholeJumpFence.cjs` -> deployed `server/src/space/coopWormholeJumpFence.js`, using the central module names list.
2. Register a **pinned native source** spec for `server/src/services/exploration/wormholes/wormholeMgrService.js`; apply/remove its content via exported `patch(source,file,remove)` from `scripts/coop-wormhole-jump-fence-patch.cjs`. Review ordering/ownership against other transition hooks. Don't edit the pinned EveJS source manually.
3. Explicit feature flag `EVEJS_COOP_WORMHOLE_JUMP_FENCE=1` and absolute `EVEJS_COOP_WORMHOLE_JOURNAL_DIR=/var/lib/evejs/coop-wormhole-jump-tickets` **only on disposable test runtime**, never default-on. Keep the single original GameStore owner/writer process. Do not enable in a live persistent world until original GameStore flush and destination rehydration proved.
4. Dry-run, check, install twice, remove, byte-for-byte source roundtrip and all regression tests. Chat-06 review native transition function interface, verify the spawn override and two independent real pilot scene attachments. The module deliberately does not alter generic warp/gate jump behavior.

## Known limits, not claimed complete

- **No cross-database atomic transaction** covers original native wormhole mass, character-location transition, and on-disk file ticket. A failed transition after verified mass debit deliberately leaves a spent wormhole and operator-repair ticket, not a free second jump. If jump succeeded but scene is not immediately hydrated, the gate conservatively quarantines; repair must verify physical state before clearing the ticket.
- `wormholeRuntimeState.mutateState` writes several GameStore paths in sequence; an acknowledged table flush is not proof of full power-loss durability. Real SQLite crash-window replay testing and per-pair serialization across multiple server processes remain release blockers.
- Native probe certainty, bookmark sharing/permission checks, discovery visibility, wormhole-specific PvE sites, disappearing endpoints on loaded clients and true warp-to coordinate behavior were source-inspected, **not end-to-end proven**. No fabricated sites, loot or bookmarks.
- A ticket uses character ID, pair ID, original queued timestamp; this assumes one authoritative Node process and a trustworthy persistent journal directory. Do not auto-delete unfinished tickets. Existing `ARRIVED` receipts remain as audit history.
- The stock `prepareJump` allows a ship whose mass exceeds **remaining** pair mass to pass and collapse it, if the ship is below max single-jump mass. This is intentional; mass-resource depletion occurs on the final authorized passage.

## Isolated verification and acceptance

Run `node --test tests/coop-wormhole-jump-fence.test.mjs tests/coop-wormhole-jump-fence-patch.test.mjs` against this repository. These are **native-API-shaped mocks**, not actual pinned World or client tests. Scenarios include two ships on one paired link, sequential mass consumption, 0/collapsed/expired gates, flush failure, incorrect source ship, failed physical transition, corrupted/restarted journal, exact named exit anchor and LF/CRLF hook roundtrip.

**Required real gate:** two separately authenticated pilots A/B; native probe certainty -> their permitted bookmark(s) -> physical warp to same endpoint -> jump after range and mass/polarization checks -> actual **same real ship itemIDs** in reciprocal destination; stable mass and polarization after reconnect and two restarts; final mass collapse removes endpoints; attempted replay fails; sessions, cargo and inventories remain original. Test physically populated wormhole-specific anomalies only if pinned client/server truly support them. Never call isolated tests a LIVE PASS. Don't run GitHub Actions or touch preserved evejs-data.
