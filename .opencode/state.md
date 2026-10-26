# State — co-op loop (mining → haul → station → sale)

Updated: 2026-10-26 ~21:55Z · HEAD `7bc50c6e` (+ this note) · loop gate `LOOP_GATE_PASS`

## The loop now closes (live, own evidence)

| stage | evidence |
|---|---|
| mine | `living-mining-cycle-settled`, `COMMITTED`, every window |
| fleet | `FLEET_COMPOSITION_OK`, real haulers (Bestower/Badger/Mammoth), no mis-roled hulls |
| load | `living-hauler-loaded` 14 466 m³ + 14 277 m³, fleet state `loaded` |
| fly | `living-npc-station-route` (`loaded` → station) |
| **sell** | **`living-npc-station-sold` `SOLD` `isk: 33 150` (×5), `sold:[{typeID:17470, quantity:5000, price:6.63}]`** |
| currency | `NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET` — real NPC ledger, never a player wallet |

Profit is real but small: 5 000 units of Gneiss at 6.63 ISK/unit.

## Fixed in this stretch (each measured, each with a test)

1. `HAULER_NOT_NAMED` — `adoptMerchant` filtered world residents on `pilot.role`, but the
   world file has no roles (the economy ledger owns them), so no hauler was ever named
   and every sale was skipped. Now the role is read from whichever layer has it and any
   free resident is acceptable.
2. Restart mid-haul stranded the fleet in `loaded` forever — an overdue trip now gets a
   durable `<manifest>.expired.json` (immutable ack untouched), `recover()` stops
   offering it, and the fleet plans a NEW trip with the ore it still carries.
3. `ORIGINAL_CARGO_OWNER_MISMATCH` — the deposit credited the *station* corporation for
   ore owned by the fleet corporation. It now credits the corporation that provably
   owned that cargo row (the owner's own hangar at that station).
4. Earlier in the same chain: cargo-volume fallback (a restart made every fill ratio 0),
   the `{success,data}` cargo-id allocator, a convergent slot re-composition, and an
   installer guard for unresolvable relative requires (which found two live instances).

## The one open item

A restart **after a sale but before the remainder deposit** leaves that trip's manifest
with cargo rows whose quantities changed by the sale, and recovery refuses it as
`ALIFE12_SOURCE_CARGO_CHANGED`. The sale is a real market fill but leaves no
warehouse-style receipt per `cargoID`, so `receiptMatches` cannot prove it.

Proposed fix (not implemented): after a `SOLD` settlement, reconcile the hauler's hull
against the trip's declared cargo per type — Σ(declared − remaining) per typeID must
equal exactly the quantity the market paid for that type, in that station, in that
settled trade — then write a durable `receipts/<cargoID>.json` with
`source:"NPC_MARKET_FILL"` and accept that provenance in `receiptMatches`. Anything that
does not reconcile exactly stays operator repair. Do NOT just expire the manifest by
hand: that would drop the only grip on the ore.

## Verification commands

```
node scripts/coop-deploy.cjs --checkout C:\Games\EveCoop\upstream-evejs\Code    # reset=47 OVERLAY_OK
cd C:\Games\EveCoop\upstream-evejs\Code
docker build -t evejs-local . && docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
docker cp scripts/coop-fleet-audit.cjs evejs-server-1:/tmp/
docker exec evejs-server-1 node /tmp/coop-fleet-audit.cjs --db /var/lib/evejs/gameStore/gamestore.sqlite
bash scripts/coop-loop-gate.sh --code-path C:\Games\EveCoop\upstream-evejs\Code
```

## Environment facts (still true)

- `miningNpcHaulerRepeatDelayMs=600000` (a trip then a 10 min cooldown), threshold 0.2,
  `EVEJS_COOP_VIRTUAL_POPULATION=48` (naming capacity; grows without wiping history).
- The pinned wing spawner clamps `minerAmount` to ≥1, so "haulers only" also adds a
  miner; the re-composition converges on the real marker set and spawns only when a
  mis-roled hull needs replacing.
- The world carries extra hulls from the early failed attempts (13 miners / 10 haulers
  in 144 and 145). Real, consistent, non-destructive; a clean acceptance prefers a
  fresh world.
- Pre-existing test noise: `coop-alife12-station-trip-recovery` 2 failures
  (`./coopStuckWarpRecovery` resolution from `tests/`) and
  `coop-alife-native-delivery-wiring` 2 failures — identical at HEAD.
