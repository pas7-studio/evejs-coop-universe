# P0: actionable two-player native fleet brief

**Base:** merged main `1d71e7fac47ab28dfead53ba7b63482d37e1df41`.

Existing co-op party notices only sent a one-time rendezvous string on a changed two-player proximity signature. Two players still had to search manually for any nearby native NPC or coordinate exact target identity. This P0 adds a **passive, bounded, opt-in in-game target brief** to the already-running `coopDuoCoordinator.tick()`, not a new UI or RPC.

- Active only with a dedicated, **default-OFF** `EVEJS_COOP_FLEET_BRIEF=1` feature flag and successful native `coopNativeFleetParty.membership` verified for exactly the two players. Standard `-LivingCoop` and `EVEJS_COOP_PARTY_NOTICES=1` do **not** enable this new player-visible behavior; an explicit operator-approved environment change/deployment after client acceptance is required.
- Both recipients must be real distinct members of the exact same currently authoritative solar-system scene, with Ballpark initialized, non-destroyed socket, unchanged physical ship object and legitimate positions.
- Uses **only an existing authoritative native NPC ship** in the same `scene.dynamicEntities` Map, `nativeNpc===true`, valid physical position, exact `scene.getEntityByID(npcID) === npc`, and range <=250 km to one player. Never invents a waypoint, NPC, location, mission, loot, ship, threat, or order.
- A short EveJS system-message brief gives the verified `NPC #itemID` and measured nearest-player km, then suggests ordinary client Overview, Approach, Lock or native Warp Fleet *when available*. Does not falsely claim this NPC is hostile or that a fleet order was issued.
- Sends to both real player sessions. Per-fleet/scene/participants cooldown 120 sec **regardless of which nearby NPC is selected**, preventing a burst of notices from multiple targets; capped 300-key cache; other tick handlers never depend on chat success.
- No change to native fleet membership, fleet warp permissions, item handling, combat math, PvE rewards, production, or persistence.

Changed `integration/coopPartyNotices.cjs` and `integration/coopDuoCoordinator.cjs`; all 8 current `tests/coop-party-notices.test.mjs` cases (four preexisting + four new) PASS in the isolated JS harness at initial review; rerun the updated suite locally in an isolated V8 harness. Real live NPC in-game message delivery remains unverified.

```powershell
node --test tests/coop-party-notices.test.mjs
```

**DoD in real client:** two authorized clients join a real fleet and share a scene with a physical named NPC; each gets the same useful target brief no more than once per target/2 minutes. Non-fleet characters, ghosts, wrong-scene targets and fake entities get no brief. Both may independently select/approach the actual target and use native fleet actions; no claim of automated waypoint or mission. Preserve all user/host data and no public ports.