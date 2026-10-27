# Co-op mining loop: deploy and acceptance runbook

One page for the miner → hauler → station → sale loop. It records what actually
had to be true before this loop ran, so the same four dead ends are not re-entered.

## 1. Gates before a build (all local, no CI)

```sh
scripts/coop-loop-gate.sh --code-path 'C:\Games\EveCoop\upstream-evejs\Code'
```

It must end with `LOOP_GATE_PASS`. Without `--code-path` it runs only the repo-side
suites; with one it also runs the structural overlay gates (require resolution,
flag baseline) and the isolated real-engine GameStore gate
(`Verify-Coop-GameStore-Atomic-Isolated.cjs`, `PASS COOP_032D_PINNED_GAMESTORE_DISPOSABLE`).

`scripts/coop-deploy.cjs --checkout 'C:\Games\EveCoop\upstream-evejs\Code'` must print `CHECK_OK series=6` and
`OVERLAY_OK`, and it now refuses three classes of silent failure: a module that
keeps a `.cjs` sibling require, a hook that requires a module the overlay never
installs, and a drifted managed file.

## 2. Deploy

```sh
node scripts/coop-deploy.cjs --checkout 'C:\Games\EveCoop\upstream-evejs\Code' --build
docker compose -p evejs -f compose.yaml -f compose.coop-probe.yaml up -d
```

Flags that must be on for the closed loop (probe compose): `EVEJS_COOP_NATIVE_MINING`,
`NATIVE_MINING_SLOT_RECONCILE`, `NATIVE_MINING_SLOT_SELFHEAL`, `NATIVE_MINING_FLEET_DURABLE`,
`NATIVE_MINING_CYCLE_ATOMIC`, `NATIVE_MINING_CARGO_INTEGRITY`,
`NATIVE_MINING_CYCLE_CONSERVATION`, `NATIVE_ATOMIC_ROWS`,
`NATIVE_CARGO_TRANSIENT_ISOLATION`, `NATIVE_HAUL_CARGO`, `NATIVE_HAUL_TRANSFER_ATOMIC`,
`NPC_STATION_DELIVERY`, `MINING_LOCK_GUARD`, `MINING_TRACE`.

## 3. What the events must say, in order

| stage | event | pass condition |
| --- | --- | --- |
| activation | `living-mining-blocker` `MODULE_ACTIVATED` | `present=true`, `miningEffect=true` |
| mining | `living-mining-cycle-settled` | `quantity>0`, rock `beforeRock -> afterRock` |
| haul | `living-hauler-loaded` | `cargoQuantity>0`, `haulerID>0` |
| delivery | `living-npc-station-delivered` | `stationID>0`, `stacks>0` |
| sale | `living-npc-station-sold` | `status=SOLD`, `quantity`, `isk` |
| refinery | `living-npc-refined` | `status=COMMITTED`, paid fee in the journal, mineral stacks in the corporation hangar |
| mineral lift | `living-npc-mineral-lifted` | one `coop-mineral-lift:v1` row per stack in the hauler's native cargo, hangar stack debited |
| mineral sale | `living-npc-station-sold` | a `sold[]` entry whose `typeID` is a mineral (34/35), never ore |
| treasury | `living-corp-treasury-swept` | `movedISK>0`, `ownerID` = the corporation that paid the refinery fee |

Everything that refuses prints its own reason, and those reasons are the answer:
`ACTIVATION_SKIPPED:<no-module|no-scene-api>`, `CAPACITOR_WAIT`,
`MODULE_ACTIVATED` with `present=false` (the effect never reached the ship the fleet
reads) or `miningEffect=false` (activated, but the runtime did not treat it as a
mining effect), `MODULE_STOP_*` (`stopReason`, `entityError` = the ALIFE07/ALIFE10
refusal that stopped it), `living-haul-no-hauler` (`skipped[]` per hull:
`out-of-range`, `no-capacity`, `full`, `warping`, `needs-repair`),
`living-haul-custody-blocked:<reason>`, `living-npc-station-sale-skipped`
(`status:reason`).

## 4. Acceptance (proves the loop and a restart)

