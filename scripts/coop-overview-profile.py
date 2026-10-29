#!/usr/bin/env python3
"""Build an overview profile whose presets match THIS build's static data.

The panel hides a row when ``slimItem.groupID not in filterGroups``
(``eve/client/script/ui/inflight/overview/slimItemDisplayChecker.pyj``). Group ids move between
builds - a destroyer is 420 here, an exhumer 543, the NPC mining hulls 1764/1765/1766, a station 15 -
so a profile written against older static data matches almost nothing and the panel looks broken
while the server is classifying every entity correctly (measured live: 32 dynamic + 236 static
entities, zero without ``groupID``).

This script keeps a known-good profile's schema (columns, colours, background states) and replaces
only ``presets`` and ``tabSetup`` with presets derived from the SDE that is actually running:

  All         every group of celestial/station/ship/entity/deployable/structure
  Ships       the ship and NPC-entity groups
  Hostile     NPC entity groups that are combat hulls (deadspace/mission/pirate/incursion/sentry)
  Travel      suns, planets, moons, belts, stargates, stations, beacons, wormholes
  Loot        wrecks, cargo/secure/freight/spawn containers, shipping crates
  Deployable  mobile deployables, POS arrays, upwell structures

Usage:
  python scripts/coop-overview-profile.py --sde itemTypes.json --template alife-base.yaml \
      --out coop-overview.yaml
"""
import argparse
import json
import re

import yaml

CELESTIAL = 2
STATION = 3
SHIP = 6
ENTITY = 11
DRONE = 18
DEPLOYABLE = 22
STRUCTURE = 23
UPWELL = 65

TRAVEL_NAMES = re.compile(
    r"^(Sun|Planet|Moon|Asteroid Belt|Stargate|Station|Warp Gate|Beacon|Landmark|Wormhole|"
    r"Cosmic Signature|Cynosural Field)", re.I)
LOOT_NAMES = re.compile(r"(Wreck|Container|Crates|Audit Log)", re.I)
HOSTILE_NAMES = re.compile(
    r"(Deadspace|Mission|Asteroid (Angel|Blood|Guristas|Serpentis|Sansha|Rogue)|Incursion|Sleeper|"
    r"Drone|Sentry|Pirate|Commander|Officer|Faction|CONCORD|Navy|Squadron|Patrol|Battleship|"
    r"Cruiser|Frigate|Destroyer|BattleCruiser|Barge|Hauler)", re.I)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sde", required=True, help="gameStore/data/itemTypes/data.json")
    parser.add_argument("--template", required=True, help="a profile the client already imported")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    document = json.load(open(args.sde, encoding="utf-8"))
    types = document.get("types") or []
    if isinstance(types, dict):
        types = list(types.values())

    by_group = {}
    for row in types:
        group = int(row.get("groupID") or 0)
        category = int(row.get("categoryID") or 0)
        if group <= 0 or category <= 0:
            continue
        entry = by_group.setdefault(group, {"category": category, "name": str(row.get("groupName") or "")})
        if not entry["name"]:
            entry["name"] = str(row.get("groupName") or "")

    def groups_where(predicate):
        return sorted(group for group, info in by_group.items() if predicate(info))

    everything = groups_where(lambda info: info["category"] in
                              (CELESTIAL, STATION, SHIP, ENTITY, DRONE, DEPLOYABLE, STRUCTURE, UPWELL))
    ships = groups_where(lambda info: info["category"] in (SHIP, ENTITY))
    # A friendly mining fleet is not hostile: the NPC hull groups carry "Mining"/"Industrial" in
    # their names and would otherwise sit in the Hostile tab.
    hostile = groups_where(lambda info: info["category"] == ENTITY
                           and HOSTILE_NAMES.search(info["name"])
                           and not re.search(r"(Mining|Industrial)", info["name"], re.I))
    travel = groups_where(lambda info: info["category"] in (CELESTIAL, STATION)
                          and (TRAVEL_NAMES.search(info["name"]) or info["category"] == STATION))
    loot = groups_where(lambda info: info["category"] == CELESTIAL and LOOT_NAMES.search(info["name"]))
    deployable = groups_where(lambda info: info["category"] in (DEPLOYABLE, STRUCTURE, UPWELL))
    drones = groups_where(lambda info: info["category"] == DRONE)

    wanted = [
        ("Coop: All", everything),
        ("Coop: Ships", ships),
        ("Coop: Hostile", hostile or ships),
        ("Coop: Travel", travel),
        ("Coop: Loot", loot),
        ("Coop: Deployable", deployable),
        ("Coop: Drones", drones),
    ]
    for name, groups in wanted:
        print(f"{name:18} groups={len(groups)}")
        if not groups:
            raise SystemExit(f"refusing to write a preset with no groups: {name}")

    profile = yaml.safe_load(open(args.template, encoding="utf-8"))
    profile["presets"] = [
        [name, [["alwaysShownStates", []], ["filteredStates", []], ["groups", groups]]]
        for name, groups in wanted
    ]
    colours = ["0xFF33FF99", "0xFF3399FF", "0xFFFF3300", "0xFF9966FF", "0xFFFFCC00", "0xFF66FFCC",
               "0xFF66CCFF"]
    profile["tabSetup"] = [
        [index, [
            ["bracket", None],
            ["color", None],
            ["name", f'<color={colours[index % len(colours)]}><fontsize=12> {name.split(": ")[1]} </fontsize></color>'],
            ["overview", name],
        ]]
        for index, (name, _groups) in enumerate(wanted)
    ]

    with open(args.out, "w", encoding="utf-8") as handle:
        yaml.safe_dump(profile, handle, default_flow_style=False, sort_keys=False, width=2000,
                       allow_unicode=True)
    print(f"WROTE {args.out}")


if __name__ == "__main__":
    main()
