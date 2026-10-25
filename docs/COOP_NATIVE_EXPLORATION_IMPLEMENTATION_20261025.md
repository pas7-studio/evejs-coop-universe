# Native co-op exploration — completed probe proof and real shared bookmarks

Date: **2026-10-25**. Upstream pinned to `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Feature branch: `feat/coop-native-exploration-probe-proof-20261025`, based on confirmed merged `main@1d71e7fac47ab28dfead53ba7b63482d37e1df41`.

**Scope:** reuse native EVE scanning, native persistent group bookmarks and native physical warp; no synthetic sites, positions, ship moves, inventory, currencies or scan results. **Status: SOURCE/LOGIC TESTED, TWO-CLIENT LIVE UNVERIFIED.** Not deployed.

## Why this was necessary

Stock `scanMgr.Handle_RequestScans` yields a `probeScanRuntime.buildSignatureScanResults` result, culminating in `OnSystemScanStopped` with `util.KeyVal` results. Complete certainty `1.0` includes the authoritative site position.

Stock `beyonce.Handle_BookmarkScanResult` uses `normalizeNumber(args[3],0)`, whereas `probeScanRuntime.resolveResultID(site)` can return a **string** `targetID` such as `ABC-001`. Thus a real client can have a valid signature that native bookmark cannot resolve by numeric ID. More importantly, stock `bookmarkRuntime.resolveScanBookmarkTarget` returns the true position for any existing numeric siteID without proving the requesting character scanned it. The integration patches both issues through the same authoritative receipt.

Stock `bookmarkRuntime.getBookmarkForCharacter` already enforces shared-folder access. `beyonce.resolveBookmarkAnyStore` additionally denies *newly-created shared bookmarks* to non-creators for 120 seconds. The optional fleet helper allows trusted **native fleet peers who already have folder access** to immediately use shared marks; it doesn't disclose private bookmarks.

## Code committed

- `integration/coopNativeScanProof.cjs` → copied by the existing source overlay into `server/src/space/coopNativeScanProof.js`. Pure server logic; no DB writes.
  - `record`: only a native `scanMgr.Handle_RequestScans` result that actually reaches the `OnSystemScanStopped` notification callback can create a per-session receipt; authenticated character and active ship/system must still match the origin captured from the real server scan.
  - Accepts only `util.KeyVal` entries with finite certainty **>=1.0**, matches exactly one actual `signatureRuntime.listSystemSignatureSites` entry and records real `siteID` + string `targetID`.
  - Up to **64** results per character/session, each valid **15 minutes**; no persistence across disconnect/reconnect, no offline workarounds or sharing scanner rights with another character.
  - `authorize`: matches actual current system, active ship, character, non-expired proof, and **still-existing catalog signature** with same siteID+targetID; maps numeric or string client ID to the one real numeric siteID for stock `resolveScanBookmarkTarget`.
  - `fastFleetBookmarkAccess`: requires a prior successful native `getBookmarkForCharacter({requireActive:true})` lookup, non-personal shared folder, active folder and both creator/requester as current members of the same **native** fleet.
- `scripts/coop-native-exploration-patch.cjs` → exact anchored, reversible source changes:
  1. `server/src/services/exploration/scanMgrService.js`: tag the internal completed **RequestScans** result as native; when its actual scan-stopped callback delivers `OnSystemScanStopped`, write receipt from genuine server evidence. QA/manual scan methods without the native origin tag do **not** create receipts.
  2. `server/src/services/ship/beyonceService.js`: verify that the actor scanned the precise site before creating a scan bookmark; preserve original path when flag off. Refuse to enumerate other systems based on arbitrary client locationID.
  3. Same `beyonce`: bypass stock 2-minute shared-bookmark delay for authorized same-fleet peers only. All other clients retain stock behavior.
- `scripts/patch-evejs-coop.cjs`: includes the new native scanner service in its transactional overlay source manifest and copies the helper; preserves existing FleetWarpSafety injections into Beyonce.
- `scripts/Deploy-Coop-RuntimeProbe.ps1`: new **explicit opt-in** `-EnableNativeExploration` switch adds both flags:
  - `EVEJS_COOP_EXPEDITION_SCAN_PROOF=1`
  - `EVEJS_COOP_EXPEDITION_FLEET_BOOKMARKS=1`
  - Both **OFF by default**, including under `-LivingCoop`, until two native clients confirm actual RPC parity.
- `tests/coop-native-exploration-proof.test.mjs` registered in `scripts/Verify-Local-Coop.ps1` for real Node verification.

## Source-level verification in this agent turn

Against full pinned upstream `scanMgrService.js` and `beyonceService.js`: patch modified each, second apply was exactly no-op, removal restored each original byte-for-byte, and both patched JavaScript sources parsed. The patched Beyonce service also parsed with the previously-merged fleet warp safety injections.

Isolated V8 behavior passed: perfect own string/numeric signature accepted; below-perfect / missing / NaN / Infinity certainty denied; another character and another solar system denied; signature-replacement and expired receipt denied; 64-proof cap enforced; nonmembers and private/inactive folders denied; actual two-player fleet with native shared-folder permission accepted. **These are logic/source checks, not an executed local `node --test`, Docker boot or live gameplay pass.**

## Required on-host verification (no modification of running volume)

**1. Source tests/preflight, without Docker restart:**

```powershell
$env:EVEJS_COOP_CODE_PATH = 'C:\Games\EveCoop\upstream-evejs\Code'
node --test tests/coop-native-exploration-proof.test.mjs
node scripts/patch-evejs-coop.cjs --code-path $env:EVEJS_COOP_CODE_PATH --dry-run
```

`--dry-run` must show exactly pinned upstream compatibility. Then run project-wide `scripts/Verify-Local-Coop.ps1` only when appropriate for the environment. Don't equate test discovery with an actual green test.

**2. Two real clients (ONLY after a separately authorized deployment + backup):**

1. Characters A and B join the same stock `fleetRuntime` fleet, each with its own real ship/session.
2. A deploys real probes and scans a native signature to **100%**. Record `OnSystemScanStopped` actual `id` (string or numeric), certainty and system. Scan receipt exists only on A.
3. A creates a shared native folder accessible to B using the stock access-group bookmark UI and bookmarks that exact signature. Test that 99% scan and a guessed existing siteID **cannot** create the same exact bookmark.
4. B sees the genuine shared bookmark. With `-EnableNativeExploration`, B immediately warps to it without waiting 120 seconds **only when still in the same native fleet and already allowed to read that non-personal folder**. B's ship moves by native `beyonce`, not teleport.
5. Try the same URL/ID from B's private folder, nonmember C, an expired bookmark, a different solar system, reused signature siteID with different targetID, stale after relog, and a guessed foreign scan ID: must fail or follow the original delay.
6. For a wormhole signature, A and B individually jump the **same** real native endpoint; test ship mass, polarization, lifetime/collapse, physically correct destination and re-login. The new code does NOT skip native wormhole limits.
7. Only declare `LIVE_PASS` with two distinct actual character IDs, two real ships, native bookmark ACL, server and client logs, scan certainty receipt, exact jump positions and saved ship state after re-login.

## Known boundaries and owners

**Exploration owner:** validate original client argument layout and actual marshalling, scanner completion, bookmark UI and wormhole follow-through. **Fleet/warp owner:** review any changes to Beyonce/fleet behavior before merge. New implementation touches only one existing shared source transformation file + verify/deploy manifests, no existing fleet implementation files in project.

**No global unlock:** The scanner receipt is deliberately only per authenticated session and non-persistent: after reconnect A must rescan to create a new exact scan bookmark. Previously created bookmarks remain native persistent records subject to stock folder access and expiry.

**No new fake loot/economy:** The subsequent salvage, asteroid/gas and wormhole loot expedition remains native EVE mechanics with existing itemStore authority. Full end-to-end exploration and ore/loot financial conservation still needs two-client acceptance.

**No unsafe operations:** no `main` merge, no deployment, no Docker restart, no CI and no `evejs-data` volume mutation in this implementation turn.
