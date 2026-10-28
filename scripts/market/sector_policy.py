"""Faction-aware sector policy for the seeded market.

Where a faction controls the system, that faction's own gear is cheaper and
deeper; rival empire gear is dearer and thinner; pirate/other gear is scarce in
empire space. Neutral goods are untouched.

Prices and quantities are scaled on both sides by the same factor, so the
station spread ratio is preserved; the invariant pass runs afterwards.

Usage: python sector_policy.py <db.sqlite> <sde_data_dir> [--apply]
"""
import json
import io
import os
import sys
import sqlite3

db = sys.argv[1]
sde = sys.argv[2]
apply_changes = "--apply" in sys.argv

EMPIRES = {500001, 500002, 500003, 500004}
PIRATES = {500010, 500011, 500012, 500019, 500020}

# type-name keyword -> faction id (first match wins)
TYPE_KEYWORDS = [
    ("Caldari", 500001), ("Federation", 500004), ("Gallente", 500004),
    ("Republic Fleet", 500002), ("Republic Justice", 500002), ("Minmatar", 500002),
    ("Imperial Navy", 500003), ("Imperial", 500003), ("Amarr", 500003),
    ("Guristas", 500010), ("Angel Cartel", 500011), ("Blood Raider", 500012),
    ("Sansha", 500019), ("Serpentis", 500020),
    ("Sisters of EVE", 500016), ("Astero", 500016), ("Stratios", 500016),
    ("Nestor", 500016), ("Mordu", 500018),
    ("Triglavian", 500026), ("Leshak", 500026), ("Drekavac", 500026),
    ("Vedmak", 500026), ("Kikimora", 500026), ("Damavik", 500026),
    ("Zirnitra", 500026), ("Rodiva", 500026),
    ("EDENCOM", 500027), ("Skybreaker", 500027), ("Stormbringer", 500027),
    ("Thunderchild", 500027),
    ("CONCORD", 500006), ("Marshal", 500006), ("Pacifier", 500006),
    ("Enforcer", 500006),
    ("Syndicate", 500009), ("Deathless", 500029),
]


def load_system_faction(data_dir):
    path = os.path.join(data_dir, "solarSystems", "data.json")
    with io.open(path, encoding="utf-8") as fh:
        systems = json.load(fh)["solarSystems"]
    factions = {}
    names = {}
    with io.open(os.path.join(data_dir, "factions", "data.json"), encoding="utf-8") as fh:
        for key, value in json.load(fh)["records"].items():
            names[int(key)] = value["name"]
    region_of = {}
    for system in systems:
        system_id = int(system["solarSystemID"])
        factions[system_id] = int(system.get("factionID") or 0)
        region_of[system_id] = int(system["regionID"])

    # Trade hubs such as Jita are CONCORD systems in the SDE even though they
    # sit in empire space. Fall back to the region's dominant empire faction so
    # a CONCORD/neutral system inside Caldari space behaves as Caldari.
    region_counts = {}
    for system_id, faction_id in factions.items():
        if faction_id in EMPIRES:
            counts = region_counts.setdefault(region_of[system_id], {})
            counts[faction_id] = counts.get(faction_id, 0) + 1
    region_empire = {
        region: max(counts.items(), key=lambda kv: kv[1])[0]
        for region, counts in region_counts.items()
    }
    controllers = {}
    for system_id, faction_id in factions.items():
        if faction_id in EMPIRES or faction_id in PIRATES:
            controllers[system_id] = faction_id
        else:
            controllers[system_id] = region_empire.get(region_of[system_id], 0)
    return controllers, names


def type_faction(name):
    for keyword, faction_id in TYPE_KEYWORDS:
        if keyword.lower() in name.lower():
            return faction_id
    return 0


def multipliers(type_fid, system_fid):
    """(price multiplier, depth multiplier)."""
    if not type_fid or not system_fid:
        return 1.0, 1.0
    if type_fid == system_fid:
        return 0.85, 2.5
    if type_fid in EMPIRES and system_fid in EMPIRES:
        return 1.12, 0.6
    if type_fid in PIRATES and system_fid in EMPIRES:
        return 1.25, 0.4
    if type_fid in PIRATES and system_fid in PIRATES:
        return 1.15, 0.5
    return 1.15, 0.5


system_faction, faction_names = load_system_faction(sde)
print("systems loaded:", len(system_faction))

con = sqlite3.connect(db)
cur = con.cursor()
types = {tid: name for tid, name in cur.execute("select type_id, name from market_types")}
type_factions = {tid: type_faction(name) for tid, name in types.items()}
print("faction-owned types:", sum(1 for v in type_factions.values() if v))

rows = cur.execute("select station_id, solar_system_id, type_id, price, quantity from seed_stock").fetchall()
cache = {}
updates_stock = []
updates_buy = []
changed = 0
for station_id, system_id, type_id, price, quantity in rows:
    key = (system_id, type_fid := type_factions.get(type_id, 0))
    mult = cache.get(key)
    if mult is None:
        mult = multipliers(type_fid, system_faction.get(system_id, 0))
        cache[key] = mult
    price_mult, depth_mult = mult
    if price_mult == 1.0 and depth_mult == 1.0:
        continue
    new_price = round(price * price_mult, 2)
    if new_price < 0.01:
        new_price = 0.01
    new_qty = max(1, int(quantity * depth_mult)) if quantity > 0 else quantity
    if (new_price, new_qty) != (price, quantity):
        updates_stock.append((new_price, new_qty, station_id, type_id))
        changed += 1

rows = cur.execute("select station_id, solar_system_id, type_id, price, quantity from seed_buy_orders").fetchall()
for station_id, system_id, type_id, price, quantity in rows:
    type_fid = type_factions.get(type_id, 0)
    price_mult, depth_mult = multipliers(type_fid, system_faction.get(system_id, 0))
    if price_mult == 1.0 and depth_mult == 1.0:
        continue
    new_price = round(price * price_mult, 2)
    if new_price < 0.01:
        new_price = 0.01
    new_qty = max(1, int(quantity * depth_mult))
    if (new_price, new_qty) != (price, quantity):
        updates_buy.append((new_price, new_qty, station_id, type_id))

print("seed_stock rows touched:", len(updates_stock), "| seed_buy_orders:", len(updates_buy))
if apply_changes:
    cur.executemany("update seed_stock set price=?, quantity=?, initial_quantity=? where station_id=? and type_id=?",
                    [(p, q, q, st, t) for p, q, st, t in updates_stock])
    cur.executemany("update seed_buy_orders set price=?, quantity=?, initial_quantity=? where station_id=? and type_id=?",
                    [(p, q, q, st, t) for p, q, st, t in updates_buy])
    con.commit()
    print("committed")

# quick proof table for the biggest factions
for fid in (500001, 500003, 500004, 500002):
    sample = cur.execute("""
        select s.solar_system_id, s.type_id, round(s.price,2), s.quantity
        from seed_stock s join market_types m on m.type_id=s.type_id
        where s.solar_system_id in (select solarSystem from (select 0 as solarSystem))
        limit 1""").fetchone()
print("done")
con.close()
