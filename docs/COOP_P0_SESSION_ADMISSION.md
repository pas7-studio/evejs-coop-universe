# P0: native Ballpark session admission before co-op side effects

**Base:** merged main `1d71e7fac47ab28dfead53ba7b63482d37e1df41`.

Previously `coopSessionPresence.schedule()` waited for `_space.initialStateSent===true` and checked ship/system IDs, then triggered co-op world observation, NPC demo, party registration and "space-arrival" telemetry. During disconnect/reconnect the old client could remain temporarily in the native scene, its record be replaced, or two valid-looking sessions claim one character or ship. Such an attach could start co-op side effects without unique authoritative native ownership.

**Change:** new pure `admission(session,ship,getSceneForSession)` runs at the existing delayed Ballpark attach boundary:
- Checks still-connected session, positive native character/ship/system, completed Ballpark and exact ship/system.
- Resolves current native EveJS scene, requires the actual session object in `scene.sessions`, exactly one currently ready connected session for the character and no competing live session claiming that physical ship.
- Requires the actual native `scene.getEntityByID(shipID)` to be a real ship with matching ID and no contradictory authenticated pilot identity.
- A missing/transiently incomplete native scene or hull waits with existing bounded retry (up to 30 polls). A duplicate/replaced/foreign session fails closed immediately and emits `coop-session-admission-blocked`, without calling the co-op world/party/NPC hooks.
- Once unique physical ownership is verified, calls the original side effects once; records `space-arrival` with `authoritativeScene:true`.

This **does not change core EveJS login/ship ownership**, socket lifetime or move ships. It prevents this overlay's own side effects on stale records. Existing native login/reconnect handling remains authoritative. Test 3 new negative/positive cases within already registered `tests/coop-living-session.test.mjs` passed in an isolated V8 harness. Full Node and Docker/client tests are still pending.

```powershell
node --test tests/coop-living-session.test.mjs
```

**DoD:** client A and B enter one real system, unplug/reconnect A, ensure B and both actual ship IDs persist unchanged, and verify no duplicate NPC spawn/party notice/mission credit or stale `space-arrival`. A duplicated active session or replaced ship must NOT be admitted; normal fresh valid attach must still work. No main merge, deployment, Docker restart or `evejs-data` modification performed in this branch.