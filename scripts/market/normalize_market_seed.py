"""Enforce the seed spread invariants on a generated market.sqlite.

Rules (see docs/MARKET_SEED_ECONOMY_DESIGN.md):
  INV-1  per station: bid <= ask_station * (1 - min_spread)
  INV-2  per system : max(bid) <= min(ask) * (1 - min_spread)
Bids are only ever lowered, never raised. Summary tables are rebuilt for the
affected rows so the client cannot see a crossed book either.

Usage: python normalize_market_seed.py <db.sqlite> [min_spread_percent] [--apply]
Without --apply it only reports.
"""
import json
import sqlite3
import sys

db = sys.argv[1]
min_spread = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
apply_changes = "--apply" in sys.argv
k = 1.0 - min_spread / 100.0

con = sqlite3.connect(db)
con.execute("pragma journal_mode=WAL")
con.execute("pragma synchronous=NORMAL")
cur = con.cursor()


def system_counts():
    row = cur.execute("""
      with asks as (select solar_system_id sys, type_id, min(price) ask from seed_stock where quantity>0 group by 1,2),
           bids as (select solar_system_id sys, type_id, max(price) bid from seed_buy_orders where quantity>0 group by 1,2)
      select count(*), coalesce(sum(case when bids.bid >= asks.ask then 1 else 0 end),0),
             coalesce(sum(case when bids.bid > asks.ask*(1-?/100.0) then 1 else 0 end),0)
      from asks join bids on bids.sys=asks.sys and bids.type_id=asks.type_id
    """, (min_spread,)).fetchone()
    return {"pairs": row[0], "crossed": row[1], "inside_floor": row[2]}


before = system_counts()
print("before:", json.dumps(before))

if not apply_changes:
    print("dry run only; pass --apply")
    sys.exit(0)

# Per-system best ask per type.
cur.execute("drop table if exists temp.best_ask")
cur.execute("""create temp table best_ask as
  select solar_system_id sys, type_id, min(price) ask
  from seed_stock where quantity>0 group by solar_system_id, type_id""")
cur.execute("create index temp.idx_best_ask on best_ask(sys, type_id)")

violations = cur.execute("""
  select b.station_id, b.type_id, b.price, a.ask
  from seed_buy_orders b
  join best_ask a on a.sys=b.solar_system_id and a.type_id=b.type_id
  where b.quantity>0 and b.price > a.ask*(1-?/100.0)
""", (min_spread,)).fetchall()
print("bid rows to clamp:", len(violations))

changed_types = set()
for station_id, type_id, bid, ask in violations:
    new_bid = round(ask * k, 2)
    if new_bid < 0.01:
        new_bid = 0.01
    cur.execute("""update seed_buy_orders
                   set price=?, updated_at=datetime('now'),
                       price_version=price_version + case when price<>? then 1 else 0 end
                   where station_id=? and type_id=?""",
                (new_bid, new_bid, station_id, type_id))
    changed_types.add((station_id, type_id))

# Rebuild the system/region summaries from the corrected tables so the client
# never reads a stale crossed book.
cur.execute("delete from system_seed_summaries")
cur.execute("""
  insert into system_seed_summaries
    (solar_system_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
     best_bid_price, total_bid_quantity, best_bid_station_id, updated_at)
  with asks as (
      select solar_system_id sys, type_id, min(price) ask, sum(quantity) aq
      from seed_stock where quantity>0 group by 1,2),
    ask_st as (
      select s.solar_system_id sys, s.type_id, min(s.station_id) st
      from seed_stock s join asks a on a.sys=s.solar_system_id and a.type_id=s.type_id and a.ask=s.price
      where s.quantity>0 group by 1,2),
    bids as (
      select solar_system_id sys, type_id, max(price) bid, sum(quantity) bq
      from seed_buy_orders where quantity>0 group by 1,2),
    bid_st as (
      select b.solar_system_id sys, b.type_id, min(b.station_id) st
      from seed_buy_orders b join bids x on x.sys=b.solar_system_id and x.type_id=b.type_id and x.bid=b.price
      where b.quantity>0 group by 1,2)
  select a.sys, a.type_id, a.ask, a.aq, ast.st, x.bid, coalesce(x.bq,0), bst.st, datetime('now')
  from asks a
  left join ask_st ast on ast.sys=a.sys and ast.type_id=a.type_id
  left join bids x on x.sys=a.sys and x.type_id=a.type_id
  left join bid_st bst on bst.sys=a.sys and bst.type_id=a.type_id
""")
cur.execute("delete from region_summaries")
cur.execute("""
  insert into region_summaries
    (region_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
     best_bid_price, total_bid_quantity, best_bid_station_id, updated_at)
  with asks as (
      select region_id reg, type_id, min(price) ask, sum(quantity) aq
      from seed_stock where quantity>0 group by 1,2),
    ask_st as (
      select s.region_id reg, s.type_id, min(s.station_id) st
      from seed_stock s join asks a on a.reg=s.region_id and a.type_id=s.type_id and a.ask=s.price
      where s.quantity>0 group by 1,2),
    bids as (
      select region_id reg, type_id, max(price) bid, sum(quantity) bq
      from seed_buy_orders where quantity>0 group by 1,2),
    bid_st as (
      select b.region_id reg, b.type_id, min(b.station_id) st
      from seed_buy_orders b join bids x on x.reg=b.region_id and x.type_id=b.type_id and x.bid=b.price
      where b.quantity>0 group by 1,2)
  select a.reg, a.type_id, a.ask, a.aq, ast.st, x.bid, coalesce(x.bq,0), bst.st, datetime('now')
  from asks a
  left join ask_st ast on ast.reg=a.reg and ast.type_id=a.type_id
  left join bids x on x.reg=a.reg and x.type_id=a.type_id
  left join bid_st bst on bst.reg=a.reg and bst.type_id=a.type_id
""")

con.commit()

after = system_counts()
print("after:", json.dumps(after))
summary_bad = cur.execute("""select count(*) from system_seed_summaries
  where best_bid_price >= best_ask_price""").fetchone()[0]
neg = cur.execute("""select count(*) from seed_buy_orders b
  join seed_stock s on s.station_id=b.station_id and s.type_id=b.type_id
  where b.price >= s.price""").fetchone()[0]
print("summary rows still crossed:", summary_bad, "| station rows crossed:", neg)
print("changed bid rows:", len(changed_types))
con.close()
