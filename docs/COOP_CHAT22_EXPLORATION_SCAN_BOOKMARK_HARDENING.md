# Chat 22 — source-backed exploration, scan certainty, and two-pilot arrival

**Status: CODE_READY / PINNED_SOURCE_REVIEWED / TWO_CLIENT_LIVE_UNVERIFIED.** 2026-10-25.

## Source provenance and scope

- Project baseline: `pas7-studio/evejs-coop-universe@0d06aa87577700630e7468296253cdcb7631104d` (re-check `main` before one final push).
- Strict upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, historical EVE 24.01 build `3396210`.
- `Code/server/src/services/exploration/scanMgrService.js`: native `Handle_ConeScan` (D-scan), `Handle_SetProbeDestination`, `Handle_RequestScans`, `Handle_ReconnectToLostProbes`, `Handle_RecoverProbes`, `Handle_DestroyProbe`.
- `Code/server/src/services/exploration/probes/probeScanRuntime.js`: server-calculated certainty, signature ID, real-vector `pos` from server site `actualPosition` at `certainty=1`.
- `Code/server/src/services/exploration/signatures/signatureRuntime.js`: native provider signatures and anomalies; `sceneSignatureSiteProvider` and `wormholeSignatureProvider` supply actual positions. These sources are not a license to invent sites.
- `Code/server/src/services/bookmark/bookmarkRuntimeState.js`: native persistent bookmarks, shared-folder ACL, `x/y/z`, `locationID`, creator. `Code/server/src/services/ship/beyonceService.js`: `Handle_BookmarkScanResult`, `Handle_CmdGotoBookmark` use native destination/warp; stock shared-bookmark propagation has an intentional 120-second delay.
- `Code/server/src/services/exploration/hackingMgrService.js`: `Handle_StartNewGameInstance`, `Handle_ClickedOnTile`, `Handle_QuitHackingAttempt`; native materialized site containers and `dungeonUniverseSiteService` own completion/loot. **Current hacking is an oversimplified synthetic board; the start RPC accepts untrusted client parameters and the tile RPC lacks an explicit native-range/module/custody gate.** The existing simplified implementation is not a complete EVE hacking simulator and is not certified safe or complete.

## Defects resolved in the existing opt-in exploration path

1. A 100%-certainty receipt previously pinned `characterID + systemID + siteID + targetID` but neither the **original scanning ship** nor **actual site coordinates**. If an NPC/site recycled a signature with the same ID or the character switched ships, an old receipt could authorize a bookmark for coordinates that had not actually been scanned. The RequestScans source helper now stamps `getSessionShipID(session)` into its original internal server-only scan origin. The proof requires this exact ship on completion and on booking.
2. A native probe result includes a position vector of `real` marshal values. The proof now requires the actual complete result `pos` to match the freshly-read native site `actualPosition`, rather than accepting certainty alone. Incomplete/malformed vectors and conflicting duplicated result entries fail closed; the source still owns all certainty calculations.
3. The exact native site fingerprint is bound to its `siteID`, `targetID`, `siteKind`, `family`, `typeID`, `instanceID`, `pairID`, and original physical `actualPosition`. Replaced/moved sites invalidate old receipts even when their scan result IDs are recycled. Existing 64 receipt cap, 15-minute TTL, reconnect isolation and owner/fleet ACL remain.
4. Added a pure, **read-only** `verifyFleetArrival` helper: it requires two distinct initialized authenticated native sessions both registered in the current native scene, two distinct real non-NPC ships physically inside the same scene, exact owner/ship IDs, both still at the authorized same-bookmark site, and a **preauthorized** native non-personal shared bookmark for B in a real common fleet. It returns IDs and a verdict, never coordinates, never initiates movement or gives either player access. This helper is a local acceptance instrument, not a claim the server actually emitted that witness or that both clients saw the warp. The input `site` and both bookmark views must come from the *current native catalog and native `getBookmarkForCharacter`*, never client RPC arguments.
5. The existing `fastFleetBookmarkAccess` still gates an early shared-folder bookmark through stock `getBookmarkForCharacter({requireActive:true})` and common real fleet membership; **no blanket sharing of private scan coordinates**.

