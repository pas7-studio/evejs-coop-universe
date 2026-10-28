"""Differentiated seed depth: not every item deserves 686M units.

Bulk (ore, minerals, charges, commodities) stays deep; ships, blueprints,
SKINs, implants and structure modules become scarce. Quantity is only ever
reduced, never increased, and the per-row ISK value is capped as well.

Usage: python volume_policy.py <db.sqlite> [--apply] [--value-cap-millions=500]
"""
import hashlib
import sqlite3
import sys

db = sys.argv[1]
apply_changes = "--apply" in sys.argv
value_cap = 500_000_000.0
for arg in sys.argv:
    if arg.startswith("--value-cap-millions="):
        value_cap = float(arg.split("=", 1)[1]) * 1_000_000.0

# category_id -> (hard cap per station row)
CATEGORY_CAPS = {
    4: 5_000_000,    # Material (ore, minerals, PI input)
    8: 2_000_000,    # Charge (ammo, scripts)
    17: 200_000,     # Commodity
    18: 2_000,       # Drone
    7: 250,          # Module
    6: 5,            # Ship
    9: 3,            # Blueprint
    20: 2,           # Implant
    91: 1,           # SKIN
    66: 5,           # Structure Module
    65: 1,           # Structure
    32: 3,           # Subsystem
    87: 20,          # Fighter
    23: 250_000,     # Reaction
    41: 50_000,      # Planetary Commodity
    43: 5_000,       # Planetary Industry
}
DEFAULT_CAP = 10_000

# price fallback for anything without a category rule:
PRICE_TIERS = [
    (100.0, 5_000_000),
    (1_000.0, 500_000),
    (10_000.0, 50_000),
    (100_000.0, 5_000),
    (1_000_000.0, 500),
    (10_000_000.0, 50),
    (100_000_000.0, 5),
    (float("inf"), 1),
]


def cap_for(category_id, price):
    if category_id in CATEGORY_CAPS:
        return CATEGORY_CAPS[category_id]
    for limit, cap in PRICE_TIERS:
        if price < limit:
            return cap
    return 1


def spread_factor(type_id, station_id):
    """Deterministic 0.55..1.00 so equal classes are not identical."""
    h = hashlib.blake2b(f"{type_id}:{station_id}".encode(), digest_size=4).digest()
    return 0.55 + (int.from_bytes(h, "big") % 46) / 100.0


con = sqlite3.connect(db)
cur = con.cursor()


def summarize(table):
    cur.execute(f"select count(*), sum(quantity), sum(price*quantity) from {table}")
    n, q, v = cur.fetchone()
    print(f"  {table}: rows={n} units={q:,} value={v/1e9:,.1f}B ISK")


print("before:")
summarize("seed_stock")
summarize("seed_buy_orders")

meta = {tid: (cat, price) for tid, cat, price in
        cur.execute("select type_id, category_id, base_price from market_types")}

stats = {"changed": 0, "kept": 0}
examples = []
for table in ("seed_stock", "seed_buy_orders"):
    rows = cur.execute(f"select station_id, type_id, price, quantity from {table} where quantity > 0").fetchall()
    updates = []
    for station_id, type_id, price, quantity in rows:
        category, base = meta.get(type_id, (0, price))
        cap = cap_for(category, price if price > 0 else base)
        target = int(cap * spread_factor(type_id, station_id))
        if price > 0:
            value_rows = int(value_cap / price)
            target = min(target, max(1, value_rows))
        target = max(1, min(quantity, target))
        if target != quantity:
            updates.append((target, table, station_id, type_id))
            stats["changed"] += 1
        else:
            stats["kept"] += 1
        if table == "seed_stock" and type_id in (34, 35, 16264) and len(examples) < 6:
            examples.append((type_id, station_id, price, quantity, target))
    cur.executemany(f"update {table} set quantity=? where station_id=? and type_id=?", [(u[0], u[2], u[3]) for u in updates])

con.commit()
print("after (committed)" if apply_changes else "after (dry run, not committed)")
summarize("seed_stock")
summarize("seed_buy_orders")
print("rows changed:", stats["changed"], "| unchanged:", stats["kept"])
for tid, station, price, before, after in examples:
    print(f"  example type={tid} station={station} price={price} {before:,} -> {after:,}")

buckets = cur.execute("""
select case when quantity < 10 then '<10' when quantity < 1000 then '10-1k'
            when quantity < 100000 then '1k-100k' when quantity < 1000000 then '100k-1M'
            else '>=1M' end b, count(*)
from seed_stock group by 1 order by 2 desc""").fetchall()
print("seed_stock depth buckets:", buckets)
if not apply_changes:
    con.rollback()
con.close()
