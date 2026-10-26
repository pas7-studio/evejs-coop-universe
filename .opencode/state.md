# State — co-op loop (mining → haul → station → sale)

Updated: 2026-10-26 ~21:10Z · commits `dc46e3fc`, `3455c4ed`, `b7ccf5e6` (+ docs)

## Where the loop actually is now (live, container evejs-server-1 healthy)

| stage | evidence |
|---|---|
| mine | `living-mining-cycle-settled` ×24-61 per window, `status: COMMITTED` |
| fleet | `FLEET_COMPOSITION_OK` — 3 slots, zero mis-roled hulls, real haulers (Bestower/Badger/Mammoth) |
| load | `living-hauler-loaded` 14 466 m³ + 14 277 m³ (system 144), fleet state `loaded`, `lastHauledVolumeM3` 28 743 / 10 999 |
| fly | `living-npc-station-route` with `fleetState: loaded` |
| deliver | **BLOCKED** `living-npc-warehouse-blocked` reason `ORIGINAL_CARGO_OWNER_MISMATCH` |
| sell | **BLOCKED** `living-npc-station-sale-skipped` reason `HAULER_NOT_NAMED` |

## Two remaining blockers, in order

1. `HAULER_NOT_NAMED` (`integration/coopVirtualWorldRuntime.cjs:3107-3113`): the sale
   needs an identity-registry link for the hauler. `adoptMerchant` only links a *free*
   pilot whose role is `hauler`/`miner` from `world.snapshot().pilots` — there are 5
   pilots total and the fleet now has 10 haulers, so most hulls can never be named and
   every sale is skipped. Fix direction: name durable fleet hulls at spawn (identity
   link per ship, presentation through `scene.broadcastSlimItemChanges`) and size the
   pilot pool to the real fleet, or accept a durable native hull with its own profile
   name. Do not fake a name.
2. `ORIGINAL_CARGO_OWNER_MISMATCH` (`integration/coopNativeWarehouse.cjs:210`):
   `deposit()` requires `cargo.ownerID === station corporation`, but the ore belongs to
   the fleet corporation 1000129 (ORE) and the station belongs to another corp. The
   sale path would have removed the sold stacks first; with the sale skipped, the
   deposit refuses. Decide: route to a station owned by 1000129, or deposit into the
   seller's own hangar (verify the cargo owner, credit that corporation) instead of the
   station operator. Do not weaken "credit only the proven owner of this cargo row".

## Fresh facts worth keeping

- Config in the image: `miningNpcHaulerRepeatDelayMs=600000`,
  `miningNpcHaulerCargoCapacityM3=65000`, `miningNpcHaulerCargoCapacityM3` caps
  *mining-table* only; `miningNpcHaulThresholdRatio=0.2`.
- `getNpcOreCargoVolume()` read `entry.volume`, which
  `nativeNpcStore.buildNativeCargoItems()` never sets → after any restart the fill
  ratio was 0 and the fleet never dispatched. Fixed by `coopCargoVolume`
  (`EVEJS_COOP_CARGO_VOLUME_FALLBACK=1`).
- `allocateCargoID()` answers `{success, data}`, not a bare id; assuming a number made
  every partial load fail and marked the miners for operator repair, which then masked
  the cause as `HAUL_MINER_NOT_PHYSICALLY_ATTESTED`. Fixed.
- The pinned wing spawner clamps `minerAmount` to ≥1 twice, so a "haulers only" spawn
  also adds one miner. The recompose therefore converges on the REAL marker set and
  spawns only when a mis-roled hull needs replacing.
- The world carries extra hulls (13 miners/10 haulers in 144 and 145, 8/5 in 30100032)
  left by the early failed attempts. They are real, consistent and non-destructive; a
  clean acceptance run would rather use a fresh world.

## Verification commands

```
node scripts/coop-deploy.cjs --checkout C:\Games\EveCoop\upstream-evejs\Code   # reset=47 OVERLAY_OK
docker build -t evejs-local . && cd Code && docker compose -f compose.yaml -f compose.coop-probe.yaml up -d
docker cp scripts/coop-fleet-audit.cjs evejs-server-1:/tmp/ && docker exec evejs-server-1 node /tmp/coop-fleet-audit.cjs --db /var/lib/evejs/gameStore/gamestore.sqlite
bash scripts/coop-loop-gate.sh --code-path C:\Games\EveCoop\upstream-evejs\Code
```

Loop gate: all suites PASS except `module-coverage`, which fails on another session's
untracked `integration/coopCourierGateHop.cjs`.
