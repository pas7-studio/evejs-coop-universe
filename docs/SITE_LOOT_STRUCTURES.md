# Site structures that hold loot

Status: **implemented and proven on the work stack; enabled for the play stack in the next
restart.**

## What was wrong (measured 2026-11-05)

The owner reported "Serpentis Warehouse is always empty". Measured against the live world:

* "Serpentis Warehouse", "Guristas Warehouse", "Sleeper Warehouse", "Combat Warehouse" are
  `structureProfiles` with `role: "ambient"` — they come from
  `populationHints.environmentProps`, not from `populationHints.containers`.
* `dungeonUniverseSiteService.buildKillableStructureEntity` materialises them as
  `kind: "siteKillableStructure"` scenery: a position, hit points and nothing else.
* They have **no inventory row at all** (`item rows named warehouse: 0`), so the client's
  "open cargo" call (`GetInventoryFromId`) is answered with an empty list. There is nothing
  to loot — in every site, for every faction, on every shard.
* The loot data itself was never missing: site templates carry
  `populationHints.lootProfiles` with `pirate_combat_loot` and `combat_overseer_loot`
  (tags `faction_module`, `faction_ammo`, `pirate_tag`, `drone_component`, `overseer_effect`),
  and the site service already turns those into real items for data/relic containers
  (`buildLootGrantEntriesForContainer`).

## What the co-op layer does now

`space/coopSiteLootStructures.js`, phase `native-site-loot-structures`, switch
`EVEJS_COOP_SITE_LOOT_STRUCTURES=1` (default OFF, set in both compose files):

* a structure whose name matches `warehouse|depot|cache|vault|storage|hangar`, belonging to a
  **live** site instance, in a scene that really has a player, is filled once;
* the loot profile is the site's own (`pirate_combat_loot` preferred, `combat_overseer_loot`
  as fallback) and the items come from the site service's own generator — no type is invented;
* the items are written **inside the structure's own itemID** (owner `1` = site content,
  cargo flag `5`), which is exactly what the client reads when it opens the structure, so no
  second object appears in space;
* never doubled: existing contents win, and a refused grant is recorded once instead of being
  retried every tick. A structure a player has already emptied is not re-seeded.

## Live proof (work stack, 2026-11-05)

A real `client-dungeon:6344` instance in Perimeter, its "Sleeper Warehouse":

```
tick: {"status":"STRUCTURES_FILLED","filled":[{"itemID":777000112,"name":"Sleeper Warehouse",
       "profile":"pirate_combat_loot","items":4,
       "itemIDs":[9988400022503,9988400022504,9988400022505,9988400022506]}],"skipped":[]}
contents now: 4
   Drone Transceiver                 typeID 25615  qty 1  flag 5  owner 1
   Dread Guristas Brass Tag          typeID 17241  qty 2  flag 5  owner 1
   Domination Gyrostabilizer         typeID 13939  qty 1  flag 5  owner 1
   Domination Platinum Tag           typeID 17229  qty 1  flag 5  owner 1
```

The same `listContainerItems(ownerID, containerID, flagID)` call the client's inventory window
uses returned all four rows, so the open-cargo surface has real content.

## Still unproven, and how

The in-client view of that cargo (open the warehouse, drag an item out, see it in the ship's
hold) has not been measured yet: it needs a player inside a site after the next restart.
Evidence to collect then: `coop-site-loot-structure-filled` in `coop-events.jsonl`, the
server log line `[CoopLivingWorld] site loot structures in <system>: #<id> <name> N item(s)
from <profile>`, and the client's own cargo window.

## Related

* Site batteries that really shoot: [SITE_SENTRIES.md](SITE_SENTRIES.md).
* Loot for data/relic containers (the generator this reuses) lives in
  `dungeonUniverseSiteService` and is unchanged.
