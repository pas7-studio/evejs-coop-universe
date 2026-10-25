# NPC courier contracts (design)

Status: **design + pure decision core only. Nothing here is enabled, and no
NPC has ever carried a player contract.** Do not describe this as working until
the verification ladder at the bottom passes on a live server.

Goal: the owner creates a normal native courier contract (same system, or
later across systems) for a real ship or cargo, an NPC hauler accepts it, flies
it, and delivers it to the destination station - and hostile NPCs may try to
take it en route. No invented money, no invented cargo, no invented kills.

## Why this is not a one-line feature

`contractRuntimeState.acceptCourier(contract, session, acceptForCorp)` is
session-driven: it resolves the acceptor owner and wallet from the client
session. An NPC has no session, so it cannot call it. Everything below exists
because of that single fact.

The project already solved the same shape of problem for the NPC market: the
rule there is "consume real seeded stock, update exact native cargo, spend only
the NPC's durable earned ISK ledger, halt on ambiguous RPC results"
(`docs/NATIVE_NPC_MARKET.md`). Courier dispatch follows that rule, not a new
one.

## Native touchpoints (pinned upstream `c3ea396b`)

| Concern | Native owner | Note |
| --- | --- | --- |
| Contract record | `server/src/services/contracts/contractRuntimeState.js` | `contractType`, `status`, `startStationID`, `endStationID`, `endSolarSystemID`, `volume`, `reward`, `collateral`, `plasticWrapItemID`, escrow fields |
| Accept | `acceptCourier` (session-based) | needs a session-less adapter, see below |
| Deliver | `completeCourierContract` | guard already requires the original acceptor |
| Fail | `failCourierContract` | transfers real cargo/ISK; same guard |
| Package | `transferItemToOwnerLocation` + `plasticWrapItemID` | package is a real item, never a synthetic flag |
| Hull | stock native spawn service | real typeID and real cargo capacity |
| Cross-system | `coopNativeGateTransfer` / `coopNpcGateTravel` | real reciprocal stargate, currently OFF pending live QA |
| Piracy | `coopNativeRaids`, `coopNpcHostility`, `coopNativeConsequences` | requires a real attack order; NPC-vs-NPC friendly by default |

## Phases

### Phase 1 - pure decision core (implemented, default OFF, no mutation)

`integration/coopCourierDispatch.cjs` answers, without touching state:

- `evaluateContract(contract, policy)` - is this contract dispatchable at all?
- `selectHull(volume, hulls)` - smallest native hull that actually fits.
- `planRoute(contract, stations)` - ordered legs inside one solar system.
- `piracyOpportunity(route, policy)` - whether a pirate group may be given a
  real attack order on a leg.

Rules encoded here, not in the server loop:

- only `contractType === "courier"`, status `outstanding`;
- the package must exist (`plasticWrapItemID > 0`) and the volume must be
  known and positive;
- `collateral` must be `0`, or fully covered by the NPC's **native** wallet;
  there is no simulated money anywhere;
- volume must fit the chosen hull's real capacity, otherwise the contract is
  refused rather than partially loaded;
- same-system only in phase 1; a cross-system contract is reported as
  `NEEDS_GATE_TRAVEL`, never silently attempted;
- an expired or already-accepted contract is refused.

### Phase 2 - session-less native accept

A native adapter that performs exactly what `acceptCourier` does, but with
explicit owner/wallet refs instead of a session, and only for an owner that is
a registered durable NPC (`coopIdentityRegistry` + `coopNativeRestore`).
Required before any mutation: real character record, real wallet key, real
delivery flag, package transfer result. If any step is ambiguous the adapter
stops and journals - it never repeats a possibly applied write.

### Phase 3 - the flight

Undock from the origin station with the package on board, warp to the
destination, dock, complete. Same system only. The hauler is a real ship with
real capacity for the contract volume, not a renamed frigate.

### Phase 4 - cross-system

Gate travel through a real reciprocal stargate, then the same dock/complete
step. Stays behind its own flag until the same ship, controller, modules and
cargo are verified at the destination (`docs/NATIVE_NPC_GATE_TRAVEL.md`).

### Phase 5 - piracy en route

An ambush may only happen when a hostile NPC group can be given a **real**
native attack order on the same scene as the courier. Outcomes:

- courier survives and delivers - reward paid, contract finished;
- courier is destroyed - native wreck, native loot, native
  `failCourierContract`, collateral lost, issuer notified. The courier's ship
  and cargo are gone for real; nothing is restored to make the test pass.

No scripted "pirate spawns because the timer fired" without a physical hostile
present, and no fake destruction events.

## Invariants (violating any of these makes the feature a lie)

1. Every ISK movement is a native wallet movement; the NPC spends only its own
   earned balance.
2. Every item movement is a native inventory movement; the package is the real
   `plasticWrapItemID`.
3. A contract is completed only through the native completion path with the
   correct acceptor identity.
4. Any ambiguous result halts the courier and journals it; no retry of a
   possibly applied write.
5. No player-facing claim of success without a captured live run.
6. Default OFF; every phase has its own env gate.

## Env gates (all default OFF)

- `EVEJS_COOP_COURIER_DISPATCH=1` - allow a durable NPC to accept courier work.
- `EVEJS_COOP_COURIER_GATE_TRAVEL=1` - allow cross-system legs.
- `EVEJS_COOP_COURIER_PIRACY=1` - allow hostile NPCs to be given a real attack
  order against a courier in transit.

## Telemetry

Events the verification depends on (real values only, no synthetic activity):
`living-native-courier-considered`, `-accepted`, `-undocked`, `-arrived`,
`-delivered`, `-failed`, `-interdicted`, `-halted`.

## Verification ladder

1. Unit tests for the pure core (this phase).
2. Read-only pass on the live server: does the dispatch loop see the owner's
   real contract and refuse or accept it for the stated reason?
3. One real same-system delivery with the owner watching in a client: package
   leaves the origin, arrives, reward moves, contract finishes.
4. Destruction case: courier killed en route, contract fails natively, wreck
   and loot exist, nothing restored.
5. Cross-system only after 1-4 pass, with the same ship verified at the
   destination.

Each step is recorded with revision, env flags and evidence; a passing unit
test is never reported as gameplay.
