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
  there is no simulated money anywhere. The owner wants collateral-bearing
  contracts (it is the courier's insurance), so the live policy enables them
  once the NPC wallet funding path exists; the module default stays
  fail-closed (`requireZeroCollateral: true`) so nothing is accepted by
  accident.
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
  `failCourierContract`; the courier **forfeits the collateral to the issuer**,
  which is exactly what the collateral is for. With zero collateral the issuer
  gets nothing back and the courier loses only the reward. The courier's ship
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

## Blocking prerequisite found 2026-10-26: NPCs have no contract identity

A courier contract is owned by a **character**: `issuerOwnerID`/`acceptorID`,
a wallet ref, and inventory ownership. Co-op NPCs have none of that. Verified
in `gamestore.sqlite` and `coop-npc-links.json`:

- links are keyed by native space `entityID` (`980000000110`, ...), not by a
  character ID;
- the `characters` table contains only real player characters (`140000001`
  "Test Pilot", `140000005` the owner), no NPC rows;
- there is no `wallets` table at all; wallet state lives per character record.

So phase 2 needs a courier NPC that owns a **real native character record**
(account, character, wallet, inventory owner) and whose ship entity is owned by
that character - not just a durable entity. That is a much larger change than
"call acceptCourier without a session", and it must not be faked with a
synthetic character that has no wallet.

Until that exists, the only honest way to move a player contract is a second
real character (a second client or the friend), which is also the missing live
verification of the native courier path.
## Correction (2026-10-25): runtime state is SQLite, contracts do persist

An earlier version of this section claimed contracts were cache-only and lost on
restart. That was wrong, and the mistake was reading the seed directory:
`gameStore/data/*.json` is the seeded input, while live runtime state lives in
`/var/lib/evejs/gameStore/gamestore.sqlite` (+ WAL). The `contractRuntime`
table there held the owner's real contract after several container recreations.

Verified on the owner's own contract `980000000`: `type 3` (courier),
`status 0` (outstanding), `acceptorID 0`, volume 29 500 m3, reward 30 000 ISK,
collateral 300 000 ISK, package `plasticWrapItemID 9988400000874` still owned by
the issuer at the origin station. So nothing was carrying it - the record is
simply outstanding, exactly as expected with no courier implemented.

Lesson for future sessions: query `gamestore.sqlite`, not `gameStore/data`.

## Pricing: what the issuer sees before creating the contract

The owner's question is the right one - a courier contract cannot be priced by
guessing, and the client gives no rate. So the rate is published, not hidden:

`quoteCourier({ volumeM3, jumps, collateral, hullClass })` in
`integration/coopCourierDispatch.cjs` returns a breakdown:

```
total = hullMultiplier x (base + volumeM3 x iskPerM3 + jumps x iskPerJump
                          + collateral x collateralPremiumRate)
```

Defaults (owner-tuned): `base` 5 000, `iskPerM3` 25, `iskPerJump` 5 000,
`collateralPremiumRate` 0.015, `hullMultiplier` industrial 1.0 /
freighter 1.6. The base is deliberately tiny; the volume, distance and the
insurance premium are what decide the price. Freighters cost more because they
are slower and the loss is larger. The collateral premium is the insurance part: it is what the courier
charges for risking its own ISK.

Print the table before creating anything:

```powershell
node scripts/Get-CourierRateTable.cjs
node scripts/Get-CourierRateTable.cjs --volume 5000 --jumps 2 --collateral 5000000 --hull freighter
```

Every rate knob is a flag, so the price can be tuned without touching code:
`--base`, `--per-m3`, `--per-jump`, `--premium`. Example with the defaults:
5 000 m3, 2 jumps, 5 M ISK collateral, freighter = 344 000 ISK
(5 000 base + 125 000 volume + 10 000 distance + 75 000 insurance, x1.6 hull).

Honest limits: this is a **service price**, not a market clearing price. It is
not yet visible in the game client - surfacing it (a station billboard, an NPC
"courier services" agent, or a mail from the NPC hauler) is a separate phase,
and until it exists the issuer reads the table above. The rate also does not
yet react to real risk on the route; when piracy is enabled the premium should
be driven by the actual interdiction chance, not a constant.

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

## Decision: an NPC courier is a full player-equivalent actor

Owner decision (2026-10-26): we do not want a second human character. NPCs are
the second characters, and they must be real players in every respect. That
removes the synthetic-session shortcut entirely and sets the bar:

| Piece | Where it really lives (verified) |
| --- | --- |
| Wallet | `characters.<id>.json.balance` + `walletJournal` entries; there is no `wallets` table |
| Ship | a real item owned by that character, sitting at the origin station |
| Identity | `characters` row with `accountId`, `characterName`, `stationID` |
| Contract | `contractRuntime` row keyed by character ID |

The owner's own character proves the shape: `140000005` has `accountId 3`,
`balance 981397.39`, and a journal entry `-30000 "Contract 980000000 reward
escrow"`. That is exactly what an NPC courier must have for real, funded from
its own earned ISK - never a grant invented for the test.

`evaluateCourierIdentity` (pure, tested) is the fail-closed gate: no character
record, character not at the origin, balance below collateral, no ship, ship
elsewhere, or ship too small each produce a distinct refusal instead of a
half-done delivery.

Still missing before a real run: seeding one courier character (account,
character, balance from its earned ledger) and a real hauler item at the origin
station, then the session-less accept/complete adapter and the flight itself.

## Seeded courier pilots (2026-10-26)

Seven real characters exist now, one row in `characters`, `accounts` and `items`
each, all written while the server was stopped and verified present after the
restart:

| ID | Pilot | Station | Hull | Cargo | Balance |
| --- | --- | --- | --- | --- | --- |
| 140000100 | Haul Jita Charon | Jita IV-4 Bureau (60003466) | Charon | 465 000 m3 | 25 000 000 |
| 140000101 | Haul Jita Bestower | Jita IV-4 Bureau (60003466) | Bestower | 4 800 m3 | 3 000 000 |
| 140000102 | Haul Perimeter Fenrir | Perimeter II-1 Navy (60003754) | Fenrir | 435 000 m3 | 12 000 000 |
| 140000103 | Haul Amarr Providence | Amarr VIII-4 (60002569) | Providence | 435 000 m3 | 12 000 000 |
| 140000104 | Haul Dodixie Obelisk | Dodixie IX-20 Navy (60011866) | Obelisk | 440 000 m3 | 12 000 000 |
| 140000105 | Haul Rens Badger | Rens VII-17 Bureau (60004594) | Badger | 3 900 m3 | 2 500 000 |
| 140000106 | Haul Hek Mammoth | Hek IV Bureau (60004516) | Mammoth | 5 500 m3 | 2 500 000 |

Honest note: the balances are a **seeded grant**, not earnings - a brand new
character has no history, and the journal is empty on purpose rather than
invented. If the owner wants couriers funded only from real work, the grant
must be replaced by a real transfer from the co-op economy ledger.

`scripts/seed-courier-pilots.cjs` is idempotent per run (new IDs each time,
existing IDs skipped) and dry-run by default. It must be applied with the
server stopped, in a one-off container that mounts `evejs-data`, because the
live server keeps gameStore tables in a write cache.
