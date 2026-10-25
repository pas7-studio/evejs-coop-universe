# EveJS native exploration: verified code paths and two-player gaps (2026-10-25)

**Status:** read-only upstream discovery, *NOT implemented/accepted live*. Upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`; project feature branch `feat/npc-personal-memory-20261024`.

## Native functionality already there — don't invent replacements

- Native scanner: `server/src/services/exploration/scanMgrService.js` has `Handle_RequestScans`, `Handle_SetProbeDestination`, `Handle_RecoverProbes`, signal tracker, D-scan; `probes/probeScanRuntime.js` uses 1.0 certainty for full-location proof and returns scan result KeyVal with `id`, `certainty`, `pos`.
- Shared bookmark groups: `server/src/services/character/accessGroupBookmarkMgrService.js` handles add shared folder, create, copy/move, discover, add known folder and notifications. `bookmark/bookmarkRuntimeState.js` persists actual folder/bookmark coordinates and enforces group access. `bookmark/bookmarkService.js` is a smaller legacy `bookmarkMgr` facade; **do not mistake its four handlers for the entire feature**.
- Physical bookmark navigation: `ship/beyonceService.js` `Handle_CmdGotoBookmark` resolves actual accessible bookmark and physics via native ship movement. `getBookmarkForCharacter` verifies folder read rights.
- Wormhole transit: `exploration/wormholes/wormholeMgrService.js` `Handle_WormholeJump` requires an in-space ship and nearby endpoint, calls `wormholeRuntime.prepareJump` with actual ship mass and checks native polarization and destination.

## Two source-level issues requiring explicit QA

**EX-01 | P0/P1 | Potential scan bookmark target-ID mismatch and proof gap**

- Scanner result ID `probeScanRuntime.resolveResultID(site)` returns uppercased `site.targetID` **if present**, otherwise numeric `site.siteID`.
- `beyonceService.Handle_BookmarkScanResult(args, session)` reads resultID using `normalizeNumber(args[3],0)`; `bookmarkRuntimeState.resolveScanBookmarkTarget(locationID,resultID)` resolves only **numeric** site ID. A string scan ID, if sent by the game client, may be normalized to zero, making native bookmarking fail. **Verify exact client RPC argument first; never assume all signatures use strings.**
- Existing `resolveScanBookmarkTarget` searches the signature catalog and returns `actualPosition` without checking **this character's real scan certainty**. The RPC could reveal a coordinate if the caller already knows a valid numeric siteID; don't add a global bypass.
- Recommendation for exploration owner: on `emitProbeScanStoppedNotification`, register *server-generated* completed perfect-certainty results (not client-supplied probe maps) per authenticated character+system+site with short TTL. Validate `BookmarkScanResult` against this authoritative receipt, mapping native string ID to true site ID. Guard same-current-system, ownership, scanner completion, expiration, and relog. Shared fleet members should use the resulting **native shared bookmark**, not inherit unearned perfect scans.

**EX-02 | P1 | Native shared bookmark has intended 120-second delayed use**

- `beyonceService.js` constant `SHARED_BOOKMARK_DELAY_MS = 2 * 60 * 1000` makes other characters unable to warp to a newly shared bookmark during this window; creator can warp immediately.
- This is a stock intentional correction interval, not automatically a bug. For two-player cooperative expedition, consider guarded exception **only when both are authenticated active native fleet members** AND requester already has stock shared-folder permission, using actual `fleetRuntime`; do not allow arbitrary fleet users to warp to private bookmarks. Prefer an opt-in feature flag and negative tests.
- Alternative zero-code path: captain gets bookmark, fleet members stay on same grid, leader uses stock fleet warp. Validate this *before* adding a bypass.

## Verified baseline in intended play

1. A and B create/join a real native two-player fleet (two separate authenticated sessions and ships).
2. A has probe launcher/probes and finds a real signature; verify `OnSystemScanStopped` returned perfect certainty and meaningful site ID.
3. A creates a shared-folder bookmark (native `accessGroupBookmarkMgr`), B has genuine access via group/corporation; B sees same persisted bookmark. Ensure no private bookmark leakage.
4. B warps to bookmark with stock `beyonce` movement, **not** spawn/teleport. Observe intended 2-minute native delay. Check same correct native grid after arrival.
5. Both ships use the *same* wormhole endpoint. Validate physical distance, class, ship masses, polarization, collapse; B cannot jump after collapse even if A succeeded.
6. Both clients reconnect, re-read real shared bookmarks, preserve ship/system location. Test stale expired signature, expired bookmark, wrong system, nonmember, different corporation/folder, and scanning below 100% certainty.
7. Collect native ship telemetry, character ownership, bookmarked site ID, scanner certainty and screenshot/log for A+B. Do not call source/unit tests a gameplay PASS.

## Safe ownership / concurrency boundaries

**Existing P0 fleet/warp agent owns `ship/beyonceService.js` overlay**, so any expedition patch to that source must be coordinated before editing. An independent exploration agent can first trace scanner/bookmark RPC payloads and inspect the native gameplay path read-only. No unsafe client-provided coordinates, fake scanners or injected item rewards.

**Status:** native scanning, shared bookmark and physical wormhole APIs are **SOURCE_CONFIRMED**; their two-player co-op integration is **LIVE_UNVERIFIED**. EX-01 is a grounded potential mismatch/security gap requiring a real client sample. EX-02 is verified source behavior, not yet a proposed code change.
