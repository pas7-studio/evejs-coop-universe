# In-space teleport delivery (pilot lane)

Owner report, 2026-11-05: *"the micro jump drive still does not jump 100 km forward — after the
animation the pilot is in the same place"*.

This document records what was measured, what was actually broken, the fix, and how the next live
jump is proven. It is about **delivery**, not about the jump itself.

## 1. The server half is correct (measured, not assumed)

| step | evidence |
|---|---|
| the fitted module resolves as a micro jump drive | `resolveMicroJumpDriveActivation` on the live reference data: type **4383** ("Large Micro Jump Drive"), effect `microJumpDrive` (**4921**, duration attribute 73), `matched: true`, `success: true` |
| duration and distance | `durationMs: 12000`, `microJumpDistanceMeters: 100000` (type 4383 carries no `mjdJumpRange`, so `resolveMicroJumpDistanceMeters` falls back to the standard 100 km — correct, not a bug) |
| the cycle really teleports | `space/runtime.js` tier-3 cycle branch → `executeMicroJumpDriveCycle` → `scene.teleportDynamicEntityToPoint(entity, position + direction × 100 km)` |
| the jump fx is only broadcast after a successful teleport | `coopOwnerTeleport`-relevant code path: `scene.broadcastSpecialFx(..., "effects.MicroJumpDriveJump", graphicInfo: [destination])` |

So the jump happened on the server; only the pilot's own copy of the position was missing.

## 2. What was wrong: one broadcast for two different lanes

`teleportDynamicEntityToPoint` ended with a single `broadcastMovementUpdates([...])`. Every session —
the owner included — received `SetSpeedFraction 0`, `SetBallPosition <destination>`, `Stop`,
`SetBallVelocity 0` at the **raw authored destiny stamp**.

The pilot lane is not raw:

* the movement authority resolves a per-session delivery stamp
  (`space/movement/authority/destinyAuthority.js`), and the client destiny ticker **discards** a state
  older than the one it already holds — `destiny/net/client/_ticker.pyj`:
  `'Michelle discarded a state that was too old %s < %s'`;
* the engine never pushes a pilot position on the raw stamp anywhere else: pilot warp corrections
  carry `minimumLeadFromCurrentHistory = PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS` (4 ticks,
  `space/movement/dispatch/movementWatcherCorrections.js`) and observer corrections are explicitly
  **watchers-only** (`excludedSession: entity.session`).

Watchers anchor on raw stamps and therefore saw the jump; the pilot's own packet could arrive already
in the past. That is exactly the reported symptom: animation yes, movement no.

## 3. The fix

`Code/server/src/space/coopOwnerTeleport.js` (fork, commit `1b5cb47`) owns that one lane:

* the same authoritative bundle (`speed 0 → position → stop → velocity`, one stamp) goes to the owner
  through `sendDestinyUpdates` with the pilot lead (`minimum/maximumLeadFromCurrentHistory =
  PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS`);
* watchers get the identical bundle on the raw stamp with the **owner excluded** — one position must
  never arrive twice on two stamps;
* a session that has not finished its initial ballpark, or lost its socket, keeps the watchers-only
  path (same predicate as `isReadyForDestiny`);
* every teleport writes one record, so the next live jump is evidence and not a claim:

```json
{"event":"space.teleport.delivery","status":"TELEPORT_OWNER_LEAD","reason":"OWNER_LANE_NEEDS_LEAD",
 "entityID":…,"typeID":…,"stamp":…,"leadTicks":4,"ownerLeadSent":true,"position":{…},"updateCount":4}
```

Statuses: `TELEPORT_OWNER_LEAD` (pilot lane sent), `TELEPORT_WATCHERS_ONLY`
(`NO_OWNER` = NPC/sessionless, `OWNER_SESSION_NOT_READY`), `TELEPORT_NO_ENTITY`.

The stock change is one line in `runtime.js`; the three `path.join(__dirname, …)` requires in
`sovPlayerDeployment.js` were compacted to literal relative paths to pay for it inside the audit
budget (**65 488 ≤ 65 500**, the budget was not raised).

`/tr <target> <point>` uses the same function, so chat teleports of a player ship get the same lane.

## 4. What to check on the first live jump

1. In game: undock, fit and activate the micro jump drive, wait out the 12 s spool-up.
2. Expect the ship 100 km ahead in the **align direction**, stopped, plus the jump effect at the
   destination.
3. On the server:
   `grep 'space.teleport.delivery' /var/lib/evejs/coop-events.jsonl | tail -3`
   * `TELEPORT_OWNER_LEAD` + `ownerLeadSent: true` → the pilot received the lead copy. If the ship
     still does not move, the remaining suspects are the *client* refusing an ego `SetBallPosition`
     while the ball is under a local command, and the next step is a reconstruction of the ego ball
     (AddBalls2 rebase) instead of a position push — do not change the module blindly.
   * `TELEPORT_WATCHERS_ONLY` with `OWNER_SESSION_NOT_READY` → the session had no park yet; that is a
     client/log-in problem, not a jump problem.
   * no record at all → the module never ran, so the cycle did not reach the teleport; look at the
     module cycle, not at delivery.
4. Watch a second pilot's client: watchers must still see the ship jump (unchanged lane).

## 5. A measuring trick for this class of bug

The client can be *observed* instead of guessed at: `python
R:\GitRepository\pas7std\stratium\tools\vision.py shot --title "EVE - <char>"` writes a PNG, and the
overview's distance column is a direct readout of **what the client believes its own position is**.
Teleporting a ship and comparing that column before/after distinguishes "server did not move" from
"client did not accept" without asking the player.

## 6. Two findings on the way (not this bug, recorded so they are not re-derived)

* `/tr me me` succeeds but `/tr me offset=<x,y,z>` answers *"Could not apply /tr offset=… because the
  target has no in-space anchor"*. Both go through `getSessionTransportAnchor`, so one of the two
  paths disagrees about the anchor kind for a ship that is in space. `/tr me pos=x,y,z` (absolute
  point) is unaffected. Needs its own look before anyone relies on the offset form for tests.
* **Incident, 2026-11-05 23:26 UTC:** a `grep -r` over the 245 MB backup sqlite inside the running
  container was OOM-killed and took the play-stack server container down with it; it came back on its
  own (health OK) and the client had to relog. Do not run recursive greps over `/var/lib/evejs` inside
  the server container — query the store through the code instead.
