# Two-player fleet warp — real EveJS gameplay

**State:** opt-in NativeCoop source integration implemented; **not yet tested with two EVE clients**. Only a human operator can confirm visible movement, arrival and synchronized battle. Do not use raw TCP connections or two launched Play.bat windows as proof of a usable fleet.

## What changed

Pinned upstream: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

The upstream fleet client requests `CmdWarpToStuff(..., fleet=True)`, which invokes `BeyonceService._warpFleetFollowers` after the leader's native warp request succeeds. The fleet runtime checks fleet/wing/squad command hierarchy, the follower's accepted-fleet-warp preference and membership. That code remains authoritative; the co-op patch does **not** create a second fleet implementation or a fake warp.

`integration/coopFleetWarpSafety.cjs` adds an extra check for the follower when `EVEJS_COOP_FLEET_WARP_SAFETY=1`:
- Both participants have distinct authenticated character IDs and ship IDs.
- Both active sessions belong to **exactly the same native EveJS scene**, are explicitly present in `scene.sessions`, have finished initial space hydration, and share the same physical solar system.
- Both physical EveJS ship entities match their session ship IDs, have finite coordinates and exist in the scene's authoritative entity map.
- An already-warping follower, destroyed/absent ship, detached session, different-system player or ghost session is not pulled by a second warp.
- Existing native fleet authority, member opt-out, in-space warp physics, ship restrictions and source/destination logic remain in charge.

The same native `warpToEntity` / `warpToPoint` functions are used. If EveJS accepts a follower's warp request, the adapter logs `coop-fleet-warp-native-order` with `status=NATIVE_WARP_ORDER_ACCEPTED`, the real commander/follower ship IDs and target ID; an actual native warp failure gets `NATIVE_WARP_ORDER_FAILED`. Failed same-scene preflight records `coop-fleet-warp-skip` and a specific reason. **These prove accepted commands or explicit rejection, NOT arrival or visual playback.**

No new fleet items, NPCs, sessions or warp positions are fabricated. The change is a reversible overlay patch in `scripts/patch-evejs-coop.cjs`, so native upstream remains unchanged on GitHub.

## Enablement

The flag is emitted as `1` only during an **explicit** `Deploy-Coop-RuntimeProbe.ps1 -LivingCoop` deployment; it is not a reason to redeploy an already-running game during a diagnostic. It is not enabled in unrelated upstream server configurations.

Do **not** run `git pull`, initial `Prepare`, market rebuild, `CoopStart` or a remote CI solely to collect these results. The owner/tester should first finish `DiagnoseWorld` and `World` per [GAMEPLAY_TESTING](GAMEPLAY_TESTING.md). For a new approved deployment, preserve the local upstream test fixes and named volumes before building.

## Actual two-player manual acceptance

Only after both characters can authenticate and see NPCs in the game:

1. **Join the same native fleet.** A invites B, B accepts, verify both clients show fleet membership. The commander (not a normal fleet member) requests native *Warp Fleet* to an existing valid destination.
2. **Same system positive case.** The native server must record one accepted follower warp order for B with the correct character and ship IDs; B must visually enter warp and land at the same real destination/grid as A. A and B must visually see one another after arrival. Check `-Action Party`: `nativeFleetWarpOrdersAccepted>=1`; `fleetWarpArrivalVerified=false` remains conservative until the operator observes landing.
3. **New objective.** Each player targets a real physically observed NPC in that grid. In a safe encounter, confirm B can join A's combat, apply native damage and see the same wreck. The loot must actually appear in EveJS inventory on pickup, not only in server-generated wreck data. The native wreck refresh API bug is fixed in the reversible overlay: both observers should see the empty-wreck slim item after the final item is removed. See the shared-loot steps below. Do not fabricate an NPC kill to manufacture a PASS.
4. **Member preference.** Turn off B's native *Accept Fleet Warp*. A repeats the command; B must not be pulled. This restriction is enforced by upstream `fleetRuntime` and must not be bypassed.
5. **Different-system negative case.** Move B legitimately into another solar system; A's fleet warp in A's system must not move B or change B's system/ship identity.
6. **Reconnect.** B disconnects while A remains; no ghost fleet warp. B reconnects, undocks, verifies original character and persisted ship, rejoins/restores fleet state as appropriate, and again accepts a real native fleet warp.
7. **Warp-blocked negative case.** If a legitimate in-game warp-scramble or active native warp prevents B from following, server reports failure or safety skip, not successful arrival. No unsafe forced warp is used.
8. Check a few real formations (POINT then SPHERE/WALL if client supports). Unsupported client formation layout is **not** converted into a fabricated server success. Record the exact native client result.

For failed results, compare `nativeFleetWarpOrdersAccepted`, `nativeFleetWarpOrdersFailed`, `nativeFleetWarpFollowersSkipped` and the last native errors in `-Action Party`. Correlate the same real ship IDs and system with user-visible evidence. Server order accepted does **not** imply arrival; the tester must attach screenshots/observations of both clients separately.

## Same-wreck, two-player loot pickup acceptance

The pinned upstream `nativeNpcWreckService.js` had two separate client refresh defects:
(1) native loot transfer did not ask to broadcast updated wreck state;
(2) the broadcast path invoked a nonexistent
`scene.sendSlimItemChangesToAllSessions`. The overlay now uses
`refreshNativeWreckRuntimeEntity(..., { broadcast: true })` and the
real EveJS scene API `scene.broadcastSlimItemChanges([entity])`.

After a naturally occurring NPC kill, both authorized players should
observe the **same physical wreck ID** on-grid. A opens it and moves an
actual item into A's own cargo. A verifies the item appears once in
inventory. B checks that the same item disappears from the source or
its quantity decreases, then tries to take a *different, remaining*
item if available. The final successful pickup must update the wreck's
`isEmpty` slim-item state on **both** client overviews. A second
attempt to pick up the already-removed item must not duplicate
inventory or grant free ISK. Record source item IDs/quantities before
and after from the server and visually check both clients.

Important: **a server-side wreck and saved loot are insufficient** to
prove client loot pickup, shared inventory visibility or permission
handling. No real two-client pickup test has been completed here.

## Manual local code tests (only if that code changed)

```powershell
node --test tests/coop-fleet-warp-safety.test.mjs tests/coop-party-fleet-warp-report.test.mjs
```

Ten deterministic eligibility/identity tests, three read-only party report tests and four reversible wreck refresh tests were run in isolation. The pinned EveJS source patch was also parse-checked, reapplication idempotent, and removal restored the exact source. **No live Docker/client warp test or hosted CI was run here.**

Owner policy: no GitHub Actions / remote CI, no merge without explicit permission.
