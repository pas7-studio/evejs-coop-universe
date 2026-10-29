# State — co-op loop (mining → haul → station → sale)

## 2026-10-30 09:30Z (UTC) - how the sites are actually spread right now, per band

Measured from the persisted dungeon state, security taken from `worldData`:

    INSTANCES 34 in 20 systems   highsec 24 | lowsec 10 | nullsec 0 | wormhole 0
    30000127 0.748 hs 1 | 30000131 0.607 hs 2 | 30000141 0.949 hs 1 | 30000142 0.946 hs 1
    30000144 0.949 hs 1 | 30000145 0.949 hs 1 | 30001376 0.817 hs 1 | 30001379 0.885 hs 2
    30002762 0.949 hs 2 | 30002802 0.847 hs 2 | 30002813 0.283 lowsec 2 | 30003039 0.647 hs 2

So: high-sec and low-sec are populated, **null-sec and wormhole space are not**, for two different
reasons:

  1. instances are only seeded for the systems the world reconciles (the visited/awake set), and the world
     loop lives in high/low-sec - a null-sec system never wakes here, so it is never seeded. Seeding it in
     advance WOULD work: `handleSceneCreated` materialises whatever instance exists the moment a scene is
     built, so the fix is to add a rotating sample of null-sec systems to `coopUniverseSites.reconcile`;
  2. the wormhole band is empty at the data level too: the spawn profiles carry no `wormholeClassIDs`, and
     no J-space system ever gets a scene in this world. Both have to be true before a wormhole site can
     appear.

What the owner asked for
One call instead of a dozen: issue a whole fitting at once, "he died → recreate
exactly the same ship" at once, and never wait 45–60 s. **Done and proven.**

## Root cause of the slow admin calls (this was the real bug)
`coopAdminBridge.drain()` only ran on the world tick. That tick is 30 s nominal
and **60–90 s in practice** when the world phases are busy, so every admin call
waited for it and often timed out. It was never "the bridge is dead".

Fix (fork `37e4197`): `startFastDrain()` drains the request file on its own 1 s
timer (`EVEJS_COOP_ADMIN_BRIDGE_MS`), started from the same env-gated block in
`coopVirtualWorldRuntime.js`. The world-tick drain stays.

## Tools (repo `12da23e0`, fork `37e4197` `33c6164` `4990672` + name fix)
- `admin_give_fit` — reuse or grant the hull, every module into its real slot
  family, drones to the drone bay (87), rest to the hold (5), optional board.
  **Idempotent**: items already on the hull count towards the request.
- `admin_restore_last_loss` — reads the newest native killmail for the character
  and rebuilds the exact hull + modules + drones + cargo.
- `admin_batch` — several whitelisted actions, one round-trip, one line each.
- Probe (`mcp/lib/probe-admin-command.cjs`): whole request as one base64 blob
  (`Q_REQUEST_B64`), answer read from the tail of the results file, 150 ms poll.
- Pure planner `space/coopAdminFitPlan.js` + `tests/coop-admin-fit-plan.test.mjs` (5/5).

## Measured on the evejs-agents stack (never the play stack)
| call | latency | result |
| --- | --- | --- |
| `admin_give_fit` (hull + 6 modules) | 0.4–1.1 s | all slots correct (27/28 high, 19/20/21 med, 11 low, 87 drones) |
| `admin_restore_last_loss` (killmail 54) | 1.09 s | 8/8 slots, hull granted |
| `admin_batch` (3 actions) | 0.83–1.12 s | 3/3 applied |
| after `docker restart` | — | fit still on disk (persisted) |

All three also proven through the real MCP stdio layer (schema + handler), not
just by calling handlers directly.

## Gotchas that cost time today
- A timed-out call may still have been applied: the request is on the volume.
  Read the result before repeating a mutating call.
- Killmail `flag: 4` cannot separate fitted modules from cargo. `singleton` marks
  a fitted module; category 18 marks a drone. That is the rule in the code.
- `resolveItemByName('Venture')` is ambiguous (published hull + two ♦ variants);
  the published exact match now wins.
- Cargo/drone stacks must move as one stack. Treating `count` as "N slots" for the
  hold turned a 1000-unit ore stack into 1000 grants (fixed in `4990672`).
- **Agents-stack trap I created and fixed:** `docker cp` a file into
  `/var/lib/evejs/gameStore/gamestore.sqlite` leaves it root-owned, so the server
  logs `sync flush FAILED ... readonly database` and silently loses every write.
  Fix: stop the container, `chown 1000:1000` on the volume, delete the stale
  `-wal`/`-shm`, start. Never `docker cp` over a live store.

## Owner's ship (verified in the server's own item store)
Character 140000005, docked at 60015157, active hull Venture `9988400116384`:
Mining Laser Upgrade I (11), Shield Extender (19), Multispectrum Hardener (20),
1MN Afterburner (21), **2× EP-S Scoped Mining Laser (27, 28)**,
**3× Hobgoblin I in the drone bay (87)**. Hangar: Mining Destroyer.

## Still open
- The play stack still runs the **old** bridge (no `give_fit`/`batch`), so admin
  calls there still take 20–60 s. The new code lands on the next play-stack
  restart — needs the owner's restart window (he and his friend are online).
- This session's MCP process also predates the new tools; they appear after the
  MCP server restarts.
- Wreck `9988400116382` in 30000141 still holds singleton module copies the bridge
  cannot delete. Do not loot it; it expires on its own.