```sh
scripts/restart-acceptance.sh --wait-load-min 20 --after-restart 240
```

It fails fast with `NO_CARGO_WITHIN_WINDOW` or `FAIL_NO_DURABLE_ROW_BEFORE_RESTART`,
prints `DURABLE_BEFORE`, then after the restart `RESTART_PASS|RESTART_FAIL`, and ends
with `LOOP_PASS` or `LOOP_FAIL:<stage>` from `scripts/loop-verdict.cjs`. A sale can
only be waived explicitly (`--no-require-sale`); a skipped sale is always printed
with the runtime reason.

## 5. Fleet composition (why the hauler matters)

`EVEJS_COOP_FLEET_COMPOSITION=1` makes the spawn choose hulls **per role and per
corporation wallet** (`integration/coopFleetComposition.cjs`): a corp below 250M ISK
flies T1 (`ore_mining_badger_hauler`…), above it T2 (`ore_mining_occator_hauler`…);
miners are picked from `venture/retriever` or `skiff/hulk`. With the flag off, the
pinned spawner keeps its configured query. Every ID is a real row in
`tools/DatabaseCreator/staticTables`.

Measured failure this fixes: all three durable "hauler" slots were Mining Ventures
(`typeID 32880`, 50 m³ hold) while miners were Skiffs and Hulks, so
`living-haul-no-hauler` reported `why:"full", capacityM3:50, needM3:9533` and ore
could never leave the belt. An existing slot with a mining hull in the hauler role
must be re-composed: keep the hull as an extra miner and add a real hauler, never
destroy a durable ship to make the acceptance pass.

The repair is code, not a manual edit: on start, a slot whose hauler hull is not a
hauler profile is re-composed **additively** (`repairSlotComposition` in
`integration/coopNativeMiningFleetDurable.cjs`): the mis-roled hull keeps its entity
ID, modules and cargo and is re-marked as an extra miner, one real hauler from the
tier pool is spawned beside it, and `living-fleet-slot-recomposed` records the change
in the slot witness (`demotedHaulerIDs`, `addedHaulerIDs`, `keptMisroledHaulerIDs`).
A mis-roled hull that already holds ore is never re-marked — its cargo would be
orphaned — so it stays a hauler and a real hauler is added next to it.

## 5b. Fill cap and partial loads

Two independent limits kept ore in the belt even after the fleet was composed right:

- **`EVEJS_COOP_MINING_FILL_CAP=1`** (`integration/coopMiningFillCap.cjs`) lowers the
  capacity the dispatch trigger compares against to what the fleet can really carry
  right now (real SDE `capacity` of the haulers minus what they already hold). The
  stock trigger waits for 85 % of the *miner's* own hold (Hulk: 8 000 m³), which no
  industrial can take. Events: `living-mining-fill-cap` with `status: CAP_APPLIED`,
  `HAULER_HOLD_UNUSABLE` (a 50 m³ hull never silently stops mining) or
  `CAP_UNPROVEN`.
- **A hauler moves what physically fits** (`coopNativeHaulCargo` +
  `coopNativeHaulTransferAtomic`): when no hull can take the whole row, the largest
  free hold takes a partial load in ONE atomic `npcCargo` transaction — the source row
  keeps its cargoID with the remainder, the moved units become one new cargo row and
  one receipt (`partial:true`, `sourceCargoID`, `remainingQuantity`). Nothing is
  invented, nothing is merged, and a request larger than the stack is a normal full
  move. This is what drains stacks that grew to 8 000–18 777 m³ before the cap
  existed.

## 6. Known traps (each one cost hours)

- A hook module that is not installed throws inside stock code and the caller
  swallows it per tick: the feature looks configured and idle. Never accept "no
  events" as "nothing to do" without an entry event.
- `npcCargo` is one table for durable **and** transient (stock) cargo. An atomic
  transaction that touches it must declare its table set as a cargo contract.
- A config refusal must never mark a hull `NEEDS_OPERATOR_REPAIR`; only a real
  custody question may, and the stored reason must survive.
- The mining loop's target lock belongs to the mining cycle, not to the NPC idle
  combat state.
