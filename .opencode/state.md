# State — co-op loop (mining → haul → station → sale)

Updated: 2026-10-26 ~23:10Z · HEAD `4e32bbca` (pushed)

## Proven live (twice, different runs)

`living-npc-station-sold` `SOLD` with real ISK — **33 150** (21:30) and **36 250** (22:37),
`NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. Same runs: `living-mining-cycle-settled`
(COMMITTED) → `living-hauler-loaded` (14 466 / 14 277 m³) → fleet `loaded` →
`living-npc-station-route` → sale. Mining and loading continue afterwards
(28 settled cycles + 4 new loads after the last restart).

## Fixed here (all pushed, tested where unit-testable)

1. `HAULER_NOT_NAMED` — the role filter read the world file, which has no roles.
2. Sale left no provable trace → durable per-row fill receipt; the trip journal accepts it.
3. Rows are **partly** sold (5 000 of 54 999) → the receipt records the units the hull
   lost (accumulates), and the journal accepts a remainder = declared − sold.
4. A closed route is skipped BEFORE accounting (that ordering bug made the first expiry
   a no-op).
5. `verify()` required an exact warehouse receipt + hangar item, so a market fill could
   never close a row → a fill is now proven by its own quantity and type; a deposit still
   needs the exact stack.
6. Overdue/superseded trips are closed durably (own fsynced record, ack untouched) and
   re-planned from the hull.
7. Deploy/installer: reset from HEAD (not the shared index), L1-owned file is not drift,
   19 modules a merge had dropped are back in the installer list, and the new
   require-resolution guard found and fixed two live broken requires.

## Remaining blocker (exact)

After a sale, the next trip can still stop with
`ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF`: a declared row is gone and the
accumulated fill receipt names the *last* station, while the manifest names the trip's
station — so the row cannot be proven for this manifest. Fix direction: make the fill
receipt carry a per-station breakdown (`fills: [{stationID, quantity, at}]`) and let the
journal prove a row against the fills of the manifest's own station, summing them.

## Operator actions taken (explicit, logged)

Two historic trips whose ore was sold before receipts existed were closed with the
journal's own `expire` via an explicit script
(`node /tmp/expire-trip.cjs <system-fleet-startedAt> HISTORIC_SALE_WITHOUT_RECEIPT --confirm`,
emitting `living-native-trip-expired-by-operator`). No receipt was invented, no cargo was
touched; both manifests remain on disk.

## Environment

`EVEJS_COOP_VIRTUAL_POPULATION=48`, `EVEJS_COOP_FLEET_COMPOSITION=1`,
`EVEJS_COOP_MINING_FILL_CAP=1`, `EVEJS_COOP_CARGO_VOLUME_FALLBACK=1`.
The world carries extra hulls from early failed attempts (13 miners / 10 haulers per
slot) — real, consistent, non-destructive. A clean acceptance prefers a fresh world.

## Commands

```
node scripts/coop-deploy.cjs --checkout C:\Games\EveCoop\upstream-evejs\Code   # reset=49 OVERLAY_OK
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local . && docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
bash scripts/coop-loop-gate.sh --code-path C:\Games\EveCoop\upstream-evejs\Code
```
