"""Read-only audit of a market.sqlite seed.

Prints the numbers the playbook cares about: crossed books, depth spread and
price sanity. Never writes.

Usage: python audit_market_seed.py <market.sqlite>
"""
import sqlite3
import sys

db = sys.argv[1]
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = con.cursor()

print("== tables ==")
for name, in cur.execute("select name from sqlite_master where type='table' order by name"):
    count = cur.execute(f'select count(*) from "{name}"').fetchone()[0]
    if count:
        print(f"  {name}: {count}")

print("== crossed books ==")
print("  station:",
      cur.execute("""select count(*) from seed_stock s join seed_buy_orders b
                     on b.station_id=s.station_id and b.type_id=s.type_id
                     where s.quantity>0 and b.quantity>0 and b.price>=s.price""").fetchone()[0])
row = cur.execute("""
  with asks as (select solar_system_id sys, type_id, min(price) ask from seed_stock where quantity>0 group by 1,2),
       bids as (select solar_system_id sys, type_id, max(price) bid from seed_buy_orders where quantity>0 group by 1,2)
  select count(*), coalesce(sum(case when bids.bid>=asks.ask then 1 else 0 end),0),
         round(coalesce(avg(case when bids.bid>asks.ask then (bids.bid-asks.ask)/asks.ask*100 end),0),2)
  from asks join bids on bids.sys=asks.sys and bids.type_id=asks.type_id""").fetchone()
print(f"  system : pairs={row[0]} crossed={row[1]} avg_excess={row[2]}%")

print("== depth ==")
for table in ("seed_stock", "seed_buy_orders"):
    buckets = cur.execute(f"""
      select case when quantity<10 then '<10' when quantity<1000 then '10-1k'
                  when quantity<100000 then '1k-100k' when quantity<1000000 then '100k-1M'
                  else '>=1M' end b, count(*)
      from {table} group by 1 order by 2 desc""").fetchall()
    print(f"  {table}: {buckets}")

print("== price sanity (seed ask vs price_history average) ==")
try:
    rows = cur.execute("""
      with seed as (select type_id, avg(price) ask from seed_stock group by type_id),
           hist as (select type_id, avg(avg_price) hp from price_history where avg_price > 0 group by type_id)
      select case when seed.ask/hist.hp < 0.5 then '<0.5x' when seed.ask/hist.hp < 2 then '0.5-2x'
                  when seed.ask/hist.hp < 10 then '2-10x' when seed.ask/hist.hp < 1000 then '10-1000x'
                  else '>=1000x' end b, count(*)
      from seed join hist on hist.type_id=seed.type_id and hist.hp>0 group by 1 order by 2 desc""").fetchall()
    print("  ratio buckets:", rows or "no history rows (honest empty history)")
except sqlite3.OperationalError as error:
    print("  skipped:", error)

con.close()
