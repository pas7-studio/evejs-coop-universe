# State — co-op loop (mining → haul → station → sale)

Updated: 2026-10-26 ~22:50Z · HEAD `f494bff0` + docs

## Proven live, twice

`living-npc-station-sold` `SOLD` with **real ISK**: 33 150 (21:30) and **36 250** (22:37),
`NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. The rest of the chain in the same runs:
`living-mining-cycle-settled` (COMMITTED) → `living-hauler-loaded` (14 466 / 14 277 m³)
→ fleet state `loaded` → `living-npc-station-route` → sale.

## Fixed in this stretch (each measured, each tested where the logic is unit-testable)

1. `HAULER_NOT_NAMED` — `adoptMerchant` filtered world residents on `pilot.role`, but the
   world file has no roles. Now the role is read from whichever layer has it and any
   free resident is acceptable.
2. A sale left no provable trace: it removes the hull row through a real market fill and
   never creates a station item, so recovery read the trip as "cargo changed" forever.
   A settled sale now writes a durable receipt per row and the trip journal accepts it.
3. Rows are **partly** sold (5 000 of a 54 999 row). The receipt records the units the
   hull actually lost (accumulating over fills), and the journal accepts a row whose
   remainder equals declared − sold, counting it as still aboard.
4. A closed route is skipped BEFORE accounting — this ordering bug meant the first
   expiry had no effect and the fleet stayed blocked.
5. Overdue trips and superseded manifests are closed durably (own fsynced record; the
   warp ack stays immutable) and re-planned from the hull, never resumed and never faked.
6. Deploy/installer: the reset now restores from HEAD (not the shared index, which was
   shipping another session's staged half-patch), an L1-owned file is not "drift", the
   installer list regained the 14 modules a merge had dropped, and two broken relative
   requires were found by the new guard and fixed.

## Open item (named, reproducible)

`MANIFEST_WAREHOUSE_RECEIPT_CONFLICT` blocks the trip AFTER a sale when the manifest is
**verified**: `coopNativeHaulManifest.verify` (lines ~123-135) requires
`receipt.quantity === row.quantity` and a matching warehouse stock item, which a sale
receipt and a partly sold row can never satisfy. Fix direction: verify must accept a
sale receipt for the difference (`sold = declared − remaining`, no stock item expected)
exactly as the trip journal already does, and only for the sold units.

## Operator actions taken (documented, not silent)

Two historic trips whose ore was sold before sale receipts existed were closed with the
journal's own `expire` through an explicit script
(`node /tmp/expire-trip.cjs <system-fleet-startedAt> HISTORIC_SALE_WITHOUT_RECEIPT --confirm`,
emitting `living-native-trip-expired-by-operator`). No receipt was invented, no cargo was
touched, and both manifests remain on disk.

## Commands

```
node scripts/coop-deploy.cjs --checkout C:\Games\EveCoop\upstream-evejs\Code   # reset=49 OVERLAY_OK
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local . && docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
bash scripts/coop-loop-gate.sh --code-path C:\Games\EveCoop\upstream-evejs\Code
```
