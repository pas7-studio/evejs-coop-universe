# State — co-op loop (mining → haul → station → sale)

## 2026-10-30 08:40Z (UTC) - sites now reach the systems we play in (measured)

`space/coopUniverseSites.js` (fork `2c5ad6e`, `8770594`) feeds the *visited* systems into the engine's own
persistent-site seeder and then materialises the result into scenes that already exist (a scene built
before the instance cannot see it otherwise; `addStaticEntity` is idempotent so nothing spawns twice).

Live on the play stack, from the module's own log line:

    [CoopUniverseSites] systems=5 desired=7 created=0 spawned=1
      anomalies={"30000142":1, "30000144":1, "30000145":0, "30003837":0, "30045344":2}

`anomalies` is what `signatureRuntime.buildSignalTrackerAnomalyEntries` reports *in the live process* for
each system, i.e. exactly what the probe scanner and the anomaly lists get: Jita 1, Perimeter 1,
30045344 2. Before this change those systems had zero. New Caldari has no slot in this allocation - the
profiles put one slot on a subset of systems per band, and the 24 h expiry/rotation tick keeps moving
them, which is the behaviour the owner expects.

Density is deliberately the engine's own: `combat_anomaly` 1 slot per system on 360 highsec systems,
`combat` 1/120, `data` 1/36, lifetime 1440 min (`combat_hacking` 2880). Raising it is a profile edit in
`dungeonAuthority`, not a code change.

Remaining from the owner's list, next in order:
  1. premium shop: seed real SKIN offers (fulfilment `skin_license` already implemented, fork `763c293`);
  2. co-op missions: run the verification plan starting with the courier family
     (`docs/COOP_MISSION_VERIFICATION_PLAN.md`);
  3. overview: the profile is installed, the transmission paths are measured, waiting on the owner's
     session for the per-character check.

-30)

## Goal
One call instead of a dozen: batch admin actions, grant a full fitting at once, and
"he died → recreate exactly the same hull + modules + cargo" as a single tool.

## Where the code lives
- `mcp/lib/serverTools.cjs` — the evejs-server MCP tool catalogue (each tool: schema + handler).
  Existing: `admin_command`, `admin_give_item`, `admin_fit_ship`, `admin_board_ship`,
  `admin_remove_item`, `container_exec`, plus read-only probes.
- `mcp/lib/probe-admin-command.cjs` — script piped into the container via `docker exec -i`;
  configured purely by env: `Q_CHAR`, `Q_ACTION`, `Q_TYPE_ID`, `Q_QUANTITY`, `Q_STATION_ID`,
  `Q_WAIT_MS`, `Q_MODULES`, `Q_ITEM_ID`, `Q_COMMAND`. Actions are implemented in the fork's
  admin bridge (`server/src/space/coopAdminBridge*.js`), not in this repo.

## Tools to add (all MCP-side, no fork change needed)
1. `admin_give_fit({characterID, stationID?, hull:{typeID|name}, modules:[{typeID|name,count}], board?, confirm})`
   → grant hull, grant every module, fit them, optionally board. Returns hull itemID + per-module result.
2. `admin_restore_last_loss({characterID, stationID?, killID?, board?, confirm})`
   → read the newest `killmails` record for that character (see query below), recreate the exact
   hull (victimShipTypeID) and its items (typeID + qtyDropped+qtyDestroyed, skipping flag 5 = cargo
   only if asked), grant + fit, and delete the wreck copies that are still owned by the character.
3. `admin_batch({characterID, actions:[{kind:'give'|'fit'|'board'|'remove'|'command', ...}], confirm})`
   → run the list in one container exec, stop on first hard failure, return a per-action line.

## Hard-won facts from the 2026-10-30 restore (killmail 136, Venture 32880)
- Killmail items carry `flag: 4` for the old EVE cargo flag, but in this store the *fitted* modules
  of a lost ship also end up there — do not trust `flag` to separate fit from cargo.
- `admin_fit_ship` **grants and fits** its own copies, so "grant everything, then fit" duplicates
  modules. Either fit with `grant:false` after granting, or let the fitter grant.
- `admin_board_ship` refuses while the character is online: "relog or use the client".
- `admin_remove_item` fails with `unknown error` on **singleton** items (qty -1) and on items that
  live inside a wreck; normal stacks delete fine.
- The admin bridge sometimes answers after 20 s (default timeout) — pass `waitMs: 45000..60000`.
- `/tr me <stationID>` (`admin_command`) is the working way to move a character out of space and
  dock it (`/dock` is listed but has no handler).
- Killmail read (host side, no sqlite3 in the container): `docker cp` the store and query
  `select json from killmails where key='records\x1f<id>'`, `victimShipTypeID` = hull,
  `items[]` = {typeID, qtyDropped, qtyDestroyed}.
- Restore target station used today: 60015157 (Kisogo VII - AIR Laboratories, system 30000141).

## State left behind (2026-10-30)
- Character 140000005 (Sasunok1488) docked at 60015157; Venture 9988400116384 in hangar, fitted with
  22542 / 5239 / 8433 / 54291 / 6003; 3x 2454 Hobgoblin in hangar (drones are not slot-fitted).
- Wreck 9988400116382 still floats in 30000141 with 3 singleton module copies the bridge cannot delete.
- Fork commits today: `52b73a3` (ORE cover-mining), `8ac7ff5` (mission materializability filter).

## Next step
Implement tool 1 and 2 in `mcp/lib/serverTools.cjs`, register them in `mcpServer.cjs` if it keeps a
list, then prove them on a throwaway character on the **agents** stack (`evejs-agents`, ports
28443/25222/28000-28002) — never on the play stack while the friend is online.
