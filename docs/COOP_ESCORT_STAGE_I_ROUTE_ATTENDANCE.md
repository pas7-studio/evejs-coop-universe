# COOP-054 — Stage I: native real-route escort participation

Status: **source implemented, experimental/default OFF, NOT VALIDATED in 2 real EVE clients**. Date: 2026-10-25. Integration branch: `feat/escort-stage-h-jobs-integration-20261025` (Draft PR #117, based on Draft PR #102). Pinned original client/server source remains untouched.

## Why Stage I exists

Stage H's native departure and terminal witnesses close the easiest station-camping exploit but do not prove that a pilot actually accompanied the physical NPC hauler during transit. This code deliberately refuses to infer attendance from a chat command, Agent Accept, elapsed game timer, mail or accepted quote.

## True source flow

1. Stage H records genuine native cargo, independently priced NPC corporate escrow consent, and two authenticated stock EVE fleet pilots on the **original** NPC source grid. A durable original departure receipt now includes immutable **hauler origin coordinates**.
2. Original full-cargo manifest and corporate escrow are recorded by the native GameStore; the Stage H physical warp fence prevents duplicate departure.
3. Opt-in Stage I samples only from `coopNativeStationArrival.tick(scene,fleet)`. The native station, NPC and cargo route are checked by the server before the call. Runtime reads the original **FUNDED** native flight journal and immutable source witness; no client can select a contract or ship ID.
4. `coopEscortRouteWitness` computes NPC progress as the projection of its actual scene position on the original source → native destination station vector. It accepts two distinct segments of real movement: **20–45%** and **55–85%**, with timestamps at least 500 ms apart. Both players must have one unique authenticated active session, the **same original native ship IDs**, the same valid EVE fleet and be **within 10 km** of the actual NPC at each checkpoint. No samples can be generated from station camping, separate fleet, missing pilots or timers alone.
5. Each stage has a separate **exclusive-create, file+directory fsynced** source journal under `root/escort-route-witness/<manifestKey>.stage-1.json` and `.stage-2.json`. Rows carry original signed character IDs, ship IDs, hauler, corporation, contract, station, stage, original source coordinates, destination, native NPC and both pilot positions, clock and progress. Original records are never overwritten. A crash/lost ACK requires explicit re-fsync of **both** stages before payout; symlink, hardlink, corrupted or substituted records fail closed.
6. When `EVEJS_COOP_ESCORT_ROUTE_WITNESS=1`, peaceful terminal settlement needs Stage H real full warehouse delivery, native corporate escrow, original two-pilot departure receipt, **both independently durable midroute samples**, and real two-pilot on-grid terminal attendance. No passive client command grants pay. Stage H native pirate/wreck path remains separately authorized and unchanged.

## Security invariants

- No free ISK, fabricated NPC ship, simulated cargo, automatic warp, or automatic NPC job offer is created by Stage I.
- Source and terminal checks remain required even when route samples exist; a replayed or damaged route journal cannot mint funds.
- Cumulative on-route time **is not inferred**. Two trustworthy point observations establish two checkpoints, not continuous physical tracking or combat contribution. A player could leave the escort between recorded checkpoints; contribution-weighted pay is **not yet implemented**.
- Real native warp may complete in ~250 ms in the current overlay configuration. **If the server tick never sees two midroute windows, Stage I correctly refuses payout.** Until a real two-client, event-timestamped native movement test confirms visibility and pacing, this is an experimental strict flag; **do not enable with real money or live world.**
- No persistent player or NPC data was modified during source development. Run scenario manifests on a disposable snapshot only.

## Flags

`EVEJS_COOP_ESCORT_ROUTE_WITNESS=1` — experimental, **OFF by default** and only relevant with `EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT=1` and `EVEJS_COOP_ESCORT_DEPARTURE_WITNESS=1`. Original NPC bank, route gate, warp fence, native inventory and per-character consent flags must remain independently configured. Enabling this flag does not configure/enable any wallet authority by itself.

## Local verification

Run `scripts/Run-NativeJob-Tests.ps1 -CheckPinned` on the approved local Windows machine. Stage I additions:
- `tests/coop-escort-route-witness.test.mjs`: real sample-source scenarios, 2-pass progress and strict original identity, 10-km anti-AFK, session disconnect, duplicated actors, wrong native fleet, changed destination, corruption, hardlink/symlink, fsync ACK recovery and OFF guard. **V8 source-executed with mocked fs**, official local Node suite NOT_RUN.
- `tests/coop-escort-route-attendance-gate.test.mjs`: runtime wallet/direct caller and peace payout permission gate. **V8 source-executed**, official Node suite NOT_RUN.
- `tests/coop-escort-station-predeparture-gate.test.mjs`: Stage I observer wired to native station director tick without client action. **V8 source-executed**, official Node suite NOT_RUN.
- `tests/scenarios/coop-049-native-agent-opportunities.json`: operator-owned actual two-client tests; `status: NOT_RUN`.

**Release blocker:** prove original stock NPC physical warp emits at least two real intermediate scenes that can be observed before terminal arrival. If it does not, capture native movement updates at the stock warp-progress authority rather than lowering security thresholds, inventing synthetic samples or changing the bank to pay on a timer. Record true source coordinates and EVE wallet deltas for both pilots on a throwaway world snapshot.