### Deployment / rollback boundaries

- Uses the **already registered** `coop-native-exploration-patch.cjs` and existing overlay module; central `scripts/patch-evejs-coop.cjs`, native `beyonce`, other owners' mechanics, and proprietary client remain untouched.
- Existing flags remain default OFF: `EVEJS_COOP_EXPEDITION_SCAN_PROOF=1` for exact scanning and `EVEJS_COOP_EXPEDITION_FLEET_BOOKMARKS=1` for the narrower shared-bookmark delay exception. No new independent scanner, hacking game, loot generator, or persistent database.
- Reversible native helper must pass `patch(patch(source,file),file,true)===source` for both LF and CRLF and the full transactional installer preflight on an actual pinned checkout. Do not enable experimental flags on existing save data without operator approval.

## Evidence grading

**Performed locally:** `node --check integration/coopNativeScanProof.cjs`; `node --test tests/coop-native-exploration-hardening.test.mjs` — **13 PASS, 0 FAIL**, using disposable native-shaped fixtures. Additional historical `coop-native-exploration-proof.test.mjs` receives only fixture compatibility for native original ship and positions. This is **not** a live EveJS daemon, actual RPC, running two-client game or hacking outcome.

**Still required from authorized host and clients:**

1. `node scripts/patch-evejs-coop.cjs --code-path <pinned Code> --dry-run`, `--check`, `node --test tests/coop-native-exploration-proof.test.mjs tests/coop-native-exploration-hardening.test.mjs`, and the standard reversible overlay roundtrip. Do not overwrite local upstream edits, restart Docker, clear `evejs-data`, change client binaries or run GitHub CI.
2. Character A launches real **core probes**, sees an existing signature from native `OnSystemScanStopped`, scans it to exactly 100% with the same original ship, and creates the native shared bookmark from that same signature. Reject 99%, malformed result, changed ship, changed/moved/replaced site and replay after reconnect.
3. Character B is an authenticated fleet peer with *actual native shared-folder ACL*, sees the persisted mark and invokes stock `CmdGotoBookmark`. B must not inherit A's scan proof, private bookmark or privileged position. A and B each warp with native Destiny movement, and a read-only server diagnostic supplies exact physical entity IDs, current native position, current site and bookmark views to `verifyFleetArrival`; both clients visually confirm arrival. A mere warp ACK / fleet formation callback is not arrival proof.
4. A and B reconnect: both original native bookmarks and ships must remain within the game store's persistence rules. Rescan after reconnect before A creates another exact scan bookmark.
5. At a *real* native data/relic site, independently verify actual analyzer module activation, targeting, range, hacking RPC and server-owned container state. Require `dungeonUniverseSiteService` container and inventory before/after, no duplicated or invented item quantity, no duplicate completion, and reconnect/replay checks.

## Explicit blocker: full native hacking

Pinned `hackingMgrService.js` currently constructs `buildSyntheticBoard()` in `Handle_StartNewGameInstance`, passes client-derived `difficulty`, `virusInitialStrength`, `virusSlots` etc., and `Handle_ClickedOnTile` can win on revealing the core without an explicit live analyzer/module, distance, native target-lock, ownership and replay check. The `ACTIVE_ATTEMPTS` key is character-based rather than a unique session-bound native attempt. Materialized container loot and site completion exist but **cannot be called secure, balanced, or authoritative solely because a hacking UI reports success**.

A safe follow-on native fix requires a separate owner-coordinated, default-OFF, reversible `hackingMgrService` boundary integrated through **the single central overlay installer**. It should validate existing materialized site container, same physical scene/ship, correct data/relic analyzer, range and native active module, stage/session identity, terminal inventory/source state, atomic replay and reconnect. Do not fake a success by writing an alternate hacking simulator. This Chat 22 commit does **not** patch that shared native entry point or claim real hacking/PvE rewards are completed.

**Final status:** stronger source-backed scan/bookmark permission and an observation-only two-ship witness; live two-character exploration, secure hacking, actual site loot and persistence **NOT_TESTED / BLOCKED_CLIENT_UNAVAILABLE** in this execution environment.
