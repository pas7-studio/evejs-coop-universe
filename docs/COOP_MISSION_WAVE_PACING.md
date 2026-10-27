# Agent-mission wave pacing (`EVEJS_COOP_MISSION_WAVE_NOTIFY`, `EVEJS_COOP_MISSION_WAVE_CAP`)

Measured 2026-10-27 on the play stack, mission **Gone Berserk** (agent 3019082,
dungeon 875, instance 6, character 140000005):

| fact | evidence |
| --- | --- |
| 7 waves, 24 hulls in total (9+3+3+3+2+2+2) | `dungeonAuthority` template `client-dungeon:875`, `wave_01..wave_07` |
| wave 1 carries `triggerMessages: [{messageType:2, messageID:123944}]` | same template |
| waves 2..7 carry `triggerMessages: []` | same template — **no client message ever for follow-up waves** |
| the runtime does spawn them | `dungeonRuntimeState` instance 6: `wave_02` spawned 4 min after `wave_01` completed |
| the player never saw them | client log: nothing between the wave-1 kills and an autopilot jump out of the system |
| reward | 120 000 ISK + 45 000 ISK + 250 LP for 24 hulls (~6.9k ISK per hull) |

So the mission is not broken, it is **silent and long**: the objective only completes when
the last wave dies, and nothing tells the player that a new wave exists.

## What the module does

`integration/coopMissionWavePacing.cjs`, hook line in
`server/src/services/dungeon/dungeonUniverseSiteService.js` right before
`sendEncounterTriggerNotifications`, gated by two flags (default OFF):

- `EVEJS_COOP_MISSION_WAVE_NOTIFY=1` — after a wave really spawned, refresh the owner's
  mission (`OnMissionsUpdated` with the real mission items) and write one
  `living-mission-wave` telemetry record: wave, total, spawned hulls, remaining waves.
- `EVEJS_COOP_MISSION_WAVE_CAP=<n>` — at most `n` waves per agent mission. Waves above the
  cap are written as settled-without-spawn (`spawnedAtMs` + `completedAtMs`, `spawnCount: 0`,
  `skippedByCap: true`), so the stock chain stops there and the completion key list is
  trimmed to the allowed waves. A wave that already spawned is never rewritten.

The module never spawns, damages, kills or completes anything itself; every allowed wave is
still a real native wave, and the objective still needs those hulls dead.

## Audit of the other multi-wave mission dungeons

`scripts/audit-agent-mission-waves.cjs` (read-only, run inside a container) walks
`dungeonAuthority` and joins it with the live `missionRuntimeState` rewards:

| template | mission | waves | hulls | silent waves | ISK per hull |
| --- | --- | --- | --- | --- | --- |
| `client-dungeon:875` | Gone Berserk | 7 | 24 | 5 | 6 875 |
| `client-dungeon:1940` | The Blockade | 5 | **67** | 0 | **2 463** |
| `client-dungeon:3030` | Alluring Emanations | 3 | 44 | 2 | no live record |
| `client-dungeon:283` | Avenge A Fallen Comrade (Caldari lvl 1) | 3 | 20 | 3 | no live record |

Both missions that have been offered live pay the same **120 000 + 45 000 ISK and
250 LP**, so The Blockade is 2.8x the fleet for the same money. Output of the same
run over all 1593 multi-wave templates: 1592 of them have at least one silent wave,
so this is the normal shape of the data, not one broken mission.

Conclusions:
- **Silence is data, not code**: only wave 1 of most templates has `triggerMessages`,
  and The Blockade proves the runtime does deliver them when the data has them.
- **The cap is the real balance lever**, not the message: 24 and 67 hulls for one
  level-1 payout. A default cap of 3 waves is what the work stack runs.
- The audit must be repeated per upstream data refresh; the numbers above are from the
  pinned build (`c3ea396b`) and are not a property of our overlay.

## What it does not fix (follow-ups)

1. **Reward vs effort** is a data question: either cap level-1 missions (e.g. 3 waves) or
   scale the reward/LP with the number of waves actually spawned.
2. Waves arrive with no warning text at all; a client-visible "wave 2/7" line needs a real
   notification type or chat message, not just the mission refresh.
3. Nothing marks the last wave as last; a "final wave" flag would let the client show it.
4. The same silence applies to every other `client-dungeon:*` template whose follow-up waves
   have empty `triggerMessages`, not only 875.

## Verification

```sh
node --test tests/coop-mission-wave-pacing.test.mjs      # 11/11
node scripts/check-coop-mission-wave-hook.cjs            # HOOK_OK anchor=1
```

Live proof runs on the agents stack only:

```powershell
docker cp scripts/verify-coop-mission-wave-pacing-live.cjs evejs-agents-server-1:/tmp/v.cjs
docker exec evejs-agents-server-1 node /tmp/v.cjs        # LIVE_OK ...
```

It exercises the *installed* `space/coopMissionWavePacing.js` with capturing
dependencies, so it proves the artifact and its require chain without writing world
state or spawning a ship. An organic mission proof still needs a client on the agents
stack: it must show `living-mission-wave` with `status: WAVE_OK` and, with a cap,
`reason: WAVE_CAPPED` and `skipped: [wave_04..]`.
