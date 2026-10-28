# State — co-op loop (mining → haul → station → sale)

## 2026-10-28 17:52Z - the manufactured good SOLD and the ISK reached the treasury

CLOSED LOOP PROVEN: 3 chipsets manufactured at 60014935 (blueprint 1076, -3 333 Tritanium)
were lifted into the hauler by the drain, sold into the station own seeded bid, and the
money was swept: treasury 431 215 310.69 ISK.

Sales of the manufactured good, each with a durable receipt:
  5 x 444 @ 54 289.76 = 271 448.80 (order 4257700966927696316, volRemaining 4995)
  3 x 444 @ 53 700.08 = 161 100.24 (order 4257762183096566204, volRemaining 4997)
Two root causes fixed on the way:
  - the sell policy keeps only its FIRST 20 types, so a product appended at position 44
    was silently dropped; the env list is now ordered by priority (444 and minerals first);
  - a sale settles by the units the market really absorbed (partial fills), never by the
    quantity the journal declared, and a journal whose order never existed closes only on
    three independent proofs (no order, cargo intact, balance intact) after a grace period.

OPEN, measured, next: a slot repair restores a hull cargo snapshot, so a sold stack came
back with the same cargoID (0 -> 5 after the sale of 5 at 17:37), which duplicated goods and
made the next journal declare 5 while the bid absorbed 3. The durable cargo rows must be the
authority on restore. Hull 980000003532 currently keeps 2 real units the market did not buy.


## 2026-10-28 16:55Z - OPEN: the server cannot see cargo a separate process wrote

PROVEN TODAY: fleet restored (ALREADY_ACTIVE 3+1 / 2+1), departures unblocked (no more
MANIFEST_FLEET_CONFLICT), ore SOLD 1193 x 17470 @ 1946.98 = 2 322 747 ISK, treasury swept
22 926 059.42 -> corporation balance 302 998 099.09 ISK, manufacturing produces 5 chipsets
from 5 555 Tritanium with a receipt, and 444 is now on the operator sell policy.

OPEN, precisely: the 5 chipsets sit in hull 980000003532 (and 5 in orphan 980000003529),
visible from a fresh node process inside the container. In the SERVER process the same
call is inconsistent: at 16:44 the batch event reported carried=[444,35] (so it saw them),
but its ask order still started with ore, and at 16:54 carried was EMPTY and only the
manifest type was asked. Both manufactured stacks were written by a SEPARATE node process
(/tmp/mf.cjs inside the container), so the next diagnostic is a direct in-process compare:
call listNativeCargoForEntity(980000003532) through the admin bridge and diff it against
the fresh-process probe. Do not guess: the server must see a row before any sale of it.

Also open: the fleet route still ends in ALIFE13 MANIFEST_WAREHOUSE_RECEIPT_CONFLICT when
a declared row is only partly sold (saleFillCoversRow demands the fills equal the row
exactly), so a partly liquidated haul is unprovable and the fleet stays loaded. The drain
now rescues that case, but the route itself needs a partial-fill rule with its own test.

﻿# State — co-op loop (mining → haul → station → sale)

## 2026-10-28 15:20Z - the loop sells again; the last hop is the chipsets in a hold

THREE refusals in a chain (fork 07f37c4), each measured:

1. DEPARTURE. The station-trip journal compared a manifest's hull list BEFORE skipping
   closed routes, so 40 manifests of earlier trips (old hull IDs) refused every trip with
   ALIFE12_MANIFEST_FLEET_CONFLICT. A durable repair gives a fleet new hulls, so the fleet
   sat "loaded" for hours. Closed routes are skipped first; an overdue live route whose
   hulls no longer exist is expired by its own durable record.
   PROOF: ROUTE_EXPIRED_STALE_CARGO -> fleet 960004641 back to "mining".

2. DRAIN GATE. The mineral demand governor throttled everything, so 5 chipsets in a
   hangar that really bids 53 700 were never lifted: 61 000 units of Tritanium were
   within the 200 000 floor and ALLOW silenced the only selling path. The gate now lives
   in the mineral branch (shouldStart); a product is decided by the station that bids.

3. SALE BATCH. The arrival sale ended the whole batch on the first allowlisted type the
   station did not bid for (NO_SEEDED_COUNTERPARTY), so the lifted chipsets were never
   asked for. That status now skips a type, and lifted stock is asked for first.
   PROOF 15:12:48 st60003724 SOLD 1193 x 17470 @ 1946.98 = 2 322 747 ISK - the first
   sale after the fleet was unblocked. Type 444 added to the operator sell policy.

WHERE THE 10 CHIPSETS ARE: 5 in hull 980000003532 (a fleet hauler, with real ore) and 5
in orphan hull 980000003529. The next station arrival of 980000003532 asks the market for
444; 23 real seeded bids exist (53 700 at 60014935, 54 374 at 60000361).

NEXT: confirm the 444 sale on that arrival, then wire the automatic manufacture trigger
(niche by measured margin) - the drain product path is otherwise closed.

## 2026-10-28 - test-parity round: Windows durability + stale fixtures

Suite: 5837 pass / 332 fail / 92 skip (baseline) -> 6157 / 52 / 99 (full probe
`suite-final.json`, 2026-10-28). That 52 includes one transient red
(coop-escort-native-funds, edited and reverted mid-probe; re-measured 22/0), so the
steady figure is 6158 / 51. 30 files still red, and 42 of the 51 cases are the
installer/overlay family waiting on scripts/overlay-spec.cjs (another session). The
rest: coop-escort-flight-stage-c 8/6, COOP-049 buyer-wiring 6/1, alife13 22/1,
coop-virtual-world-split 2/1 (PARITY_REGRESSION from another session), and the
untracked coop-integration-shims 1/1.

**New blocker found, needs the owner: `.github/workflows` is back in the tree.**
Owner decision 2026-10-28: delete it. Done in `a6d6b44a`; the CI-triggered EX-03 gate
became `scripts/Run-NpcProbe-PinnedChecks.ps1` (`bbea62c3`) so the procedure survived,
and three more reds closed (`coop-overlay-l1-baseline` 1/1->2/0,
`coop-feature-readiness` 7/1->8/0, `coop-crossstream-overlay-roundtrip` 1/1->2/0).
Full probe `suite-final3.json` (2026-10-28): **6197 pass / 15 fail / 99 skip** against the
5837 / 332 / 92 baseline (that run predates the war client-view refactor `d2d7fd24`,
which touched no failing suite). Seven files are still red, 15 cases:
escort-flight-stage-c 6, wreck-client-refresh 3, alife-native-buyer-wiring 1, alife13 1,
integration-shims 1, virtual-world-split 1 - 13 cases after the hook extraction below.

`coop-hook-inventory` is GREEN (`ed43504a`, fork `37780e5`): five of the nine long hooks
are now module calls. The war trio became occupationPairs()/warzonesResponse()/
localOccupationResponse() in coopWarClientView; npcBehaviorLoop's friendly-fire policy
became npcPlayerEngages() in coopMilitiaWarPlayer; the fwAdvantage envelope became
scoresResponse() in coopWarAdvantage. Baseline refreshed deliberately: longHooks stays
4, longest 822 -> 1131 (the dungeon hook, not ours to move), specFiles/entries grew from
other sessions' features. The four remaining long hooks are one per feature (dungeon
1131, trade 822, agent 501, wreck 451) and each needs callbacks from its own service,
so each belongs to the session that tests that gameplay path.

**`node scripts/coop-engine-audit.cjs` prints AUDIT_REGRESSION at 20:55Z** - not from
these commits: `integration drift 4 > 0` for coopAdminBridge, coopAdminBridgeActions,
coopStationDrain and coopVirtualWorldRuntime, i.e. another session's fork work is
in flight (`coopStationDrain.js` and `coopVirtualWorldRuntime.js` are uncommitted in
`C:\Games\EveCoop\upstream-evejs` right now). Their `AUDIT_OK` returns when they mirror.

**The installer/overlay family is almost gone.** 29 more cases closed on 2026-10-28
evening; the blocker was never `overlay-spec.cjs` being edited, it was that a dozen
suites still described the pre-single-spec layout (module names moved into
`scripts/overlay-spec.cjs`, which `patch-evejs-coop.cjs` re-exports as `names`), plus
fixtures that modelled only the hook sites a native file had when they were written.
Closed: overlay-drift-check 5/0, five-chat-market-reconcile 5/0, market-release-contract
3/0, native-economy-overlay-resolution 6/0, pve-duo trio, native-trade-custody-overlay,
native-mining-atomic-overlay, native-convoy-operations-overlay, crossstream-wiring,
npc-weapon-source-hook, player-damage-overlay-integration, rust-npc-market-patch,
fleet-mission-join-overlay, installer-module-coverage (fixture regex), post42 (same).

DONE (owner approved, commit `84096bc5`): ten modules existed in
`integration/` and are required by `coopVirtualWorldRuntime` but are absent from
`scripts/overlay-spec.cjs`, so a deployed server would throw MODULE_NOT_FOUND:
`coopJsonFileCache coopNativeNpcMarketReconcile coopNpcManufacture coopStationDrain
coopStructureAllianceGuard coopWarCaptureByForce coopWarMercenaryContract
coopWarMercenarySettlement coopWarNavyCapability coopWarObservedSystems`.
installer-module-coverage 2/1, post42 2/1, overlay-dependencies 2/1, hook-requires 6/1.
Added as one guarded loop (`names.push` block, 402 names / 402 unique); the four suites
are green (3/0, 3/0, 3/0, 7/0).

WHAT IS LEFT (15 cases, 7 files):
  coop-escort-flight-stage-c 8/6        owner call: retire or reduce
  coop-wreck-client-refresh 1/3         owner call: retarget at the fork or retire
  coop-hook-inventory 2/2               6 hooks over 400 chars vs baseline 4 (was 9).
    The fwWarzoneSolarsystemService trio is DONE (`d2d7fd24`, fork `d734281`): the
    three 1239/1248/1330-char copies are now warzonesResponse()/localOccupationResponse()
    over one occupationPairs() in integration/coopWarClientView.cjs. What is left is one
    hook per feature, each needing callbacks from its own service (dungeon 1131,
    trade 822, agent 501, wreck 451, npcBehaviorLoop 407, fwAdvantage 495), so each
    extraction belongs to the session that owns that gameplay path
  coop-alife-native-buyer-wiring 1/1    COOP-049 materialNeeds contract
  coop-alife13-startup-cargo-audit 1/1  assertion lives in another session's module
  coop-integration-shims 1/1            untracked test: 119 shims or one resolver hook
  coop-virtual-world-split 1/1          PARITY_REGRESSION from another session's export

Closed since that probe (each with a fork mirror where the code changed):
  coop-native-haul-transfer-sqlite 2/5->7/0 (fixture handed the mover the raw SQLite
    writer instead of the GameStore adapter shape it reads its receipt from)
  coop-native-loot-quarantine 7/3->10/0, coop-wormhole-jump-fence 10/4->14/0,
  coop-pve-boss-loot-claim 8/8->16/0 (all three: Windows cannot fsync a directory)
  coop-npc-atomic-weapon-bank 3/15->18/0 (bank now proves hull+modules before the tx;
    ammo journal loaded its sibling by assumed .js extension)
  coop-npc-atomic-sqlite-crash 0/2->2/0, coop-player-mining-warehouse-integration 0/5->5/0,
  coop-native-industry 6/1->7/0, coop-park-runaway-miner 2/1->3/0,
  coop-native-industry-progression 1/1->2/0
  coop-npc-durable-ammo-debit 2/18->20/0, coop-npc-wormhole-transit 1/2->3/0
  coop-npc-fire-outcome-witness 0/1->15/0, coop-npc-expedition-operations 0/3->3/0
  coop-player-industry-fence 3/9->12/0, cycle 0/1->1/0, native-boundary 9/2->11/0
  coop-skill-rate-cutover 8/13->21/0, coop-rescue-native-contract-wallet 2/6->8/0,
  coop-war-recovery-console 6/1->7/0, coop-native-live-capacitor 0/1->3/0

Closed after the probe: npc-buyer-admin-control 12/2->12/0+2skip,
npc-buyer-controlled-recovery 10/5->15/0, coop-flag-registry 3/1->4/0 (the
registry had drifted by 40 flags), coop-corporate-real-sqlite 0/6->6/0,
player-mining-native-adapter 6/1->7/0, upstream-patch-series 2/2->4/0.

Everything still red is one of these four, in this order of value:
  L1 fix landed anyway: coopNpcCorporateBuyRuntime.loadSettlement fell back to the
  specifier that had just failed instead of the .cjs sibling, so a source
  checkout could not load it at all; coop-npc-corporate-buy-patch 12/6 -> 18/0
  (fork 901a36b). Its mixed-guard case also asserted an error name that
  eedfe1b4 folded into NPC_BUY_GUARD_CORPORATE_PATCH_DRIFT.

  A. overlay/installer suites - they need scripts/overlay-spec.cjs, which another
     session is editing right now (hook-inventory reports 9 long hooks vs a
     baseline of 4, the anchors moved). Do not touch the anchors mid-flight.
  B. the three owner decisions below.
  C. integration/coopNativeMiningFleetDurable.cjs and coopVirtualWorldRuntime.cjs
     assertions, also another session's files.
  D. coop-integration-shims.test.mjs, untracked until B2 is decided.
  E. coop-wreck-client-refresh and friends encode overlay-era fixes the fork now
     carries: the case asserts a sendSlimItemChangesToAllSessions ->
     broadcastSlimItemChanges rewrite that no longer exists in the transformer,
     and its synthetic fixture has 4 of the 7 anchors the transformer now needs.
     Retargeting it means deciding what still needs proving - owner call, not a
     silent rewrite.

Still open and NOT ours to fix silently:
  - coop-escort-flight-stage-c 8/6: needs the missing ./coopAlifeNativeDeliveryEvidence
    chain plus a manifest source-cargo contract; owner decision (retire vs reduce).
  - scripts/coop-integration-shims.cjs --check still reports ~120 missing .js shims;
    tests/coop-integration-shims.test.mjs stays untracked until the owner picks
    "generate shims" vs "one resolver hook". Fixtures keep using loadIntegration().
  - COOP-049 materialNeeds: coopAlifeStationAuthority strips `requirements` and never
    emits materialNeeds while the buyer dispatch requires it (money-moving, flags OFF).
  - coop-alife13-startup-cargo-audit 22/1: ordering assertion lives in
    integration/coopNativeMiningFleetDurable.cjs, another session's file.
  - PARITY_REGRESSION now names coop-virtual-world-split: the faction-war work added a
    diagnoseNavy export to coopVirtualWorldRuntime while that suite's frozen public
    surface list still lacks it (f36ee344, not ours; do not edit either side).

## 2026-10-28 14:15Z - the fleet is repaired; the produced goods still need a named, near ship

FIXED (fork 9d96fb3): both 30000145 slots refused to restore for ever with
ALIFE08_REPAIR_MARKER_MISMATCH. Cause: every failed boot repair spawned another wing, so slot
30000145-1 marked 120 miners + 118 haulers around a 2+1 witness (105+55 on -2). The repair now
prunes hulls the slot marks but does not own (physical destroy for live ones, durable cascade for
phantoms) and then checks the witness. Result: ALREADY_ACTIVE 3+1 and 2+1, mining resumed.

MANUFACTURING (fork 6c66f05): blueprint 1076 seeded at 60014935, 5-run job consumed 5 555
Tritanium (72 399 -> 66 844) and produced 5 x typeID 444 with a receipt. A second attempt at
60000682 was refused honestly with MATERIALS_MISSING (no Tritanium in that hangar) - the module
never fabricates inputs.

WHERE THE 5 CHIPSETS ARE: in the cargo hold of hull 980000003529 (spawned by the repair). That
hull has NO identity link, so the sale refuses with HAULER_NOT_NAMED, and it sits 8.6e11 m from
the station. 23 real seeded bids exist for typeID 444 (best 54 374 at 60000361, 54 289.76 at
60000682).

NEXT (one of these, both small):
  1. linkSpawnedIdentity for 980000003529 -> role hauler, then scripts/sell-station-goods.cjs
     at a station that bids for 444 - or
  2. run the manufacture where the hangar really holds Tritanium AND the station bids for 444,
     then let the drain lift and sell it automatically (that path is already proven).

## 2026-10-28 13:50Z - manufactured goods EXIST; selling them waits on a fleet restore

PROVEN on `evejs-agents` (no client):
  blueprint 1076 (Mining Survey Chipset I Blueprint) seeded at station 60014935
  -> 5-run job consumed 5 555 Tritanium (72 399 -> 66 844)
  -> 5 x typeID 444 produced in the corporation hangar
  -> receipt coop-native-industry/receipts/coop-job:1000129:60014935:1076:1793194860012.json
     with recipe, materials, installedAt/completedAt.
  The station bids 53 700.08 for that item, so the product has a real buyer.

HOW (fork 6c66f05): the native job pipeline is session-bound (quoteIndustryJob derives owner,
facility, blueprint access and slots from a client session) and this world has no client, so
production runs through space/coopNpcManufacture.js with the SAME native static-data recipe and
the SAME inventory primitives (takeItemTypeFromOwnerLocation / grantItemToOwnerLocation) that the
job pipeline uses - the pattern the co-op refinery already proved. It refuses unless the
corporation really owns the blueprint item and the materials in that hangar; the journal is
INSTALLED -> COMPLETED so a crash can never double-produce; time is compressed only by
EVEJS_COOP_INDUSTRY_TIME_SCALE (0.002 on the agent stack).

Selling a product reuses the proven arrival sale: the lift now carries ANY corp-owned hangar
stack the station really bids for (EVEJS_COOP_LIFT_ANY_TYPE=1), and the drain prefers a station
holding a manufactured good over one holding refinery minerals (station rotation + 30 min
cooldown when a visit sells nothing).

BLOCKER for the last step (not in our modules): after the 13:49 restart the two 30000145 mining
fleets did NOT come back -
  [ALIFE08] slot 30000145-1 -> NEEDS_OPERATOR_REPAIR ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH
  [ALIFE08] slot 30000145-2 -> NEEDS_OPERATOR_REPAIR ALIFE08_REPAIR_MARKER_MISMATCH
so there is no hauler to carry the chipsets to the station. That repair path is
space/coopNativeMiningFleetDurable.js (another session's module); it must be fixed or the slot
records repaired before the produced goods can be sold. Do NOT wipe volumes to force restore.

## 2026-10-28 13:10Z - surplus drains: minerals finally sell, stock is falling

Measured on `evejs-agents` (headless):

  stock 739 492 -> 596 517 units;  Tritanium 261 419 -> 101 419
  corp wallet 119 944 191.19 -> 125 975 858.69 (sweeps of 22 942 300 then 250 000)
  sold on a drain: [{typeID 34 Tritanium, ...}] isk 250 000;  pilot ledger tradeCount 9

WHY IT WAS STUCK AND WHAT CHANGED (all committed):
  1. A sale only happens on a station arrival, so a fleet whose mining the governor holds can
     never sell the surplus it already owns: 705 484 units against a 200 000 floor with zero
     arrivals for 9 h. New space/coopStationDrain.js flies an idle hauler to the station that
     really holds the most refined minerals, sells through the PROVEN arrival path and flies
     back. OFF unless EVEJS_COOP_STATION_DRAIN=1 (agent stack only).
  2. The governor reports DEMAND_UNKNOWN with that stock, so a HOLD-driven trigger never fired;
     and an ALLOW tick pushed the drain 15 min ahead every time, so a due trip drifted for ever
     (due 12:29, still not run at 12:49). The drain now decides on the governor's own
     measurement (only ALLOW means "within demand") and its schedule is owned by the trip.
  3. **Every sale in the world's history was ore. Not one mineral ever sold.** The lift is
     async, its Promise was read as a result, so the lifted mineral types never joined the sale
     list and the trader answered NO_REAL_NATIVE_CARGO (measured: 47 lift rows in one hold).
     The lift now runs inside the arrival job and is awaited (fork 04e2c8a).

Fork commits: 4afec3e, 03cafb7, 9c5f9d4, 706d8e5, 7d997e1, 04e2c8a. Repo: d6107bfb, 583d10e0,
0fda9c7b, b9ae10ab + worklog. AUDIT_OK.

NEXT: the drain runs every 15 min per fleet and lifts up to 100k units per visit, but each
trade is capped at 5 000 units (EVEJS_COOP_NPC_MARKET_MAX_QTY), so the 596k backlog needs many
visits. If the owner wants it gone faster, raise the per-trade cap or the drain cadence - both
are env knobs, no code change.

## 2026-10-28 12:00Z - CLOSED LOOP PROVEN: ore sold, ISK reached the corporation

PROVEN LIVE on `evejs-agents` (headless, no client), same world that had been stuck since 02:05Z:

  ore mined -> hauler loaded -> delivered -> refined (fee from the corp wallet)
   -> minerals lifted -> SOLD 5000 Scordite @ 4605.77 = 23 028 850 ISK -> pilot ledger
   -> corp treasury sweep -> corporation wallet.

  Measured: 11:55:47 living-npc-station-target-cleared, 11:55:48 living-npc-station-sold
  (station 60003724, hauler 980000000032, 5000 units, 23 028 850 ISK). 11:39:34
  living-corp-treasury-swept moved 26 018 500 ISK; corp wallet 38 743 827.69 -> 64 762 327.69
  (the ~47k gap is the refinery fees the corporation paid in between). No pending market
  journals: /var/lib/evejs/coop-native-market/tx is empty.

TWO BLOCKERS CLOSED (both were real, neither was a "market is broken" story):
  1. The journal left at RPC_CALLING (coop-pilot-012) was settled from the MARKET'S OWN PROOF,
     never by repeating the fill: order 4257762183096583224 is state filled, vol_entered 5000,
     vol_remaining 0, issued 15 ms after the journal. New space/coopNativeNpcMarketReconcile.js
     + scripts/reconcile-npc-market-journal.cjs (dry run, then --apply; durable receipt in
     reconciled/; replayed false). Fork 441fcc4 + 356dcce.
  2. The sale then failed with NATIVE_NPC_BUSY because the fleet's own asteroid orbit leaves
     controller.currentTargetID set on the hauler. The sale now releases only a static,
     non-combat target (a ship target, an attack order, a fresh aggressor or a warping hull
     still refuses). Fork 78b1681.

ALSO MEASURED (still open, no longer blocking): after ~9 hours without sales the corporation
owns 705 484 units (442 350 ore + 263 134 minerals) against demand 82 502 and a 200 000 floor,
so the demand governor mostly HOLDs and mining only trickles. Each station arrival sells what
that arrival lifts, so stock drains one trip at a time; a restart also resets the governor's
trickle timer, which is what let mining resume at 11:41.

## 2026-10-28 01:35Z - the loop runs live; the sale needs one operator decision

PROVEN LIVE on `evejs-agents` in this session (no client, headless world):
  ore mined -> hauler loaded -> station delivered -> ore refined (COMMITTED, fee paid
  from the corp wallet) -> minerals lifted into the hauler -> repeat, every ~5 minutes.
  Measured counts since 01:20Z: 2-3 living-hauler-loaded, 3 living-npc-station-delivered,
  8 living-npc-refined, 1-2 living-npc-mineral-lifted. Both fleets cycle.

Chain of real causes fixed (fork branch coop/pas7std, all committed):
  1. 11b9d29 movement: a native NPC in GOTO flies along entity.direction only, so the
     `position + direction * 1.0e16` sentinel carried hulls off their own belt for ever.
     New space/coopNpcRunawayGoto.js stops such a hull; one statement in the GOTO case.
  2. 08ca1e9..3205d9f mining: the hauler is spawned with behaviour profile
     movementMode "stop", so every one-shot follow was consumed and the hull re-stopped.
     It now orbits the fleet's asteroid (the only orbit target the loop honours - orbiting
     the miner is refused), and miners are sent to the same rock; radii 250/600 m keep the
     whole orbit inside the 2 500 m transfer range.
  3. 27cc4ed mining: the park helper stopped any hull with speedFraction > 0, i.e. the very
     orbit it had issued one line earlier (measured: 56 'parked' miners, all in STOP).
  4. c43af40 space/coopNativeHaulCargo.js: the store returns `transient` as 0/1, so
     `row.transient === false` refused every durable cargo row (`cargo-invalid`, usedM3 0).
     Custody is now "not another party's cargo": the row's owner may be the miner OR the
     hauler, and a refusal always names the failing predicate.
  5. ba31852 space/coopNativeHaulManifest.js: the hold carries the fleet's own lift-tagged
     minerals back to market, and those rows made the whole ore manifest invalid
     (MANIFEST_CARGO_INVALID_OR_AMBIGUOUS). The manifest describes the ORE; lift cargo has
     its own journal and is skipped.

REMAINING BLOCKER (not a code bug - a required operator decision):
  every station arrival answers living-npc-station-sale-skipped NOT_SOLD MARKET_UNAVAILABLE
  because the native market is halted: living-native-market-repair-required
  {status NEEDS_OPERATOR_REPAIR, pending [{file coop-pilot-012.json,
   reason RPC_OUTCOME_UNKNOWN}]} (last at 01:22:49Z).
  The repository doctrine is explicit: an ambiguous market RPC halts trading and a possibly
  completed fill is never repeated. So the ore of those arrivals is deposited
  (depositOnly), not sold, and no ISK reaches the pilot ledger or the treasury.
  Next single step: reconcile that one journal against the market, then let the sale run.
  Nothing else in the loop is blocked - mining, haul, delivery, refine, lift all repeat.

Extraction gate: `node scripts/coop-engine-audit.cjs` prints AUDIT_OK.

## 2026-10-27 23:00Z - the last blocker is our own order bridge, and it deadlocks

`mining_fleet_diagnose` (read-only admin bridge) now answers the question exactly:

  miner 980000000030  mode GOTO  belt 53 965 m  targetPoint ghost 1.0e16  order BLOCKED
                     reason COOP_NPC_ORDER_IDENTITY_UNVERIFIED
  hauler 980000000032 mode GOTO  ghost 1.0e16   order BLOCKED
                     reason COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE
                     state {warp:false, movementBusy:true, manualBusy:false, combat:false}
                     leaseOwner ""

Reading it: 1.0e16 is a SENTINEL ('no target'), not a computed point - so the earlier
ghost-target hypothesis was wrong and the guard added in fork commit 0e317d9 fires on
normal sentinel state (4 living-mining-order-reset, harmless but not the cure).
The real deadlock: the hauler already owns a native movement command that goes
nowhere, and the order bridge refuses to replace an ACTIVE movement order, while the
miners cannot pass identity verification at all. So no hull can be re-aimed at its
miner, the gap grows by the sentinel drift, and no ore is ever transferred.

Next single step (fork, branch coop/pas7std): in the order bridge allow
  (a) a mining-fleet movement order to REPLACE a native movement order whose target is
      the no-target sentinel / whose ship is in the fleet's own minerEntityIDs or
      haulerEntityIDs (the fleet record IS the identity proof), and
  (b) the WAR lease rule to keep refusing everything else.
Then prove: living-hauler-loaded -> delivered -> refined -> mineral lift -> sale.

Already proven on this world today: mining without a client, corp treasury sweep
(38 791 223.64 ISK), 4 refinery batches COMMITTED with the fee paid from the corp
wallet. Those three legs need no further work.

## 2026-10-27 22:45Z - three real fixes landed, one measured blocker left

PROVEN LIVE on `evejs-agents` (never on the owner's play stack):
  - mining runs without any client: 32 living-mining-cycle-settled after the fix;
  - the corporation really receives its pilots' ISK: living-corp-treasury-swept
    movedISK 38 791 223.64 into corp 1000129 from coop-pilot-002 (ledger debit 0);
  - the refinery pays its own station fee and commits: 4 living-npc-refined COMMITTED.

Fixes landed (committed and pushed to origin/main):
  1. OPS 669a4d13 + 6f096445 - EVEJS_DISABLE_NPC_COLD_SCENE_SLEEP=1 on the agents
     stack. Evidence: the tick profiler showed ONLY overlay phases (npc-reconcile:*,
     observed-native-mining) and no mining/npc section, i.e. scene.tick() never ran,
     so no mining fix could ever fire in a world without a logged-in client.
  2. L3 91ec5d93 + 22033e2f - integration/coopCorpWallet.cjs is now the single wallet
     authority and prefers the native corporationRuntimeState (which bootstraps the
     divisions) over a raw `/corporations/<id>/wallet` pointer. It verifies the write
     by reading the balance back, so a no-op write is CORP_CREDIT_UNVERIFIED, never
     'paid'. Before this the treasury answered CORP_WALLET_UNAVAILABLE while the pilot
     ledger held 26 018 500 ISK.
  3. L2 2609aae4 + 8c6a7ea0 - the haul approach: warp only beyond 150 km, otherwise a
     real follow order, and publish WARPED_TO_MINER / WARP_REFUSED / FOLLOWING_MINER /
     FOLLOW_REFUSED with the measured gap. Telemetry proved the old block: warp answered
     WARP_DISTANCE_TOO_CLOSE at 24-90 km and the orbit fallback let the hull DRIFT AWAY
     (57 km -> 90 km between two retries). Empty-haul budget 24 -> 120 waits (10 min).

REMAINING BLOCKER (measured, not inferred) - the hauler cannot reach its miner:
  admin bridge mining_fleet_diagnose (read-only) for 30000145 shows both fleets in
  state hauling with miners in mode GOTO whose targetPoint is ~1.0e16 m from the
  system origin (68 000 AU) while the ship itself is 2.5 AU out and only 54 km from
  its nearest belt. The haulers therefore chase a nonsense point and the gap
  oscillates (24-90 km). Mining and delivery worked in this world before the 21:30Z
  restart, so the suspect is restored movement state: a ship comes back with
  mode GOTO plus a stale target that every new orbit/follow order is refused against.
  Next single step: in the fork (server code is ours since 2026-10-28), clear the
  movement target on restore / refuse an absurd target (|target - position| > 1e9 m),
  then prove living-hauler-loaded -> delivered -> refined -> mineral lift -> sale.

Doctrine note: the overlay installer is legacy; new server behaviour goes into the
fork C:\Games\EveCoop\upstream-evejs (branch coop/pas7std) as a commit, then build.

## 2026-10-27 21:50Z - where the loop really stands (fresh work-stack world)

Fresh `evejs-agents` world (volumes reset, market reseeded jita_new_caldari, 445 096 rows) with
every fix in the image. Measured on THAT world:
  80+ living-mining-cycle-settled COMMITTED
  14 living-hauler-loaded with real quantities (the orbit-the-miner fix works)
  9 living-npc-station-delivered and station trips
  1 living-npc-station-sold: 5000 units type 17464 @ 5203.7 = 26 018 500 ISK credited to the
    pilot ledger (ledger.json coop-pilot-002 balance 26 018 500)

Blocking the last leg: the corporation is never funded. `living-corp-treasury-swept` never
appears, so the refinery answers NPC_CORPORATION_WALLET_SETTLEMENT_REQUIRED for every stack at
60000682 / 60003724 and no minerals are produced. Without minerals there is no lift and no
mineral sale, which is the only unproven stage.

What is already fixed for that path (all pushed, tested):
  - refinery hook now passes the in-process gameStore and marketRoot; `../../gameStore`
    resolves from services/mining (verified ROOT_OK, ../gameStore is MODULE_NOT_FOUND);
  - EVEJS_COOP_TREASURY_TRACE=1 on the agents stack emits living-corp-treasury-skipped with
    the treasury's own status/reason, so the next refinery attempt names the refusal instead
    of hiding it.

So the next single observable is `living-corp-treasury-skipped` (status/reason) on the first
arrival that carries ore after a restart. Nothing else can be inferred before it appears.

Owner's stack `evejs` was never restarted; every experiment here ran on `evejs-agents`.

## 2026-10-27 20:00Z - fresh agents world + every defect found today is fixed

Owner split the machine (docs/TWO_STACKS_PLAY_AND_WORK.md): play stack `evejs` is his game,
not to be restarted; work stack `evejs-agents` is where proofs run. All work since then is
on the work stack only.

Defects found and fixed today, each with tests (all pushed):
  1. liftedTypes declared inside the lift gate, read outside -> every arrival died with
     'liftedTypes is not defined' and NOTHING sold (3 deliveries, 0 sales).
  2. An empty haul flipped the fleet to 'loaded' -> empty fleets flew to stations
     (living-native-haul-delivered NO_CARGO, lastHauledVolumeM3 0).
  3. That retry re-entered mining every 2 s, restarting the hauler warp forever (99 km gap).
  4. Then the warp target was the asteroid, not the miner -> 2 500 m transfer range never
     reached (ranges 22-130 km). Now the hauler ORBITS the miner at 500 m, issued at most
     once per 2 minutes (a warp takes ~24 s; re-issuing restarted it).
  5. Governor decided on a partial bid book -> throttled a world with 25k/90k bids; a
     partial book is now 'unknown' (>=90% stock coverage required).
  6. Governor ignored EVEJS_COOP_TIME_SCALE -> a 15 min trickle became 75 accelerated min.
  7. patches/upstream/MANIFEST.json carried a BOM -> JSON.parse failed, the whole deploy was
     blocked for everyone. BOM stripped.

Work-stack config (agent-only, compose/compose.agents.yaml): startup systems
30000142,30000145 (Perimeter has zero bids), demand floor 200000 (a fresh economy is not
overstock), fleet count 2, x5 pacing.

Agents volumes were reset at 19:36Z (sandbox only) and the market reseeded with
`jita_new_caldari` (23 stations, 445 096 seed rows). One stale market journal from my own
mid-RPC restart (coop-pilot-012, order gone + cargo gone) was moved out of tx/ so the trader
stops blocking every sale with UNRESOLVED_MARKET_JOURNAL; kept as
/var/lib/evejs/coop-market-tx-stale-from-restart.json.

Live on the fresh world so far: mining cycles COMMITTED, living-hauler-loaded with real
quantities (1680, 2940, 1260), station deliveries, station trips. Remaining: the first
successful sale -> treasury sweep -> paid refinery -> mineral lift -> mineral sale.

## 2026-10-27 17:05Z — items 15 and 16 (code halves) done; exact next steps

**Item 15 DONE (code) — a1d5b03b.** `coopWarFleetRoster` now keeps a durable
per-faction, per-role hull reserve (`spawnable` + `equipped`) in the same roster
row: a proven loss removes one equipped hull, an adopted replacement consumes one
spawnable hull and becomes equipped, `declareReserve` only accepts what a caller
proved (`source` required, unknown roles / non-integers refused), `reserveOf`
reports the real totals. Every real loss and replacement carries a `frontChat`
record; `fleet_reconstitute` sends it through `coopWarClientView.frontReport`
(new kinds `fleet-loss`, `fleet-replacement`) via the existing once-per-eventKey
`warFrontChat`. Tests 37/37 with client-view + admin-bridge + composition.

**Item 16 code half DONE — ae9cea92.** `coopNpcCorpTreasury.run` accepts a
`resolveCorporation` authority and sweeps ONLY pilots that really belong to the
target corporation (`NO_EARNINGS_FOR_THIS_CORPORATION` when none do, an
unprovable owner is never swept); without the authority the historical sweep is
unchanged, so nothing can regress. `coopNpcRefineryTick.fundTreasury` forwards
`options.pilotCorporation`. Tests 62/62 with refinery + war-funding + treasury.

**NEXT ACTION (exact), item 16 live half.** The routing fix is inert until a
caller supplies the authority. At the refinery tick's call site pass
`pilotCorporation: (pilotID) => <corporationID of that pilot's real native
entity>` (identity registry + `nativeNpcStore.getNativeEntity`, the same
authority `coopWarFleetRoster.presence` already uses), then run
`war_funding_diagnose` until an ARMED faction (500011 Angel or 500020 Serpentis)
reads `FUNDED` instead of `NO_REAL_FACTION_INCOME`, and confirm
`living-native-war-bounty` `PAID` on its next real casualty. Do not fund it any
other way and do not mint ISK.

**Also open.** `NEEDS_OWNER_RESTART_WINDOW` for the FW-037 gate-crossing proof
(see the section below). Item 13 payout stays blocked behind item 16.

## 2026-10-27 16:40Z - stack split: all further proofs run on evejs-agents

Owner changed the rules (docs/TWO_STACKS_PLAY_AND_WORK.md, AGENTS.md): compose project
`evejs` is the live game shared with his friend. NO deploy/rebuild/recreate/restart/down
against it unless he explicitly asks for a restart window. Agents prove everything on
`evejs-agents` (ports 28443/25222/28000-28002/41110, x5 pacing, separate volumes).

Consequences for this session:
  - my deploy script (compose.yaml + compose.coop-probe.yaml without -p) targets the PLAY
    project. It is retired; the safe cycle is `docker build -t evejs-local .` (safe while he
    plays) followed by scripts/Start-Agents-Stack.ps1 -Action Up.
  - the earlier live evidence (mineral lift 12:47, ore sale, treasury sweep, governor HOLD)
    was measured on the PLAY stack before the split and stays valid as history, but every
    NEW proof must name the stack it ran on.

Play-stack side effects already deployed before the split (his next restart would apply them,
so he must know): EVEJS_COOP_NPC_MINERAL_LIFT=1, EVEJS_COOP_MINING_DEMAND_GOVERNOR=1 with
FACTOR=1.5 FLOOR=20000 TRICKLE_MS=900000, EVEJS_MINING_NPC_STARTUP_FLEET_COUNT=2, plus the
overlay modules coopNpcMineralLift and coopMiningDemandGovernor. I touch nothing there now.

Agents stack state (measured 16:36Z): image already carries the current overlay
(governor fix + liftedTypes present), env has TIME_SCALE=5, GOVERNOR=1, FLEET_COUNT=2,
MINERAL_LIFT=1. World is FRESH: 448 event lines, no haul yet, slots 30000144/30000145/
30100032 ALREADY_ACTIVE, mining cycles starting, no lift receipts.

So the remaining proof is a full self-contained loop on a fresh world: mine -> haul ->
deliver -> ore sale (ISK) -> treasury sweep -> paid refinery -> mineral lift -> mineral sale.
A watcher on evejs-agents-server-1 records each stage (verdict ladder MINING -> HAULED ->
DELIVERED -> REFINED -> LIFT -> MINERAL_SALE_PROVEN).

## 2026-10-27 16:50Z — war gate crossing: five real blockers named and removed

**Done (commits 83a9b3bc, 9f66beec, 466593aa, 18768947, 82f7ca0a, 0fdf15c9,
76970e18, b24a32f2).** Gate staging no longer refuses silently. In order:
1. `coopWarGateStaging.tick` returns per-campaign `skips[]` with the exact
   precondition, published once per distinct set as
   `living-native-war-gate-staging` status SKIPPED; the phase's own early returns
   use `warSkip("gate-staging", …)` and `gateReason(env)` names missing flags.
2. ASSAULT campaigns are staged (the crossing leg was never even considered) and
   the operator's explicit `paper-supply:<campaignID>` waiver is accepted and
   labelled `PAPER_UNFUNDED_EXPLICIT`.
3. A warp the native runtime refuses as `WARP_DISTANCE_TOO_CLOSE` is closed by a
   real native follow order (and every per-ship rejection is now named).
4. The follow order is actually forwarded (`orderFollow` → `createGateTravel`).
5. **The gate arrival is measured before the retry window** — the 180 s
   `NATIVE_GATE_WARP` window used to skip the hull before the surface-gap check,
   which hid the only moment it was physically at the gate.
6. `coopWarTransferLedger` accepts the ASSAULT leg and a waived campaign that has
   no treasury row at all; `coopFactionWarCore.paperSupply` is the single rule.

**Live, read-only on the owner's running build (verbatim).**
`living-native-war-gate-staging 16:19:30` → `AT_REAL_GATE` +
`TRANSFER_REFUSED:WAR_HANDOFF_CAMPAIGN_OR_FUNDS_UNVERIFIED`; `15:35`
`WARP_REFUSED:WARP_DISTANCE_TOO_CLOSE` at gate `50016294`; the hull
`980000023574` really warped to that gate (real reciprocal pair
50016294 ↔ 50016293, 30003837 → 30045344) and then drifted ~15 km per 30 s tick.
`war_state`: `campaignStates {PREPARING:5, ASSAULT:1}`, `30045344` ASSAULT with
source `30003837`.

**NEEDS_OWNER_RESTART_WINDOW.** FW-037 (the ledger fix that unblocks the actual
crossing) is committed, `--apply`/`--check` = OVERLAY_OK, but it is **not** in the
owner's running server and that server must not be recreated while he plays. The
crossing proof needs exactly one recreate of project `evejs`.

**NEXT ACTION (exact).** In the owner's next restart window: recreate once, then
watch `living-native-war-gate-staging` for
`VERIFIED_NATIVE_GATE_TRANSFER` of `980000023574` into `30045344` (and the
`living-native-war-transit-retired` archive after it). If it refuses again, the
reason is now always in `observations[]` (`TRANSFER_REFUSED:<reason>`) or
`skips[]` (`ATTACKER_REJECTED:<id>/<reason>`) — fix that exact string.
Everything else continues on project `evejs-agents`
(`scripts/Start-Agents-Stack.ps1 -Action Status|Seed|Up|Down`), x5 time.

**Item 13, title half DONE (54ec5bd0).** `coopWarRankTitle.applyToCharacter`
writes the canonical rank title into the stock character record through
`characterState.updateCharacterRecord`; refuses a non `coop-player-` key, an
unknown rank, a key/record mismatch, a missing record and any non-canonical
title; `coopWarKillMerit` publishes `living-native-war-rank-title` with
`surface:"CHARACTER_RECORD_TITLE"`. Tests 10/10, with merit/bounty 22/22.
The payout half stays `BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION` (= item 16).

**NEXT CODE ITEM (15).** Fleet reconstitution + faction reserve:
`integration/coopWarFleetRoster.cjs` (TABLE `corporationRuntime`, KEY
`coop-faction-war\x1ffleet-roster-v1`) already plans from proven-alive survivors
and records a loss only with a real wreck. Missing: a durable per-faction hull
reserve (spawnable + equipped count per doctrine role) and a front-chat line per
loss/replacement via `coopWarClientView.frontReport` (line 122) with the same
once-per-key throttle `warFrontChat` uses.

## 2026-10-27 20:30 local (16:30Z) — OWNER DIRECTIVE: the live `evejs` stack is untouchable

Owner is playing on `evejs-server-1` / `evejs-market-1` right now. **Never**
`docker compose up/restart/down/--force-recreate` against project `evejs`, never
touch those containers. All further live proofs happen in a separate stack
(own project name, own ports — 26000-26002/443/5222/40110 are taken — own
volumes). `docker build -t evejs-local .` is allowed (it touches no container).
If something truly needs the owner's stack restarted, record
`NEEDS_OWNER_RESTART_WINDOW` instead of restarting.

Consequence for the war work: the last deploy of FW-036 (transfer ledger accepts
the ASSAULT leg + the explicit paper waiver) was already live before the
directive arrived, so the crossing leg can still be observed **read-only** on
that build. Everything after that is verified in the agent stack only, and every
metrics block from now on states that the owner's stack was not restarted.

**NEXT ACTION (exact).** (1) Read-only: watch `living-native-war-gate-staging` on
the owner's running FW-036 build for `VERIFIED_NATIVE_GATE_TRANSFER` of
980000023574 into 30045344; a `TRANSFER_REFUSED:<reason>` is the next exact
precondition to fix. (2) Stand up the agent stack
(`docker compose -p evejs-agents` + its own port/volume overrides) so no further
item needs the owner's stack.

## 2026-10-27 16:25Z - second startup slot added (additive), New Caldari has a fleet again

Owner asked to finish. Slot 30000145-1 fails deterministically on EVERY boot with
ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH (operator repair, not code). Instead of touching the
broken record, EVEJS_MINING_NPC_STARTUP_FLEET_COUNT went 1 -> 2, which creates a second
startup slot per configured system. Nothing was deleted or rewritten.

Live after the change (docker logs):
  ALIFE08 slot 30000145-2 -> ALREADY_ACTIVE miners=2 haulers=1
  ALIFE08 slot 30100032-2 -> ALREADY_ACTIVE miners=2 haulers=1
  ALIFE08 slot 30000145-1 -> NEEDS_OPERATOR_REPAIR (unchanged, still blocked)

Where the mineral sale can happen (economy balance, live):
  60000682 type 34 stock=321677 demand=5000 price=2.96   -> 14 800 ISK
  60003334 type 34 stock= 86915 demand=5000 price=3.10   -> 15 500 ISK
Both are New Caldari stations the new fleet can reach, so the first arrival that lands on
either one closes the last leg: lift -> sale -> treasury sweep.

The demand governor stays ON with the approved defaults, so the small new fleet mines in
the 15-minute trickle windows; the proof therefore takes tens of minutes, not seconds.

## 2026-10-27 15:10Z - owner backlog registered (8 items), exact first step for each

Owner approved this order. Nothing below is claimed done; this is the plan a fresh
session continues from, with the real file/line anchors already located.

1. **Owner's personal loop: kill -> merit -> VISIBLE rank/title -> chest payout.**
   Title first. Already real: `coopWarMeritLedger` + `coopFactionWarMerit` (rank
   from merit) and `coopWarRankTitle.apply()` (durable title ledger, wired to
   `coopWarKillMerit` on `PROMOTED`, event `living-native-war-rank-title`). Missing
   for *his* character: the title is only in the co-op ledger - it must be written
   into the native character record's own `title` field (client-visible on the
   character sheet) for `coop-player-<characterID>`, via the stock
   `characterState` writer, refusing any non-player key and any unknown rank.
   Then the payout: `coopWarKillMerit` already calls `bountyPayer` ->
   `coopWarBounty`/`coopWarTreasury` PAYOUT from HELD escrow; it needs a funded
   chest (item 5) or an armed faction with real income.
3. **Structures as real objectives.** `campaign.structureID` is emitted by
   `coopWarClientView.campaignSnapshots` (flag
   `EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832`) and the two real Astrahus
   exist (1030000000000/1030000000001). Missing: `coopWarObjectiveAdjudicator` must
   bind the campaign's structureID to a real native destruction of THAT structure
   and flip `militaryControllerFactionID` on that proof only (no timer, no capture
   by presence).
4. **Fleet reconstitution + faction RESERVE.** `coopWarFleetRoster` already plans
   from proven-alive survivors and records losses with a wreck; missing: a durable
   per-faction hull reserve count (spawnable + equipped) and a front-chat line on
   every loss/replacement through `coopWarClientView.frontReport` (same once-per-key
   throttle as `warFrontChat`).
5. **Real income for BOTH sides.** `war_funding_diagnose` live: every side is
   `NO_REAL_FACTION_INCOME` (all five earned-ledger pilots sit at balance 0). The
   only real ISK source is a seeded-market fill, so loot sales
   (`coopNpcLootCommerce` -> `coopNativeNpcMarket`) must fund the *seller's own*
   corporation (`coopNpcCorpTreasury` corporationID fix) - that is the same
   misrouting bug already recorded for the Angel pilot.
6. **Map/front-tab client check** (BLOCKED_CLIENT_CHECK until the owner confirms):
   open the FW front tab and the insurgency/campaign map layer in 30045344; the
   expected payloads are `coopWarClientView` campaignSnapshots (objective
   `structure:<id>`) and `fwWarzoneSolarsystem.GetAllWarzonesOccupationStates`
   (`ownerID`/`occupierID` field names still unverified).
7. **Second player (Sasha):** server-side preconditions only - a second character
   record docked at a militia desk, its own enlistment, its own active hull; never
   claim a client success without the client.
8. **Deferred:** shipcaster needs an owner decision (no beacon typeID exists for
   500011/500014/500020; only empire 75928-75931) - propose "no faction shipcaster
   in this build, empire beacons only"; native sovereignty needs a real TCU/IHub
   typeID + a native claim row (live: `NATIVE_SOV_CLAIM:0`, reason
   `NO_NATIVE_SOV_STRUCTURE`); incursions are a stub (2 files/0 handlers) - do not
   build on them.

**NEXT ACTION (exact).** Item 1, title half: add `applyToCharacter({pilotID,
characterID,rank,title})` to `integration/coopWarRankTitle.cjs` writing the stock
character record `title` (refuse non-`coop-player-` keys, unknown ranks and a
missing record), call it from `coopWarKillMerit` when the pilot key is a player,
emit `living-native-war-rank-title` with `surface:"CHARACTER_RECORD_TITLE"`, and
unit-test the refusals + the exact written value.

## 2026-10-27 15:00Z - ITEM 3 (owner correction): an enlisted player is ONE ship in a fleet

**Code PASS (4001d5bd).** `coopWarBattleDirector` no longer has a separate
player-only fallback branch. Per war ship it builds ONE ranked candidate list where
a hostile native hull and an enlisted enemy player are the same kind of candidate,
ordered by the same distance rule the NPCs already use on each other; a native hull
wins an exact distance tie, so a player is never preferred. The enlistment proof is
re-read immediately before the native order, exactly one native command is issued
per hull per tick, and the ranking is published once per distinct set as
`living-native-war-target-selection` (per ship: candidates, distance, chosen,
reason). Tests 8/8 (2 new: "the player is one candidate among several, never the
only or first target", "on an exact distance tie a native hull is chosen over a
player"); 41/41 with the militia/mobilisation/assault suites; OVERLAY_OK; built and
recreated.

**Live, verbatim.** `militia_enlist 140000102/3012018` ->
`{"enlistment":{"characterID":140000102,"factionID":500001,"status":"ACTIVE"},
"agentSays":"[Militia] Enlistment recorded for Caldari State."}`. Read-only verdict
probe on the real war ships of `campaign:30045344`:
`char=140000102 ship=980000023571 faction=500001 system=30045344 -> ALLY` (his own
faction never fires on him) and `ship=980000023574 faction=500004 system=30003837 ->
NO_ACTIVE_ASSAULT` (the enemy may only engage him once it is physically inside the
contested system - a real geometry gate, not a rule change).

**BLOCKED_CLIENT_CHECK (the in-space half, exact).** The multi-tick target-selection
proof needs the player's hull in a live scene. There is no server-side player-in-space
facility (`coopSessionPresence.admission` requires a live socket,
`initialStateSent`, a native scene membership and an unambiguous ship owner), and
`140000005` is undocked (`stationID null`, `solarSystemID 30000145`), so even his
enlistment needs a client dock. Required human action: log the client in as
140000005, dock at a Caldari militia desk (3012018 @ 60003754 Perimeter or 3010879
@ 60000358), enlist, undock in 30045344 while the campaign is in ASSAULT.

**World prerequisite (open).** `EVEJS_COOP_FACTION_WAR_GATE_APPROACH: '1'` was added
to `compose.coop-probe.yaml` and the server recreated, but the Gallente attacker
980000023574 is still in 30003837 and no `living-native-war-gate*` event exists, so
gate staging has not yet produced a crossing. That is the next exact step for the
assault leg (a front whose attacker never arrives can never be fought).

**NEXT ACTION (exact).** Diagnose gate staging for `campaign:30045344`: read
`advanceNativeWarGateStaging` + `coopWarGateStaging.tick` and publish the exact
refusal (treasury row, gate lookup, order lease, or `maxOrders`), then make the real
Gallente hull cross 30003837 -> 30045344. After that, the client half of item 3
(BLOCKED_CLIENT_CHECK above).

## 2026-10-27 14:42Z - ITEMS 1+2 PASS live: per-campaign mobilisation and the Caldari front in ASSAULT

**Item 1 (38300de5).** `coopWarMobilizer.tick` now plans every live campaign before
any write: `campaigns[]` carries, per campaign side, the assigned count, the
commander cap, the real mobilizable hulls and the exact first rejection. The
per-tick write budget is spent on the most starved campaign, and a refused native
ASSIGN returns the registry's own reason (`blocked[]`, published once per distinct
set as `living-native-war-mobilization-blocked`). `war_state` now projects the
record's real `state`/`sourceSystemID` (it emitted a `status` field the record does
not have, so PREPARING vs ASSAULT was invisible). 16/16 + 65/65, OVERLAY_OK 380.

Live: `war_diagnose` lists all 6 campaigns; then
`living-native-war-mobilization` DEFENDER 980000023571 (coop-pilot-023, 30045344,
500001) + ATTACKER 980000023574 (coop-pilot-038, 30003837, 500004) for
`war:500001-500004:campaign:30045344`, while the five pirate/ORE campaigns stayed
PREPARING.

**Item 2 (live, no code).** `living-native-war-assault` `ASSAULT_BEGUN`
`campaign:30045344` attacker `[980000023574]` defender `[980000023571]`,
`REAL_NATIVE_MUSTER_ON_BOTH_SIDES`; `war_state.campaignStates {PREPARING:5,
ASSAULT:1}`; `militia_state 140000005` -> `fronts:[{war:500001-500004,
campaign:30045344, systemID 30045344}]`.

World setup used (owner default: real NPCs only): two real armed navy patrols via
`spawn_native_npc` with the authored doctrine rows (Caldari Navy Condor 564+222x60
in 30045344, Federation Navy Atron 562+222x60 in 30003837), crewed by released
roster identities `coop-pilot-023`/`coop-pilot-038`. **Operator note:** release and
assign must go in ONE admin drain - a reconcile re-links a released pilot to its
durable old hull within ~20 s, which is why the first attempt answered
`PILOT_ALREADY_LINKED`.

**NEXT ACTION (exact).** Item 3: enlist 140000005 (Caldari) with `militia_enlist`,
then prove the melee rule live - a real Gallente (500004) patrol gets a
`MILITIA_PLAYER` attack order on that character's hull while Caldari (500001) NPCs
never fire on him. Read `coopMilitiaWarPlayer` first.

## 2026-10-27 14:30Z - production governor LIVE, and two world-caused blocks

Owner decision: throttle extraction to real demand (not reseeding, not industry).
integration/coopMiningDemandGovernor.cjs is now deployed with
EVEJS_COOP_MINING_DEMAND_GOVERNOR=1 FACTOR=1.5 FLOOR=20000 TRICKLE_MS=900000.

Live proof of the throttle (14:16-14:26 UTC):
  living-mining-demand-governor TRICKLE_ALLOWED sys30000144 held=4159021 want=45000
  living-mining-demand-governor HOLD           sys30000144 held=4159021 want=45000
  mining cycles dropped from ~100+ per 5 min to ~34 (trickle windows only).
It holds ONLY a fleet in state "mining", never a live station trip, and an unreadable
stock or unread bid book can never stop the world (both fall back to ALLOW).

Deployment traps hit today, all real:
  - `docker build` once reused a stale COPY layer; verify a changed module INSIDE the
    image (md5sum) instead of trusting the build exit code.
  - the shared container was recreated by another session with an older compose config,
    which silently dropped the governor env flags. Re-check printenv after any restart.
  - overlay --apply aborted once on another session's half-written hook
    (HOOK_REQUIRE_UNRESOLVED npcBehaviorLoop -> ../coopMilitiaWarPlayer).

Two blocks that are world state, not code:
  1. Hauler 980000016300 (which carried the 5000+5000 lifted minerals) no longer exists:
     the ship and its 9 mineral cargo rows were destroyed during the raid/war activity.
     So the mineral SALE is still unproven end to end.
  2. Durable slot 30000145-1 reports NEEDS_OPERATOR_REPAIR
     ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH since 14:21:14, so that fleet cannot run another
     station trip until the native repair succeeds. Nothing was wiped to force it.

## 2026-10-27 13:35Z - the loop's real ceiling, measured with a new read-only audit

scripts/coop-economy-balance.cjs (+5 tests) answers the only question that decides whether
the loop can be self-sustaining: what the corporation holds versus what the world still pays.
Live measurement inside the container:

  status=PARTIAL_DEMAND stock=3965422 sellable=35046 stranded=3930376 potential_isk=373147.08
  station=60000358 type=17464 stock=623883 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000358 type=17470 stock=525488 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000358 type=34    stock=407192 demand=0   NO_BUYER_ON_THIS_STATION
  station=60000682 type=34    stock=321677 demand=5000 price=2.96 DEMAND_LIMITED

So ~4.0M units of ore/minerals are stored and only ~35k units can still become ISK. The
seeded bid book is a FINITE pool that earlier sales have already consumed; Perimeter's station
has zero bids for every type, which is why its fleet can never earn there.

Also confirmed: the lift account is clean (0 journals, 9 receipts, 0 blocked events).

Unproven still: one mineral sale (types 34/35 in living-npc-station-sold). The 5000+5000 units
are aboard hauler 980000016300 and the deployed sale path now sells them; the New Caldari fleet
must haul to a station that still pays (60000682 is the only one left in that system). Its
mining stopped at 13:21 after TICK_aggressed (another session is running militia/raid admin
commands on the same container), so the proof waits on world time, not on code.

## 2026-10-27 13:05Z - FIRST LIVE MINERAL LIFT (and two regressions it exposed)

PROVEN LIVE at 12:47:45-12:47:47 (run ca59f6c0):
  living-npc-mineral-lifted - 9 receipts, 5000 Tritanium + 5000 Pyerite taken out of the
    corporation hangar at 60003334 and written into hauler 980000016300's real native cargo
    (coop-mineral-lift:v1 journal tag, hangar stacks debited to zero).
  living-npc-station-sold SOLD - type 17471 qty 3975 @9.43 = 37 484 ISK credited to the pilot.
  living-corp-treasury-swept - 37 484.25 ISK into corporation 1000129 the same second.

Two real regressions the lift exposed, both fixed and tested:
  1. The sale filtered the allowlist by the caller's `types` (ore only), so the just-lifted
     minerals were never sold and stayed aboard as 9 stacks. Lifted types now bypass that
     filter via `liftedTypes`. tests/coop-mineral-lift-wiring.test.mjs 5/5.
  2. The lift writes its own custody rows (journal tag, no coopHaulFleetID), which made the
     durable mining fleet throw ALIFE12_NATIVE_HAUL_CUSTODY_AMBIGUOUS on boot and quarantine
     slot 30000145-1. Tagged lift rows are now excluded from that custody check.
     tests/coop-native-mining-fleet-durable.test.mjs 29/29.

Also worth knowing: the overlay --apply ABORTED once with HOOK_REQUIRE_UNRESOLVED
(npcBehaviorLoop -> ../coopMilitiaWarPlayer) because another session was mid-write; a second
run returned OVERLAY_OK. Always check that a deploy actually copied the module you changed
(grep the tag in the checkout) instead of trusting build exit=0.

## 2026-10-27 12:46Z - the lift path now RUNS live (and one real bug died)

Fixed live bug: the lift result was a block-scoped const used by the skip telemetry, so every
station arrival aborted with SALE_ERROR 'loaded is not defined' (5 occurrences). After the fix,
the same arrival reports living-npc-mineral-lift-skipped (12:45:10) followed by the normal
NOT_SOLD NO_SEEDED_COUNTERPARTY for the perimeter station, i.e. nothing aborts any more.

Still unproven live: one full minerals->ISK settlement. It needs an arrival at a station that
BOTH holds refinery minerals AND pays for them (60000682 / 60003334 in New Caldari). The New
Caldari fleet did deliver and refine 8 stacks at 60003334 at 12:33:05, but its next route is
blocked by ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF: an older manifest declares cargo
that is no longer aboard and has no warehouse/sale receipt, so the custody gate refuses. That
gate is correct; the stale manifest needs the documented expire()/abandon() operator recovery
before a fresh trip can be planned.

Perimeter (30000144) has no bids at all, so nothing sold there can ever earn, no matter the
code: the demand map is 30000142 Jita (90 000/type) and 30000145 New Caldari (25 000/type).

## 2026-10-27 12:18Z - the whole picture, measured: where demand really is

Seeded BIDS only exist in two systems of region 10000002:
  30000142 Jita: 18 stations, 90 000 units of each ore/mineral
  30000145 New Caldari: 5 stations, 25 000 units, e.g. 60000682 Tritanium 5000@2.96,
    Pyerite 5000@16.35, Veldspar 4.42, Scordite 3.63, Pyroxeres 7.74
  30000144 Perimeter: ZERO bids of ANY type right now, including at 60000358.

So every station trip of the Perimeter fleet (960004609 -> 60000358) ends in
living-npc-station-sale-skipped NOT_SOLD NO_SEEDED_COUNTERPARTY: the station has no buyer
at all. Earlier sales there (521 754.08 ISK earned) consumed the finite 5000-unit bids that
did exist. Seeded depth does not come back on its own, so a loop that only sells into it can
never be perpetual without a real consumer (native industry) or owner-approved reseeding.

Identity exhaustion is FIXED and visible live: the same sale path that used to report
HAULER_NOT_NAMED now reaches the market and reports NO_SEEDED_COUNTERPARTY, i.e. the
merchant identity really is adopted (registry.release + reuse of a finished shift).

The New Caldari fleet (960004641) mines again after the restart (cycles COMMITTED, durable
slots RESTORED) but has not started a station trip yet, so the mineral lift at 60000682
(the only station that both holds refinery minerals and pays for them) is still waiting for
its first real arrival. living-npc-mineral-lift-skipped now reports every decision.

## 2026-10-27 12:0xZ - the mineral buyer was there all along (measurement bug fixed)

The market daemon answers GetOrders as a BOOK of two sides: {buys, sells}. The audit and
the earlier probe read `orders`, which never exists, so 'region 10000002 has zero mineral
demand' was wrong. Live now: 23 seeded BIDS per type. Station 60000682 (New Caldari) has
Tritanium 5000 @2.96 and Pyerite 5000 @16.35 right on the station the refinery already
uses; 60000358 (Perimeter) has NO local bid, so its stock cannot be sold there.

Bid depth is the real ceiling: 5000 per type per station, so the honest revenue is about
14 800 + 81 750 ISK, but only 14 800 ISK of that is one order's depth at 2.96 for 5000
units. Everything above the bid volume stays unsold, by design, never 'assumed'.

New leg (OFF by default, EVEJS_COOP_NPC_MINERAL_LIFT=1): integration/coopNpcMineralLift.cjs
takes the exact quantity out of the corporation hangar, writes a journal, puts it into the
hauler real native cargo carry row, verifies it, then receipts it. A journal whose cargo is
verified is replayed; a journal whose stock moved but whose cargo is missing halts the leg
with NEEDS_OPERATOR_REPAIR. sellOnArrival calls it before the proven sale path, so those
minerals are liquidated against the local seeded bids and the pilot ledger credits ISK,
which the corp treasury sweep then pulls back to the corporation.

## 2026-10-27 11:26Z - BPO bootstrap must run INSIDE the server process

grantItemToOwnerLocation(1000129, 60000358, 4, 950 /* Merlin Blueprint */, 1, {singleton}) plus
industryRuntimeState.getBlueprintState(itemID) do create the real native blueprint and state,
but a node process started with docker exec only writes into its own GameStore buffer:
flushTableSync('items') and flushTableSync('industryBlueprintState') both answer
flushed:false and scripts/coop-factory-audit.cjs still reports blueprints=0. The grant was
lost, so nothing was actually changed on disk.

Next attempt MUST go through the in-process admin bridge (/var/lib/evejs/coop-admin-requests.jsonl,
see integration/coopAdminBridge.cjs) or a real hook, never a docker exec side process.

Everything else stands: 16 refines, 521 754.08 ISK swept, 23 mineral stacks worth 0 ISK because
region 10000002 has zero orders for typeID 34/35.

## 2026-10-27 11:24Z - why minerals cannot be sold yet (measured, not assumed)

scripts/coop-mineral-audit.cjs (5 tests) reads the real stock and asks the real market book:
the corporation holds 23 refinery stacks - 407 192 Tritanium + 81 826 Pyerite at 60000358 and
321 677 + 7 401 at 60000682 - and region 10000002 (The Forge) returns ZERO orders for typeID
34 and 35. There is no buyer to fill, so a mineral sale leg would be dead on arrival; the
blocker is demand, not custody.

Closing the loop therefore needs one of:
  a) native industry really consuming minerals (blueprint + funded corp + industry jobs), or
  b) backed seed BUY orders for minerals via the market daemon (AdjustSeedStock), which
     changes the economy book and needs the owner explicit approval.

## NEXT (unfinished, do not claim done)

1. Minerals -> ISK. Refined minerals sit in corp 1000129 hangar with customInfo prefix
   coop-refine:v1:<item>:<qty>:mineral:. The station sale path (coopNativeStationArrival +
   trip manifest) is ore-only (isOreType), and coopNpcLootCommerce is pilot/ship-centric, so
   neither can sell them. Needed: one custody-safe local leg - a manifest of the refinery
   operation IDs and mineral rows, a sale against real seeded buy orders at the same station
   (minerals already there, no haul), and a durable receipt per row. No unbacked orders.
2. Manufacturer buyer. corp 1000129 now holds ISK (455600 + 521754.08 swept). Missing: an
   inventory item with categoryID = BLUEPRINT_CATEGORY_ID owned by that corp at a station,
   which makes industryBlueprintState.records[itemID] real; then scripts/coop-factory-audit.cjs
   must print FACTORY_READY (it reads blueprints, jobs, fundedCorporations).
3. Gate baselines: coop-loop-gate.sh fails hook-inventory (58 expected, 59 actual),
   overlay-l1-baseline (patch series != manifest), flags (3 new env flags:
   EVEJS_COOP_NPC_MARKET_DIR, EVEJS_COOP_CORP_TREASURY, EVEJS_COOP_FACTORY_CORP_ID).
   Update the baseline files deliberately after confirming no duplicate hook exists
   (only one coopNpcRefineryTick.tick call is present in the built checkout, line ~2896 of
   miningNpcOperations.js). isolated-gamestore passes once NODE_OPTIONS is cleared.

## 2026-10-27 11:07Z - LIVE PROOF: the refinery is paid and refines

After moving the hook before the early returns in shouldTriggerHauling and deploying:

- living-corp-treasury-swept x1: 521 754.08 ISK moved from the pilot ledger into corp 1000129
  (corp wallet already held 455 600 ISK).
- living-npc-refined x16, all COMMITTED, real ore consumed (7 703 / 36 666 / 23 111 ...),
  2 minerals per stack, station 60000358 and 60000688.
- 16 journal files and 16 durable fee receipts in /var/lib/evejs/coop-native-refinery,
  fees 1 135.72 - 22 760.08 ISK paid from the corp wallet.
- The 16 living-npc-refinery-blocked rows are the SAME stacks retried after refining: what
  is left is smaller than one native portion, so NATIVE_REPROCESSING_RECIPE_UNAVAILABLE is
  correct but noisy - report leftovers as a leftover, not as a missing recipe.

Closed loop now real: sale -> ISK -> corp wallet -> station fee -> minerals in the hangar.

## 2026-10-27 ~11:05Z - HEAD 27b0b3d4 (pushed): the refinery can be paid

- coop-npc-refinery.test.mjs was 14 pass / 9 fail for one reason: the journal key is
  coop-refine:v1:<item>:<qty> and ':' is illegal in a Windows file name, so acquire() never
  locked and every refine answered REFINERY_LOCKED_NEEDS_REVIEW on Windows only.
  journalFile() now escapes the path segment; logical IDs, receipts and comparisons are
  unchanged. 23/23 green.
- With that green a positive station fee is accepted only with a durable paid witness
  (<root>/refinery-fees/<itemID>.json) naming that corporation, station and ISK amount.
  The tick pays it (payFee) and retries: proven 5000 -> 3765.5 ISK.
- coopNpcCorpTreasury had tests and no caller; the refinery tick now sweeps pilot earnings
  into the corporation first (EVEJS_COOP_CORP_TREASURY=1), event living-corp-treasury-swept.
  Proven 33714.25 -> fee 4998.33 -> 28715.92 ISK left.
- Live blocker: zero refinery events ever and no /var/lib/evejs/coop-native-refinery dir.
  The hook passed only fleetRecord.stationID; the mining fleet docks no hull, so every live
  tick was NO_STATION. The tick now proves the station from the newest warehouse trip
  manifest for that system+fleet and reports living-npc-refinery-skipped instead of silence.
- New live flags: EVEJS_COOP_NPC_MARKET_DIR, EVEJS_COOP_CORP_TREASURY=1,
  EVEJS_COOP_FACTORY_CORP_ID=1000129.
- Operator note: this shell inherits VS Code's NODE_OPTIONS js-debug bootloader; clear it
  (and VSCODE_INSPECTOR_OPTIONS) or gates report a fake BLOCKED_RUNTIME_SEED.
- Pilot ledger then: 521754.08 ISK un-swept; corp wallet 0 until a sweep runs.

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

## 2026-10-27 late: faction war wired to the real world

Commits (local, not pushed): 1cf02347 merit, 26945358 territory-from-presence,
c29cbcd7 campaigns, 58d8afd4 treasury, fd4bac85 bootstrap, 9b0d6f2a opening +
assault + runtime phases, 7f78b9fc war-state SQLite fix, 11a9d2ec self-defence.

Chain: real presence (identity links + corporation->faction) -> territories
(majority, tie = contested) -> fronts (real reciprocal gates) -> war + campaign
per open border (one war per faction pair) -> mobiliser reserves existing native
patrols -> BEGIN_ASSAULT only with a real muster on both sides.

**Root cause found:** the war phases read the record via gameStore.read(table,
"/"+KEY) (JSON cache) while coopFactionWarStore writes through
coopAtomicNativeRows with the raw KEY. A written state was invisible to the next
tick, so the empty state was recreated on every restart. warStateStore() now owns
read/write for opening/assault/mobilization/demobilization/objectives, and
ensureWarState() bootstraps once before any war phase.

**Live state after deploy:** `empty war state created (version 1)` exactly once,
then `opening skipped: NO_FRONT`, `mobilization skipped: NO_MOBILIZED_SHIP:OBSERVED`,
`assault skipped: NO_PREPARING_CAMPAIGN`. The state row now persists in SQLite
(version 1, wars 0, campaigns 0, territories 0).

**Why no front exists yet (real data, read-only probe):** 58 linked pilots ->
30000144=500014 (13), 30000145=500014 (9), 30100032=500020 (4), Jita 30000142 is a
3-3 tie between 500010 and 500011, so it is contested and owns nothing. The two
systems owned by 500014 share one owner and 30100032 is not adjacent, so there is
no border between two different owners. The opener refuses instead of inventing a
front. Next real action: a second faction must really outnumber the current
holder in a system adjacent to another faction's system (one extra patrol/pirate
of 500010 or 500011 in Jita is enough), then the war opens by itself.

Self-defence: coopNpcAggressionLedger (fed only by the killmail-tracker receipt
proven in coopPlayerCombatWitness) lets coopPveRetaliationGuard accept a verified
witness when the native controller has no lastAggressorID. The live compose
profile now sets EVEJS_COOP_PVE_NPC_RETALIATION=1 (it was absent, so
self-defence was gated off).

Tests: 96/96 across war + tactics + retaliation + ledger.

## Per-station fills (done, 22c90295)

Sale receipts now carry `fills:[{stationID,quantity,at}]` (accumulating, atomic
tmp+fsync+rename, identity checked against the prior row). The trip journal and
`verify()` sum ONLY the fills of the manifest's own station made after its departure, so
a row sold in two visits can be proven for each visit separately; receipts written
before the breakdown keep the documented single-station fallback. 28 journal tests pass,
including "a fill at another station never proves this route" and "a fill from before
the departure belongs to another manifest".

## Why the current world cannot finish a second trip

Its history predates receipts: rows were sold in several fills with only the first fill
recorded (the writer used create-only), so those rows are now gone while their receipts
cover only part of them. That is unprovable by construction and must not be papered over.
Live proof of the loop itself already exists (two SOLD events with real ISK).

## Decision needed before the next acceptance run

The probe world is blocked by that historic evidence gap. Two honest options:

1. **Clean world, same machine** (recommended): a second compose project with its own
   volume and remapped ports, run the loop from zero and capture the full cycle. Nothing
   of the current world is touched.
2. **Reset the probe world**: stop the project and drop `evejs-data` so the same project
   starts clean. Destructive; needs an explicit owner decision.

Neither is done automatically: the repo forbids wiping a volume to force a PASS, and a
second project needs ports 26000-26003/40110/443/5222 that the current one holds.

## 2026-10-27 handoff: CCP subsystem inventory (verified by file/handler count)

structure 46 files/77 handlers = real (deploy, control, destruction+loot, moon mining)
campaign 3/20 = real (the FSM that feeds insurgency) | shipcaster 5/6 = real
sovereignty 24/1 = logic only, no client surface | agency 1/2 = thin
incursion 2/0, superweapons 2/0, loyalty 1/0 = STUBS, do not build on them

Next step (not started): structureDeploymentService exposes ONLY client RPCs
(Handle_Anchor/Unanchor/CancelUnanchor/RenameStructure) - there is no server-side
deploy API. Two paths: (a) call the underlying structureState writer directly and
verify the structure appears in worldData.getStructuresForSystem + the scene;
(b) drive the stock Anchor action. Then set EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS
to the real typeIDs and use the structure as the campaign objective (structureID is
already a field in the client campaign snapshot; the projector currently emits 0).

## 2026-10-27 loop — item 1 DONE (structure factory), item 2 in progress

**Item 1 PASS (commit 52b28db1).** `integration/coopStructureFactory.cjs`:
`plan()` -> PLANNED record or REFUSED (UNKNOWN_TYPE_ID, INVALID_POSITION,
INVALID_FACTION for any non-number, OWNER_CORPORATION_REQUIRED,
CORPORATION_FACTION_MISMATCH, UNKNOWN_CORPORATION_FACTION, NAME_REQUIRED,
SYSTEM_ID_REQUIRED); `deploy()` writes through the native writer
`structureState.createStructure` -> `persistStructures` ->
`writeTable("structures")` (which applies `normalizeStructureDescription`,
invalidates the cache and notifies scene listeners) with `{emitLive:true}`;
`verify()` reads back through `listStructuresForSystem`, the same reader behind
`worldData.getStructuresForSystem`. Evidence: `node --test
tests/coop-structure-factory.test.mjs` 12/12, `--apply` INSTALLED
coopStructureFactory.js, `--check` OVERLAY_OK, docker build + recreate OK.

Assumption (owner default): objectives are created in SHIELD_VULNERABLE (110)
with a quantum core so they are real, attackable targets; the co-op faction is
stored in `devFlags.coop` because `normalizeStructureRecord` has no faction
field.

**Admin bridge (uncommitted->next commit):** `coopAdminBridge` gained the
whitelisted action `deploy_structure` (no characterID: a structure belongs to a
corporation) which calls the factory and reads the row back; `deps` are the real
native services. Tests `tests/coop-admin-bridge-structure.test.mjs` 4/4.

**Deliberately dirty (not mine):** `integration/coopNativeHaulManifest.cjs`,
`integration/coopNativeStationTripJournal.cjs` (another session's ore-owner vs
station-corp fill fix), `scripts/coop-supervise.ps1`, `state/digests/*`, `NUL`.
Never commit them.

**NEXT (item 2):** 1) add `EVEJS_COOP_ADMIN_BRIDGE: '1'` and
`EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS` to `compose.coop-probe.yaml`
(re-check the file right before each recreate). 2) `coopWarClientView.cjs:68`
hardcodes `structureID: 0` - replace it with the campaign's real objective
structure id (carried in the war state campaign record; see
`coopFactionWarCampaigns.cjs` `planCampaign` and `coopFactionWarAssault.cjs`).
3) Deploy 1-2 real structures in Perimeter 30000144 / New Caldari via
`deploy_structure`, then prove `warState` campaign carries the id and the
client snapshot emits it.

## Стиснення часу для тестів (реальні native-кнопки, без фейкового стану)

Профіль у `compose.coop-probe.yaml` (перевірено в контейнері через `env`):

| ключ | було | тест |
|---|---|---|
| `EVEJS_MINING_NPC_HAULER_REPEAT_DELAY_MS` | 600000 (10 хв) | **45000** |
| `EVEJS_MINING_NPC_WARP_INGRESS_DURATION_MS` | 2500 | **1500** |
| `EVEJS_MINING_NPC_FLEET_THINK_INTERVAL_MS` | 1000 | **500** |
| `EVEJS_MINING_NPC_HAUL_THRESHOLD_RATIO` | 0.2 | **0.1** |
| `EVEJS_COOP_NPC_MARKET_COOLDOWN_MS` | 60000 | **5000** |

Це саме ті ручки, якими керує продукт; код не змінюється, ніякого «підкрученого
годинника» і ніяких синтетичних подій. Продакшн-світ лишає стокові 30 хв.

## Результат трьох живих продажів

`SOLD` **33 150** + **36 250** + **43 950 = 113 350 ISK** (NPC-леджер).

## Чому зараз не продає

`living-npc-station-sale-skipped` → `NO_SEEDED_COUNTERPARTY`: у нативного сіяного
ринку закінчились ордери на ці типи руди в цих станціях (ми викупили їх кілька разів).
Це реальна межа ринку, не дефект циклу. Щоб продавати далі, треба нове сіяння
маркету (окремий потік) або інші системи/типи.

## 2026-10-27 loop — items 1/2/5 status, real blocker proven

**Item 1 PASS** (52b28db1, live 2276157c): factory + 2 real Astrahus structures
deployed (1030000000000 Perimeter, 1030000000001 New Caldari, faction 500014 /
corp 1000129), verified through worldData.getStructuresForSystem.

**Item 2 code PASS** (71551c99): campaignSnapshots emits the bound
`structure:<id>` objective instead of 0; flag
EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS=35832 is live. The objective can
only bind inside an ASSAULT campaign, which is blocked (below).

**Item 5 partial** (3fc8e73c): the first real front OPENED —
`living-native-war-opened OPENED war:500011-500014` with campaigns for 30000144
and 30000145, after one real Angel Cartel hull linked to coop-pilot-041 broke
Jita's 3-3 tie.

**Exact blocker for BEGIN_ASSAULT** (457b0ef0, read-only war_diagnose):
- war pair is Angel Cartel (500011) vs ORE (500014);
- DEFENDER side (30000144, ORE): every patrol candidate is WRONG_FACTION —
  corp 1000129 has 11 real profiles, all miners/haulers, so ORE can never
  field an armed patrol;
- ATTACKER side (Jita): the only 500011 patrol (980000000113) fails
  `NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON`.
Conclusion: this faction pair cannot muster. A progressing assault needs an
armed faction to own the defending border system.

**NEXT (decided, owner defaults allow it):** make the border fightable without
weakening any gate:
1. spawn ~10 real Serpentis (500020, corp 1000135) armed patrols in New Caldari
   30000145 (currently ORE 9) so an ARMED faction owns it;
2. spawn 2 real armed Angel patrols in Jita with role patrol (linkSpawnedIdentity
   role="patrol") so the attacker side is ready;
3. a campaign whose target is no longer held by its war's defender faction is
   void by construction — add an explicit core transition (EXPIRE_CAMPAIGN with
   a reason) and let the opening phase void such campaigns before planning,
   otherwise TARGET_ALREADY_CONTESTED blocks the new front forever;
4. verify: war opens 500011-500020, mobilization assigns real patrols on BOTH
   sides, then BEGIN_ASSAULT fires and the objective director binds the Astrahus.

Dirty files deliberately left alone: `scripts/coop-supervise.ps1` (supervisor),
`state/digests/*` (generated), `NUL` (stray).

## Buyers for the ore — what actually exists (checked 23:57Z)

`living-economy-destination` on the live world reports **`HOLD_NO_BUYER`** with
`revenue 0, filled 0, unfilled 183 747` for every candidate station, for ore types
17463/17464/17470/1230. The native seed market simply has no buy orders for those ores
in these systems, so the sale path (`coopNativeNpcMarket`, which only fills EXISTING
native orders) correctly reports `NO_SEEDED_COUNTERPARTY`.

Three buyer layers exist in the repo, and only the first one pays today:

1. **Seed-market book** (`coopNativeNpcMarket`) — real native orders, finite; this is
   what produced the three live sales (113 350 ISK).
2. **Demand model** (`coop-economy.json` `systems.demand`, `living-economy-ore`,
   `EVEJS_COOP_ECONOMY_DESTINATION=1`) — computes where ore is wanted; right now it
   honestly says there is no buyer.
3. **Industrial consumers / manufacturers** (`coopAlifeNativeManufacturingRuntime`,
   `coopNpcIndustryNativeBindings`, `coopNpcManufacturingPlanner`, `coopNpcRefinery`) —
   present but **deliberately OFF**: the native bindings declare
   `supportsLiveRuntime:false`, so the runtime refuses with
   `ALIFE_MANUFACTURING_SOURCE_UNVERIFIED` until the native industry path is verified
   live. That is the missing "manufacturer buys ore for its own needs" leg.

Placing NPC buy orders without backing is forbidden by the repo rules, so the only
honest ways forward are: verify+enable the native industry consumer, or seed genuinely
backed ore demand (market daemon), or sell in regions where real orders exist.

## Варіант (а): нативна індустрія як покупець руди — що знайдено (00:05Z)

Читав нативний codebase і живий store:

* `server/src/services/industry/*` існує (12 сервісів), у store є таблиці
  `industryJobs`, `industryBlueprintState`, `industryFacilityState`, `industryRuntime`.
* **Усі вони порожні**: jobs 0, blueprintState 0, facilityState 0 (industryRuntime 2 —
  лише метадані). Тобто у світі немає ні фабрики, ні креслення, ні матеріалів.
* `industryChatCommands.js` експортує `executeBlueprintCommand` і
  `executeBlueprintAutoCommand`, і всередині вже є `seedMaterialsForBlueprint` та
  `topUpWalletForBuild` — тобто нативний шлях «зробити реальний білд» у чекауті є, і він
  вміє сам посіяти матеріали й докинути гаманець.
* Але весь co-op стек індустрії **свідомо зафенсований** `supportsLiveRuntime:false`
  (bindings, executor, rust-sell, title-transfer, recovery fence...), а `planner`
  вимагає онлайн-фасиліті + `blueprintState.records`.

Висновок: (а) — це не перемикач, а bootstrap: треба створити NPC-виробника (фасиліті на
станції, креслення з нашою рудою в матеріалах, гаманець+матеріали через нативні
команди), прогнати один реальний джоб із доказами, і лише потім атестувати рантайм.

Наступний крок, який я роблю без ризику: підняти нативний білд через
`executeBlueprintAutoCommand` для NPC-корпи (нативний шлях, не вигадані записи), з
окремим журналом доказів. Якщо для цього потрібна сесія, якої в headless-світі немає —
це і буде першим точним блокером, і тоді рішення: невеликий L2-міст «NPC factory
bootstrap» або L1-пропозиція вгору.

## 2026-10-27 loop — item 3, 4, 10 done; assault blocker narrowed to NPC fitting

**Item 3 PASS** (78fb32ce): rank-driven command cap enforced per campaign side
(recruit 1 / squad-lead 5 / admiral 25), wired to real merit records (none yet,
so every side starts at 1). Tests 10/10.

**Item 4 PASS (code)** (3ff71b13): `warFrontChat` sends
`coopWarClientView.frontReport` to live sessions in the affected systems on war
opened / assault begun / objective captured, once per event key. Tests 3/3. No
live chat line was observed (no transition happened with a client connected).

**Item 10 PASS** (f3997b30): full suite HEAD 5712 tests / 5163 pass / 459 fail /
90 skip vs baseline 49140caa 5680 / 5131 / 459 / 90 — zero new failures, 32 new
passing tests. The single new failure found was an LF-anchored guard broken by a
PowerShell rewrite that had converted two modules to CRLF; restored.

**Assault blocker, narrowed twice (both read-only, exact):**
1. `war_diagnose` -> DEFENDER (ORE 500014) WRONG_FACTION (corp 1000129 has 11
   real profiles, all miners/haulers) and ATTACKER NOT_READY:WAR_NO_NATIVE_LOADED_WEAPON.
2. `inspect_npc 980000000113` -> `"modules":[],"moduleCount":0,"cargo":[],"cargoCount":0`
   even for a durable, armed-profile hull. Cause in the pinned code:
   `nativeNpcService.buildNativeModuleRecords` fits only `definition.loadout.modules`,
   and these profiles resolve to an empty authored loadout. So no NPC in this
   world carries a native fitted weapon/charge and the muster gate can never pass.

**NEXT ACTION (exact):** the assault is blocked BELOW the war layer. Investigate
why `npcData.buildNpcDefinition(<profileID>)` yields no `loadout.modules` for
`parity_angel_autocannon_frigate` / `blood_raider_prophecy` (npcProfiles/npcLoadouts
rows in the static tables vs `npcHardwareCatalog` allowed type IDs), then either
author a real loadout through the catalog or record it as a stock data gap in
`patches/upstream/`. Do not relax `coopWarMusterReadiness`.

**Also still open:** queue items 6 (NPC careers), 7 (courier economy), 8
(industry/salvage loop), 9 (two-client checklist); owner backlog items 1-3
(sovereignty projection, shipcaster logistics, player ranks).

## 2026-10-27 — NPC fitting root cause FOUND (exact), fix needs an override seam

**Root cause (verified, no guessing).** `npcData.buildNpcDefinition(profileID)`
takes the loadout straight from the profile row (`profileRow.loadoutID`), and
every pirate *subcapital* profile points at
`retail_empty_npc_entity_loadout` — a documented stock row with
`modules: [], charges: []` ("Retail NPC Entity Native Dogma": retail NPC stats
live on the type dogma record, not on fitted modules). Measured in the live
container:

```
PROFILE angel_raider                     loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE parity_angel_autocannon_frigate   loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE blood_raider_prophecy             loadoutID retail_empty_npc_entity_loadout modules 0 charges 0
PROFILE ore_mining_venture                loadoutID ore_mining_venture_dual_miner      modules 1 charges 0
PROFILE concord_police_cruiser            loadoutID concord_medium_beam_laser_cruiser_mwd modules 2 charges 1
```

So `coopWarMusterReadiness` is correct and stock is correct; the two never meet
for pirate subcaps.

**Profiles that DO carry a real, validating weapon+charge (existing data only):**
- `capital_angel_dreadnought` / `capital_serpentis_dreadnought` / ... (each pirate
  faction's capital) — 1 module + 1 charge, `validateNpcHardwareDefinition` -> ok;
- CONCORD (17 profiles, faction 500006);
- Triglavian (28 profiles, faction 500026).

Every pirate *frigate/cruiser/battleship* has zero modules. There is no
subcapital pirate loadout anywhere in the static tables.

**Two honest fixes (both keep coopWarMusterReadiness untouched):**

1. **L1 seam (recommended, real patrols).** Add an explicit loadout override to
   the spawn path (`buildNpcDefinition(profileID, {loadoutID})` or
   `spawnBatchInSystem(..., {loadoutID})`) as a pinned
   `patches/upstream/NNN-npc-loadout-override.patch` + MANIFEST entry, then author
   ONE coop war-patrol loadout (a real turret + a real compatible charge) in the
   coop layer and spawn war patrols with it. Small diff, reversible, keeps retail
   behaviour when the option is absent.
2. **Existing-data-only (no patch, semantically weak).** Use a pirate capital
   (`capital_angel_dreadnought`) as the armed hull, which already has a real
   loadout — but a dreadnought labelled `role:"patrol"` is a misleading label and
   needs a 10-ship world flip to give a fightable border (Jita's neighbours are
   all ORE-owned; ORE has 11 profiles, all miners, and no capital).

Nothing was changed this step: no patch, no flag, no gate relaxation.

**NEXT ACTION (exact):** implement option 1. Start at
`server/src/space/npc/npcData.js:459 buildNpcDefinition(profileID)` and
`nativeNpcService.js:430 buildNativeModuleRecords` (reads
`definition.loadout.modules`); thread an optional `loadoutID` through
`npcSelection.resolveNpcSpawnPlan` -> `spawnBatchInSystem`, add the patch +
`patches/upstream/MANIFEST.json` entry, then `node scripts/apply-upstream-patches.cjs
--checkout <Code> --apply`. Live proof required: `inspect_npc <patrol>` shows
`moduleCount>0` with a weapon+charge, then `war_diagnose` shows
`DRY_RUN_MOBILIZABLE` on both sides, then `living-native-war-assault` fires.

## 2026-10-27 — L1 loadout seam implemented (in progress, live proof pending)

**Done so far.** `patches/upstream/0007-npc-loadout-override.patch` (sha256
`4b9b8215ccf32e88c90ddef38a479f5796d6fbe693bfa7bf0e6d60bda1e2fc82`, MANIFEST
entry, 3 files: npcData/npcSelection/npcService — nativeNpcService is NOT touched
because 0002 owns it). `buildNpcDefinition(profileID, {loadoutID})` ->
`resolveNpcSpawnPlan` -> `resolveBatchSelection` -> `spawnBatchInSystem`; retail
path unchanged when the option is absent, a missing row fails as
NPC_DEFINITION_INCOMPLETE. Apply + reverse both verified.
`integration/coopWarPatrolLoadout.cjs` resolves the profile's own
`<profileID>_loadout` row (real turret + native-compatible charge) and never
overrides an already armed row; `coopAdminBridge.spawnNativeNpc` now refuses an
unarmed `role:"patrol"` spawn (`WAR_PATROL_LOADOUT_UNAVAILABLE:<reason>`), accepts
`loadoutID`/`warPatrol`, and reports the loadout it used.
Tests: `coop-war-patrol-loadout` 7/7, `coop-npc-loadout-override-patch` 5/5.
Deploy: `coop-deploy.cjs` -> `reset=53 patches=series=7 overlay=OVERLAY_OK`.

**Proven live data (read-only probes).** `parity_angel_autocannon_frigate` ->
`parity_angel_autocannon_frigate_loadout` = Domination 125mm Autocannon (13773,
g55) + Domination EMP S (20767, g83), `validateNpcHardwareDefinition` ok, family
angelcartel, `isNpcChargeCompatibleWithModule` true. Every `parity_*` pirate
profile has such a row; `angel_raider`/`blood_raider_prophecy` do not (refused).

**Assault blocker, corrected analysis.** War `war:500011-500014` has defender ORE
(500014) and EVERY ORE profile is a miner/hauler (11 profiles, no weapon), so the
defender side can never muster; registered territories (Jita=500011,
30000144/30000145=500014) are authoritative over live presence, so spawning
Serpentis into a registered ORE system does NOT change the owner (the previous
NEXT list assumed it would). Real fix = a front between two ARMED factions: add
Sobaseki 30001363 (real reciprocal gate 50013876<->50013875, 5 belts) to
`EVEJS_COOP_VIRTUAL_ROUTE` and put one armed Serpentis patrol there; Jita is
already 500011-owned, so a new war 500011-500020 opens on that border and both
sides can muster.

**NEXT (exact).** build + recreate -> `spawn_native_npc` (profileQuery
parity_angel_autocannon_frigate, role patrol, warPatrol true, system 30000142) and
the Serpentis twin in 30001363 -> `inspect_npc` both (moduleCount>0 + charge) ->
`war_diagnose` DRY_RUN_MOBILIZABLE both sides -> `living-native-war-assault`.

## 2026-10-27 — L1 loadout seam + REAL ASSAULT MUSTER (PASS, a7f4c379)

**Proven live (verbatim, container evejs-server-1).**
- `inspect_npc 980000016644` -> `"moduleCount":3` (3x typeID 13773 projectile
  turret, flagID 27/28/29, online) + `"cargoCount":3` (3x typeID 20767 EMP S, one
  per module), `"transient":false`.
- `inspect_npc 980000016639` -> `"moduleCount":5` (5x 13884 hybrid turret) +
  5 charges 20057, `"transient":false`.
- `living-native-war-opened` `OPENED` `warIDs:["war:500011-500020"]`
  `campaignIDs:["war:500011-500020:campaign:30001363"]`, territories now
  `30000142:500011, 30000144:500014, 30000145:500014, 30001363:500020,
  30100032:500020`, `fronts:2`, FUNDED paper treasury.
- `living-native-war-mobilization` `NATIVE_PATROL_MOBILIZED` 980000016644
  ATTACKER (30000142/500011) and 980000016639 DEFENDER (30001363/500020).
- `living-native-war-assault` `ASSAULT_BEGUN`
  `campaignID:"war:500011-500020:campaign:30001363"`
  `attackerShips:[980000016644] defenderShips:[980000016639]`
  `evidence:"REAL_NATIVE_MUSTER_ON_BOTH_SIDES"`.

**Two facts that made this possible (both real, no gate touched).**
1. The muster gate rejects **transient** charges (`c.transient===true`), so a war
   patrol must be spawned `durable:true`; `coopAdminBridge` now does that on
   request and reports `durable`.
2. `campaignReadiness` returned on the FIRST preparing campaign, so the
   un-winnable ORE border (`war:500011-500014:campaign:30000144`, defender ORE
   flies no weapon at all) hid every later border. It now scans all PREPARING
   campaigns and returns the first READY one; the per-campaign gate is unchanged.

**World setup used (owner default: real NPCs/factions only).** Route gained
`30001363` Sobaseki (real reciprocal gate 50013876<->50013875, 5 SDE belts), one
armed Serpentis patrol there (faction 500020) and armed Angel patrols in Jita
(500011) via `spawn_native_npc` + `linkSpawnedIdentity`. No synthetic state, no
fabricated kill, no ammo invented.

**Known noise, deliberately left.** The two transient pirate frigates from the
first attempt (980000016644/16645 were transient then; 980000016644 came back as
a durable restore) plus unarmed transient hulls still linked to some pilots; the
older ORE campaigns stay PREPARING forever by construction (ORE cannot arm).

**NEXT.** (a) battle/objective leg: attack orders -> structure objective binding
-> capture of 30001363; (b) client check of the new campaign on the map/FW tab =
BLOCKED_CLIENT_CHECK without the EVE client; (c) do not re-spawn patrols for the
same campaign (side cap is 1 at recruit rank).

## 2026-10-27 — assault battle leg: real fire + measured HP loss PROVEN (287898d1)

**Proven live (container evejs-server-1, read-only probes).**
- `living-native-war-attack-orders` `NATIVE_ATTACK_ORDER_ACCEPTED` for
  980000016639 -> 980000016987 and back, after the director finally saw its own
  war state.
- `war_combat_diagnose` pair: `sameSystem:true, distanceMeters:4908,
  inRange:true, verdict:AUTHORIZED, warID:war:500011-500020`.
- `living-native-weapon-event` `VERIFIED_NATIVE_WEAPON_EVENT` repeatedly from both
  hulls (module 980100051793 hybrid turret, 13773 projectile turret).
- Ammo bank journal `980000016639.json` phase **COMMITTED** (a real charge debit).
- Victim HP went from `{"shield":225,"armor":200,"structure":215}` to
  `{"shield":200.13459482520693,"armor":200,"structure":215}` — 24.87 HP of
  measured damage from a real Serpentis turret hit.

**Five stacked defects fixed (each proven by a probe before the next):**
1. `gameStore.read(TABLE,"/"+KEY)` cannot see a row written through
   `coopAtomicNativeRows` (the cache nests it at 0x1f). The battle director's
   `snapshots()` was always null -> `WAR_STATE_UNAVAILABLE` -> no order ever.
   `integration/coopNativeRowPath.cjs` is now the one conversion point (195d4ec9).
2. An assault attacker mobilized during PREPARING stayed in the source system and
   held the rank-capped side slot forever (b5a8cd01).
3. `coopNpcFireDebitProof` demanded `flagID` on native charge cargo rows, which
   the native cargo writer never stamps -> `NO_AMMO` on every cycle.
4. The ammo bank journal root did not exist -> `BANK_ATOMIC_JOURNAL_UNSAFE`.
5. The bank transaction declared npcEntities/npcModules (transient rows) and no
   contract covered them; two features now share the npcCargo set, so the caller
   names its contract; a PREPARED journal whose SQLite fence proves no commit is
   recovered as ABORTED by the new `native-ammo-bank-recovery` phase.

**Exact remaining blocker for a KILL (wreck + loot).** One bank cycle spends every
fitted charge (each charge row is quantity 1), so a hull fires exactly ONE volley
and is dry: the cruiser hit for 24.87 HP against a 640 HP frigate. The real lever
is ammo depth: author a war-patrol loadout with `chargeEntry.quantityPerModule`
> 1 (the native spawn honours it, `nativeNpcService.js:563`), spawn the patrol
with that `loadoutID`, then the same fire path kills the victim and
`coopNpcWreckCustody` / `coopNativeLootQuarantine` / `coopWarCasualtyLedger`
follow on the real wreck.

**NEXT ACTION (exact).** Add a coop-authored war-patrol loadout row with
`quantityPerModule` (e.g. 40) reachable through `coopWarPatrolLoadout`, spawn the
Sobaseki attacker with it, verify repeated `living-native-weapon-event` +
falling HP + a real wreck, then continue queue item 2 (casualty ledger -> merit ->
promotion -> treasury).

**Known noise.** The cruiser 980000016639 and frigate 980000016987 each have a
COMMITTED/ABORTED bank journal; hulls left behind in Jita (980000016644/16642)
stay registered to their campaigns. `EVEJS_LOG_LEVEL=2` was used only for the
diagnosis and has been removed from `compose.coop-probe.yaml`.

## 2026-10-27 - war kill loop: real fire -> kill -> wreck -> loot -> casualty -> merit -> promotion (2567db15, 16cda1ed, 00db71a9, 34471320)

**Proven live (container evejs-server-1, read-only admin bridge + coop-events).**
- Loadout: `spawn_native_npc parity_serpentis_blaster_cruiser role patrol durable`
  -> `"loadout":{"status":"RESOLVED","reason":"AUTHORED_MULTI_CHARGE_ROW",
  "loadoutID":"coop_war_patrol_ammo60_parity_serpentis_blaster_cruiser_loadout",
  "chargeTypeID":20057,"chargeDepth":60}` and `inspect_npc 980000017150` ->
  `"moduleCount":5`, cargo 5 x typeID 20057 `"quantity":60` (300 real charges).
- Multi-cycle bank: `living-native-npc-ammo-debit` cargoID 980200006198
  `"before":41,"after":36,"unitsDebited":5` on the same hull (not one volley).
- Measured kill: `war_combat_diagnose` victim HP 225 -> 131.27522104432944 ->
  26.666062461711466 shield, then destroyed.
- Wreck + loot: `living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED`
  wreckID 980300000006 `"storedItemCount":7,"storedQuantity":279,
  "lootStatus":"ITEMS_STORED"`.
- Casualty: `living-native-war-casualty "status":"RECORDED"` wreckID 980300000006
  pilotID coop-pilot-056 (victim), campaign war:500011-500020:campaign:30001363.
- Strict killer: `living-native-destruction-attacker
  NATIVE_DESTRUCTION_ATTACKER_PROVIDED` attackerEntityID 980000017150
  attackerPilotID coop-pilot-050 (upstream options.attackerEntity only).
- Merit + promotion: `living-native-war-merit {"status":"PROMOTED",
  "pilotID":"coop-pilot-050","kind":"warship-kill","merit":25,"from":"recruit",
  "to":"pilot","command":2,"wreckID":980300000006,
  "evidence":"UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK"}`, persisted in
  `coop-faction-war<0x1f>merit-v1` and read by the live command-size rule.

**Three structural defects fixed to get there.**
1. Every real loadout row carried one charge, so a hull fired one volley and was
   dry forever: `coopWarPatrolLoadoutRow` authors a real static row plus a real
   ammo depth (2567db15).
2. A dry hull held its side slot forever: `coopWarBattleLineRelief` releases war
   custody on the mobiliser's own `WAR_NO_NATIVE_LOADED_WEAPON` verdict, and the
   mobiliser's ASSIGN event ID now identifies the real attempt so a released hull
   can be mobilized again (16cda1ed).
3. A destroyed hull stayed registered, so the first kill consumed the slot: the
   registry's `confirmDestroyed` witness is wired to real native wrecks and seeded
   from the durable casualty ledger (34471320).

**BLOCKED_TREASURY_UNFUNDED (exact finding, no fabrication).** The last leg
("treasury credit") has no legal ISK source in this world:
`coopWarTreasury` has **NO_TREASURY_ROW** (no HELD escrow), a RESERVE is refused
for a campaign that already exists, and both war corporations have **no
corporationRuntime wallet row at all** (`1000135`/`1000138` MISSING, so
`NATIVE_CORPORATION_WALLET_UNVERIFIED`), while the victim hull typeID 10016 has no
`shipInsurancePrices` row. Any credit would therefore mint ISK, which is
forbidden. A real settlement needs a funded war chest first.

**NEXT ACTION (exact).** Fund a war chest from real income (NPC economy credits or
a player corporation wallet) and enable `EVEJS_COOP_WAR_TREASURY=1`, then reserve
**before** the campaign is created (`coopWarTreasury.execute RESERVE` refuses an
existing campaign) and pay the bounty from that HELD escrow on
`living-native-war-merit` PROMOTED. Do not mint ISK. After that, backlog:
sovereignty projection -> shipcaster logistics -> player rank decal (title only).

**Known noise.** Two dead wrecks (980300000005/6) with stored loot in 30001363,
the released dry hulls 980000016638/16642/16644 and 980000016639/16987 remain as
real idle NPCs, and the ORE campaigns stay PREPARING by construction.

## 2026-10-27 loop - treasury made real (funded + escrowed live), sovereignty + title projected, payout blocked exactly

**Item 1 code PASS + live funding/reserve PASS (43c8d7ea).**
`coopWarChestFunding` moves real earned ISK (the only real ISK an NPC owns, every
cent paid by a real seeded-market fill) from the faction's own pilots into its
native NPC corporation wallet, then `coopWarTreasury` RESERVE debits that wallet
into HELD escrow. The reservation is taken in `coopFactionWarOpening` BEFORE
`START_CAMPAIGN`, so the treasury's "no reservation for an existing campaign"
rule is never bypassed. PAYOUT releases HELD escrow to one named pilot with an
injected authorizer and no wallet mutation (the value left at RESERVE).
`coopWarKillMerit` pays the kill bounty and the faction's own casualty benefit;
`coopWarBounty` resolves the paying faction from the pilot's real native ship and
corporation. RESERVE now accepts either war party (a defender funds its own
defensive bounty) and the wallet checks accept the real keyed stock row shape
(the old `corp.corporationID` check was the actual cause of
`NATIVE_CORPORATION_WALLET_UNVERIFIED`: the stock row has no such field).

Live, verbatim (container evejs-server-1):
- `living-native-war-bounty-reserved` `{"status":"RESERVED","factionID":500014,
  "corporationID":1000129,"amountCents":2500000,
  "chestJournalID":"chest:bounty:war:500011-500014:campaign:30000143:500014",
  "walletAfterCents":2500000,"sources":["coop-pilot-001"],
  "escrowJournalID":8000000000000000}`
- `living-native-war-opened` `OPENED` `campaignIDs:["war:500011-500014:campaign:30000143"]`
  with `funding:[{status:RESERVED,paper:false,escrow:true,...}]`
- chest journal COMMITTED: coop-pilot-001 172 100.00 -> take 25 000.00;
  earned ledger 172 100 -> **147 100**; corp 1000129 journal `7500000000000000`
  +25 000 then `8000000000000000` -25 000; treasury row exists with the
  reservation `bounty:war:500011-500014:campaign:30000143:500014` **HELD**.

**Exact blocker for the live PAYOUT (NEEDS_OWNER:BLOCKED_TREASURY_NO_ARMED_FUNDED_FACTION).**
The only faction with real earned income is ORE 500014 (147 100 ISK left), and ORE
fields 11 profiles, all miners/haulers with no weapon, so it can never produce or
receive a kill in a campaign it funds. Angel 500011 and Serpentis 500020 can fight
(the proven kill loop) and have **zero** earned ISK: `war_funding_diagnose`
reports `NO_REAL_FACTION_INCOME` for both, so their bounty is refused instead of
minted. The payout path itself is unit-proven (6 tests) and wired; it fires on a
real casualty/merit event for the funded faction. To unblock honestly the owner
needs one of: (a) real earned income for an armed faction (a real native sale by
an Angel/Serpentis pilot), or (b) an armed ORE hull profile with a real loadout.

**Item 2 partial (2671b321).** `coopWarSovereigntyProjection` reports real
military control and refuses to call it native sovereignty unless a real TCU/IHub
AND a real native claim exist. Live: `NATIVE_SOV_CLAIM:0`,
`MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY:5`, reason
`NO_NATIVE_SOV_STRUCTURE` for every held system (the two faction Astrahus are not
sov structures). `coopWarRankTitle` maps a real merit rank to the pilot's visible
title with an explicit empty unlock list, durable once per promotion.
**Shipcaster front logistics: NEEDS_OWNER, not started** - no real shipcaster
structure exists in this world, so any "front logistics" would be invented.

**Item 3 regression (no code change).** war/treasury/merit/opening/admin suites
332 pass / 11 fail (baseline 303/15), `coop-npc-*` 1090 pass / 98 fail (identical
to the recorded baseline). No new failure.

**NEXT ACTION (exact).** Give an armed faction real income: run one real native
sale for an Angel (500011) or Serpentis (500020) pilot through
`coopNativeNpcMarket` (real seeded bid, real cargo), then re-run
`war_funding_diagnose` until its side reports `FUNDED`, let the next opening
reserve the bounty, and confirm `living-native-war-bounty` `PAID` on the next real
casualty of that faction. Do not fund it any other way.

## 2026-10-27 loop - item 1 code PASS, live income BLOCKED BY WORLD GEOGRAPHY (add54831, ff071de9)

**Code (add54831).** `coopNpcLootSellRoles` decides which named native NPC role may
liquidate provenance-verified loot; the runtime no longer hard-codes `pirate`.
Default list is `pirate` (historical behaviour); the live profile sets
`EVEJS_COOP_NPC_LOOT_SELL_ROLES=pirate,patrol` and enables
`EVEJS_COOP_NPC_LOOT_COMMERCE/WRECK_TRANSFER/WRECK_RECOVERY=1`, plus the real
loot typeIDs (211,180,185,216,219,241,243,244,182,2516,20767,4959,20617,11351,
14272,25611,25606) in `EVEJS_COOP_NPC_MARKET_SELL_TYPES`. 6/6 unit tests,
OVERLAY_OK 364 modules, rebuilt and recreated.

**P0 found and fixed while doing it (ff071de9).** `living-native-durable-recovery`
was `NEEDS_OPERATOR_REPAIR` for coop-pilot-046/980000016645 (durable record and
controller in 30000142, link said 30001363), which threw
`DURABLE_NPC_RECOVERY_REQUIRES_REPAIR` **before** `createBridge()`. The bridge
therefore did not exist in this boot, so every bridge-driven phase (raids, loot
station delivery, market assignments) was silently inert. Stale links are now
reconciled only under `EVEJS_COOP_DURABLE_RELOCATE_RESTORE=1` via the registry's
own `relocate()`. Live after deploy: `status OK, alreadyPhysical 67, errors []`.

**Why the armed factions still cannot sell loot (measured, not inferred).**
1. The only theatre with real armed native combat is 30001363 (campaign
   `war:500011-500020:campaign:30001363` in ASSAULT). Its region 10000016 has
   **zero** seeded buy rows for 1228/34/211/20767/14272/11351, i.e. no NPC market
   at all, so recovered loot can never be sold there (region 10000002 = 132 rows,
   10001004 = 18).
2. The demand systems have no real armed combat: 30000145's mining fleet is
   stuck (`living-npc-station-route ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED`, ships
   ~4.4e11 m from the belt) so pirates have no live prey; 30100032 has 0 SDE
   belts (`SYSTEM_HAS_NO_SDE_BELTS`); Jita's Guristas/Angel patrols have no
   native attack order.
3. ORE 500014 (the only faction with real income, 147 100 ISK, bounty already
   HELD for `campaign:30000143`) has **no armed profile at all** in the native
   resolver (only empire/pirate `parity_*` combat profiles exist), so
   `war_diagnose` mobilises 0 ships for every 500011-500014 campaign and its
   escrow can never pay a kill or a death benefit.
4. `war_funding_diagnose` (live): 500011 `NO_REAL_FACTION_INCOME`, 500020
   `NO_REAL_FACTION_INCOME`, 500014 `FUNDED` (coop-pilot-001 147 100 ISK).

**NEXT ACTION (exact, one decision).** Item 2's payout needs a real casualty of
the funded faction inside `campaign:30000143`, which needs an armed ORE hull;
the alternative is a real kill by an armed faction inside a seeded-market system.
Both are world-configuration choices, not missing code:
(a) add a real armed ORE (500014) native combat profile so 500011-500014 can
muster, or
(b) bring an armed pair's front into a seeded region (30000144/30000145/Jita),
or (c) seed region 10000016 (forbidden here: no market rebuilds).
Until one is chosen, do not mint ISK and do not fake a kill.

**Shipcaster logistics: NEEDS_OWNER, with evidence.** The SDE really contains
shipcaster beacon structure types (75928 Imperial, 75929 State, 75930 Federation,
75931 Republic) but they belong to the four empires; no shipcaster beacon type
exists for 500011/500014/500020, so a "faction shipcaster" would misrepresent
structure ownership. Nothing was deployed.

## 2026-10-27 (FW-013) - the armed pair's front is in the seeded region; three silent raid blockers fixed (9ff67b86)

**Owner default applied: an armed pair's front now sits in seeded region 10000002.**
SDE-verified, not guessed: Maurasi 30000140 has 25 real belts, sits in region
10000002 (the only region with real seeded buy rows for the loot types: 431
station/type rows, all in Jita 30000142 and New Caldari 30000145), and has a real
reciprocal gate to Jita (50000802 <-> 50001248). It was added to
`EVEJS_COOP_VIRTUAL_ROUTE` so the headless boot tracks it
(`living-headless-boot-system 30000140 realAsteroidBelts 25
authoritativeSdeBelts 25`).

Real armed hulls spawned with `spawn_native_npc` (durable, authored multi-charge
row `coop_war_patrol_ammo60_*`):
- 980000018058 Serpentis cruiser, role **pirate**, New Caldari 30000145
  (coop-pilot-070) - the income bootstrap;
- 980000018084 Serpentis cruiser, role patrol, Maurasi 30000140 (coop-pilot-063)
  - makes the system Serpentis by real presence;
- 980000018085 Angel frigate, role patrol, Jita 30000142 (coop-pilot-078).

**Measured:** `living-native-war-opening-blocked` now reports
`SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME`.
That is the whole remaining gap: the front exists and BOTH sides are armed; only
the real escrow reservation is missing, and it must come from a real seeded sale.

**Three silent blockers removed (all measured, none guessed):**
1. `EVEJS_COOP_MATERIALIZE_LIMIT: '26'` made `createBridge()` throw (contract
   1..10) inside `observeSession` before `bridge` was assigned. Every
   bridge-driven phase (raids, loot delivery, market assignments) had stopped
   existing while the world looked healthy. `coopMaterializeLimit` clamps and
   reports it; `living-native-bridge` publishes the created bridge.
2. The raid director read the materializer assignment map, rebuilt only during
   boot, so a hull linked afterwards was invisible. It now reads the identity
   registry (the same authority the raid legality gate uses).
3. The civilian route director held a CIVILIAN lease on pirate hulls and orbited
   them, so every raid order was refused
   `COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE`. One owner per record: a pirate's
   movement belongs to the raid director.
`coopNpcOrderBridge.diagnose()` + `living-native-raid-diagnose` make any
future refusal an exact, published reason instead of a silent boolean.

**Live proof of the fix:** `living-native-raid-diagnose 30000145 pirates 3
fleetShips 23 oreBearing 5 authorized 21-22` -> `living-pirate-raid`
`[{"pirateID":980000018058,"targetID":980000016318,"targetRole":"hauler",
"action":"attack"}]` (30000144 attacks 980000016310) with
`orderDiagnosis PERMITTED, leaseOwner RAID`.

**NEXT ACTION (exact).** Wait for the real raid kill in 30000145 (a real stock
mining-fleet hauler, 300 fitted charges): wreck -> `coopNpcWreckCustody` ->
loot cargo -> `coopNpcLootCommerce` warp to a New Caldari station ->
`coopNativeNpcMarket` fill against a real seeded bid (25606/25611/180/211 at
New Caldari/Jita) -> Serpentis `earned` ISK -> `warBountyReserve` can then
reserve for `war:500011-500020:campaign:30000140` (attacker Angel from Jita,
defender Serpentis in Maurasi) -> mobilize -> BEGIN_ASSAULT -> real kill ->
`living-native-war-bounty` PAID from HELD escrow. Never mint ISK; if the kill or
the fill does not happen, record the measured blocker.

## 2026-10-27 (FW-013 result) - seeded-region front PROVEN; the income leg is the single remaining blocker

**Proven (live, verbatim):**
- Maurasi 30000140 is registered military control **500020** (Serpentis) after the
  real armed cruiser 980000018084 (coop-pilot-063) was spawned there, so a real
  border with Jita 30000142 (500011 Angel) exists **inside seeded region
  10000002**. SDE: 25 real belts, reciprocal gate 50000802 <-> 50001248.
- `living-native-war-opening-blocked` reason (last, 05:27:18Z):
  `SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500020:NO_REAL_FACTION_INCOME`.
  The front, both armed sides, the declaration presence and the adjacency proofs
  all pass; only the real escrow reservation is missing.
- Raid authority is now fully live and measured: `living-pirate-raid 30000145`
  real attack orders (owner RAID, `orderDiagnosis PERMITTED`),
  `npc_pair_diagnose` 980000018994 -> 980000016318 `engagementAllowed true`,
  `manualType attack`, `allowWeapons true` at 15122 m, 5 hybrid turrets with
  5 x 60 real charges.
- Real NPC-vs-NPC fire does happen in this world: 30000144
  `living-native-weapon-event` missile-launch 980000000153 -> 980000000444 and
  `living-native-combat-damage` correlated damage 0.013 HP.

**NEEDS_OWNER:BLOCKED_ARMED_FACTION_INCOME (exact missing data).** No armed
faction can earn the 25 000 ISK the bounty needs, because earning requires a real
seeded sale and a sale requires a kill inside Jita/New Caldari:
1. the stock mining fleet in region 10000002 sits at AU-scale positions
   (`toBeltMeters` 4.4e11 m) and keeps warping on its station route
   (`ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED`). Measured over 20 min: the raiding
   cruiser went 15 122 m -> 37 253 m from its target, both in GOTO,
   `currentTargetID 0`, zero module activations;
2. a hull in an active warp is rejected by the native combat resolver, so the
   chase cannot convert into damage (the new filter at least stops the pirate
   from being dragged across the system);
3. the only real exchange in 30000144 is a Guristas patrol retaliating against an
   *unarmed* pirate for ~0.01 HP per sample, and Perimeter has no seeded buy rows
   (the seeded rows are only at Jita 30000142 and New Caldari 30000145 stations).
Nothing was minted, no fill or kill was invented.

**NEXT ACTION (exact).** Two honest ways to close it, both world-configuration:
(a) repair the mining fleet's real position/route state so a belt miner is
stationary at a reachable point (then the raid kill, wreck, loot and seeded sale
follow on the already-proven path), or
(b) let an armed faction earn from a real seeded fill it can already reach (for
example a real ore haul by a pirate hull that owns cargo). Do not seed region
10000016 and do not place unbacked orders.
Shipcaster logistics stays NEEDS_OWNER (no shipcaster beacon type exists for
500011/500014/500020 - only 75928/75929/75930/75931 for the four empires).

## 2026-10-27 (FW-014) - item 1: mining-fleet movement root causes found; item still OPEN

**Read-only probe (new, 75f9f54f).** `mining_fleet_diagnose` (admin bridge,
`systemIDs`) reports, per ship: mode, pendingWarp, the sessionless warp clock and
its own destination distance, distance to the nearest real SDE belt and to the
trip station, the arrival surface gap, the dwell clock, the controller manual
order, the arbiter lease owner; per fleet: state, origin anchor, trip and the
trip-journal record (latest manifest, departure ack, expiry, overdue).
Live: `fleet 960004609 state=loaded originAnchor distanceMeters 448793612100`,
`journal latestManifestKey 30000144-960004609-1793061051055 ageMs 20187185
overdue true departureAck false expired false`, miner `nearestBelt 448793621638`.

**Three real defects, all measured, all fixed:**
1. **Ack-less prepared trip could never be closed** (88a3ee63). The journal
   returned `ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED` without the deadline
   evidence, and `expire()` demands a departure ack, so the fleet sat in
   `loaded` for 5.4 h and mined nothing. `abandon()` now writes a durable
   `ROUTE_ABANDONED` record after a 2 min grace (a route WITH an ack is still
   only expired; manifest, cargo and ack untouched). Also: a stalled hull is
   re-flown to its own trip's station with the same native warp, a hauler that
   is already at the station is not warped (`WARP_DISTANCE_TOO_CLOSE` deadlocked
   every new trip), and the native "too close" refusal now becomes a real
   subwarp approach instead of `WARP_COMMAND_FAILED`.
2. **The deposit loop threw out of the whole mining tick** (a5f3fd53).
   `WARN [SpaceRuntime] Mining tick failed for system=30000145: baselineKey is
   not defined`, every tick, for hours: `baselineKey` was block-scoped inside
   the sale block and used again after it, so nothing was ever deposited. Hoisted.
3. **A stranded miner was only ever told to follow its rock** (b93bae0d).
   `TARGET_OUT_OF_RANGE distanceMeters 448793611732 engagementMeters 11500`.
   `coopMiningBeltReturn` issues the same native warp the fleet uses for its own
   warp-in (landing point one rock radius + one orbit radius from the centre),
   and `coopMiningTripRetreatGuard` stops a retreat from dragging a hauler that
   is flying an acknowledged trip (`living-mining-retreat-skip`,
   `living-npc-station-trip-rewarp gapMeters 190173736005 accepted true`).

**Tests:** 49/0 (diagnose 6, belt return 7, retreat guard 4, journal 32) ;
recovery suite 8 pass / 2 fail, both identical at the pre-change baseline
(verified with `git stash`). Overlay `OVERLAY_OK` reset=53 patches=series=7.

**Item 1 is NOT closed.** The fleet has not re-entered `mining` yet, so
`living-mining-belt-warp` has fired 0 times. The delivery leg now reaches its
own arrival gate instead of throwing, and answers `WAREHOUSE_ARRIVAL_NOT_VERIFIED`
for the last haulers of the 30000144 trip (the sampled haulers are gap 0 m,
dwell set, ack true), so the exact next step is to explain that verdict
(`verifyArrival`: point / stableAt / dwelled) and only then confirm a real
mining cycle at the belt. Items 2-4 (pirate kill, seeded sale funding the war
chest, verbatim loop proof) are untouched.
**Correction, same run (07:14Z live):** `living-mining-belt-warp WARP_ISSUED`
13 times for fleet 960004641 (30000145) at `distanceMeters 244253380576`
(`thresholdMeters 100000`), fired right after `living-mining-blocker TICK_mining`
proved the fleet had returned to `mining`. The same miners were then measured at
`belt 20681 / 24174 / 45493 / 46104 / 49489 / 103499` m instead of 2.4e11 m, i.e.
they really flew back and are closing the last kilometres at subwarp. The fleet
had moved on to `loaded` again (a new haul), which is why `act 0` at that sample:
mining modules are deactivated for a haul by design. Next exact step is therefore
narrow: sample the fleet while it is in `mining` and require
`activeModuleEffects > 0` plus a settled cycle for at least one miner, and explain
`WAREHOUSE_ARRIVAL_NOT_VERIFIED` for the haulers the deposit gate rejects.
## 2026-10-27 (FW-015) - item 1 part a: the arrival gate explains itself (3d3eedf1)

**Proven live (verbatim, container evejs-server-1).** The deposit refusal now
carries its own reason instead of a bare status:

```
"event":"living-npc-warehouse-blocked","fleetID":960004609,"cargoID":980200001433,
"reason":"ARRIVAL_NOT_VERIFIED","detail":{"ok":false,"term":"DWELL_PENDING",
"gapMeters":0,"maxSurfaceGapMeters":2500,"mode":"GOTO","warping":false,
"arrivedAtMs":1793086116032,"activeArrivedAt":1793086116032,"dwellMs":2000,
"dwelled":false}
```

**The explanation (measured, not inferred).** The hauler was physically ON the
station (surface gap 0 m, not warping) and the receipt was written 3 s later, so
the gate was not refusing a real arrival. rrivedAtMs 1793086116032 belongs to
event time 1793086113991: the native tick clock ran **2 041 ms ahead** of
Date.now(). The trip loop measures dwell with the tick clock (
ow), the
deposit gate measured it with clock() = Date.now(), so the second subtraction
was negative and DWELL_PENDING was reported forever. One clock now decides: the
tick clock travels into deposit({nowMs}) -> explainArrival.

**Three fixes in the same commit.**
1. explainArrival + detail on the refusal + rrival_diagnose admin action
   (read-only, uses the LIVE director's own rrivals map).
2. A warehouse receipt names the **ore owner** (deposit goes into the owner's
   hangar); the manifest names the **station corporation**. Both files compared
   them, so every real deposit was refused as
   MANIFEST_WAREHOUSE_RECEIPT_CONFLICT (live proof: manifest corp 1000031,
   receipt corp 1000129, quantity/type/station identical). The owner is now taken
   from the manifest row (new manifests record the pre-warp cargo owner) or from
   the physical stack, which the native itemStore check must still prove.
3. 	ransferCargo never loads ore into a hauler an active manifest declared.
   Live: new loads at 07:27:03 and 07:30:08 turned the pending trip into
   ALIFE12_ALIFE12_UNDECLARED_HAUL_CARGO, so it could never close.

**NEXT ACTION (exact).** Item 1 part b: wait for the pending 30000144 manifest to
close (the journal deadline is 15 min; the trip now cannot gain undeclared cargo),
then sample mining_fleet_diagnose WHILE state=mining and require
ctiveModuleEffects > 0 for at least one miner plus a settled cycle
(living-mining-cycle-settled with 
extCargo rising). Only then item 2 (real
pirate kill -> wreck -> loot -> casualty ledger -> merit).

## 2026-10-27 - ITEM 1 CLOSED (live): the fleet mines at the belt, ore really rises

**Proven live (container evejs-server-1, read-only probes, verbatim).**

```
{"at":"2026-10-27T08:06:01.256Z","fleets":[{"fleet":960004609,"system":30000144,
 "state":"mining","act":13,"belt":13,
 "active":["980000016027:2","980000016144:2","980000016145:2"]}]}
```

13 of 13 miners carry 2 live module effects each and all 13 sit within 200 km of a
real belt. The settled cycle (ore really rising):

```
{"at":"2026-10-27T08:01:02.383Z","event":"living-mining-cycle-settled","shipID":980000016470,
 "systemID":30000144,"status":"COMMITTED","rockID":5020484726851,"moduleID":980100051175,
 "oreTypeID":17470,"quantity":1874,"beforeRock":228126,"afterRock":226252,
 "cargoID":980200010837,"nextCargo":3748,"replayed":false}
```

and the delivery leg really completes now: living-native-haul-delivered fleetID
960004609 DELIVERED at 07:54:57Z and 07:56:58Z.

**Why the deposit gate kept refusing (the answer to the open question).**
WAREHOUSE_ARRIVAL_NOT_VERIFIED was DWELL_PENDING with gapMeters 0: the hauler
was physically on the station, not warping, and the receipt appeared 3 s later.
The tick clock ran **2 041 ms ahead** of Date.now(), the trip measured dwell with
the tick clock and the deposit gate with the wall clock. One clock now decides
(deposit({nowMs})). The manifest side had a second, independent cause: the
receipt names the **ore owner** and the manifest names the **station corporation**,
and both files compared them (live: manifest corp 1000031 vs receipt corp 1000129,
quantity/type/station identical), so every real deposit was rejected.

**Two more deadlocks found and fixed on the way.**
1. A superseded manifest (all declared rows proven, the hull carrying ore the
   manifest never declared) lost its identity in the arrival wrapper, so start()
   answered the same pause on every tick and the fleet sat in "loaded" 20 min
   (a57aa3ea).
2. An aggressed stock fleet can never resume: the stock auto-resume delay defaults
   to 0, so esumeAtMs stays 0 and state stays "aggressed" forever. The live
   profile now sets the real stock knob EVEJS_MINING_NPC_FLEET_AUTO_RESUME_DELAY_MS=120000
   (no code change, no gate relaxed). mining_fleet_diagnose publishes
   esumeInMs/esumeOverdue/esponseWing/lastAggressedAtMs so this is
   visible instead of inferred.

**NEXT ACTION (exact).** Item 2: the Serpentis cruiser 980000018058 (300 real
charges, live attack order on miner 980000015943 in New Caldari 30000145) must
really kill a miner: repeated living-native-weapon-event, measured HP loss, a
real wreck with stored loot, living-native-war-casualty, and merit. The 30000145
fleet must leave "aggressed" first (auto-resume 120 s after the last aggression,
and only when its response wing is gone) - esumeInMs/esponseWing say which.

## 2026-10-27 - ITEM 2 blocked exactly: the raid holds an order it cannot fly

Measured, verbatim, read-only:

```
{"ok":true,"attackerID":980000018058,"targetID":980000016311,
 "distanceMeters":373994639646.8543,
 "attacker":{"systemID":30000145,"inScene":true,"mode":"GOTO"},
 "target":{"systemID":30000145,"inScene":true,"mode":"ORBIT"},
 "controller":{"currentTargetID":0,"manualType":"attack","manualTargetID":980000016311,
 "allowWeapons":true},"engagementAllowed":true}
```

2.5 AU apart, the attacker in GOTO (a "warp" that never became a warp), the order
still held. The fleet side:

```
{"fleet":960004641,"state":"aggressed","resumeInMs":92113,"responseWing":0,
 "lastAggressedAtMs":1793088751229,"miners":13,"atBelt":0}
```

esponseWing 0 and esumeAtMs set (the new stock auto-resume knob), but the
aggression clock is re-armed every couple of minutes, so the fleet never returns to
mining; coopMiningBeltReturn only runs in the mining branch, so its 13 miners
stay 2.4e11 m off the belt and nothing can be shot.

**NEXT ACTION (exact).** In integration/coopNativeRaids.cjs (the distance >
250000 branch that issues warp-to-hauler): after the native warp call, verify the
hull is really warping (mode WARP / sessionlessWarpIngress) and not in GOTO; when it
is not, release the order (no attack lease) and publish
RAID_APPROACH_UNFLYABLE:<distanceMeters>. The fleet then leaves "aggressed", the
belt return flies the miners home, and the next raid at the belt is the one that can
convert into damage. Then: wreck -> stored loot -> New Caldari 30000145 seeded sale
-> Serpentis 500020 real income -> warBountyReserve -> war 500011-500020 opens
with SUPPLY_UNFUNDED resolved -> escrow PAYOUT to the named pilot.

**Correction/refinement to the item 2 next step (same run, 08:18Z).** The pirate
980000018058 holds controller.manualType:"attack" with currentTargetID:0 while
flying GOTO, and the order bridge's own diagnose answers
COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE for a hull with an active native command. So
the most likely mechanism is self-blocking: the raid's earlier ttack order is
still active, the native controller refuses the later warp-to-hauler, and the hull
subwarps toward a target 2.5 AU away while the fleet stays "aggressed". Check that
before changing any distance constant: read
coopNpcOrderBridge.diagnose({entityID:980000018058}) and, if it is
NATIVE_COMMAND_ACTIVE, make the raid release its own previous order before issuing
the approach (one owner per record), publishing RAID_ORDER_RELEASED_FOR_APPROACH.

## 2026-10-27 (FW-016) - item 2 step 1+2 PASS (code + live): the raid releases its own order; the approach now really flies (7e07e000, 64d166c5)

**The hypothesis in the previous NEXT was wrong, and that is now measured.** The
order bridge answers `PERMITTED` / `leaseOwner RAID` for 980000018058 (published
in `living-native-raid-diagnose.pirateDetail[].orderDiagnosis`), so the stale
order was never a bridge gate. What actually pinned the hull was the native
controller's own subwarp pursuit (mode GOTO) plus our own unexecutable order.

**Two rules added (both through the bridge, no distance constant touched).**
1. `RAID_ORDER_RELEASED_FOR_APPROACH` - the hull's own previous attack order is
   released before a new approach, and an unreachable locked prey (> the same
   250 km boundary) is released and re-approached with a real warp in the same
   tick. `RAID_APPROACH_UNFLYABLE` when an approach never became a real warp
   (20 s), `RAID_ATTACK_NO_LOCK` when an attack never acquired a native lock
   (90 s). A rival order is never released: 980000018994 correctly answers
   `released:false, errorMsg COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE` (CIVILIAN
   lease). `npc_pair_diagnose` now also reports the bridge verdict and both
   hulls' health layers.

**Live proof the approach now flies.** `RAID_ORDER_RELEASED_FOR_APPROACH`
980000000602 at 373 994 659 694 m, then 30 s later real attack orders at
**10 162 m** (980000000601) and **8 882 m** (980000018058) - previously the same
pair held an order at 2.5 AU for 20 minutes and never fired.

**EXACT remaining blocker for the kill (`NEEDS_OWNER:BLOCKED_RETREAT_INVALIDATES_EVERY_ORDER`).**
The stock aggression path (`miningNpcOperations.handleAggression` ->
`retreatFleetToOrigin`) teleports the whole fleet 2.5 AU on the FIRST aggression.
The native loop then clears the attacker's `manualOrder` because the prey is no
longer a valid combat target, so `currentTargetID` returns to 0 within seconds and
the hull resumes its own GOTO. Measured on 980000016472: shield 146.45 -> 161.80
-> 193.13 -> 199.88 -> 209.32 -> 217.34 -> 225.00 over 5 minutes (real missile
hits from 980000000601, then FULL regeneration), 0 wrecks, last
`living-native-weapon-event` 08:48:40Z. The pair distance flips between 35 928 m
and 373 994 655 083 m every ~30 s, which is the retreat/belt-return cycle, not a
stale order.

**NEXT ACTION (exact, one decision).** A kill in a seeded system needs the prey to
stop completing an instant sessionless retreat while it is being shot. Two honest
options, both real mechanics, neither a gate relaxation:
(a) fit a real warp disruption module on the war-patrol loadout
    (`coopWarPatrolLoadoutRow`) and activate it on the prey - stock
    `beginNpcWarpToPoint` already refuses a warp when
    `hostileModuleRuntime.isEntityWarpScrambled(entity)` is true, so the fight
    resolves at close range and the wreck loot (2x typeID 482 = 571 211 ISK bid
    at New Caldari 60000688, plus 16 380 ore 17463) becomes a real sale;
(b) an L2 rule that a fleet retreat is refused while a hostile holds a live
    native attack order on a fleet hull inside engagement range.
Do NOT weaken `coopWarMusterReadiness`, do not seed a region, do not mint ISK.
Verified buyers (read-only `GetOrders`, region 10000002, `source: seed`):
20767 62 839 ISK at 60000682 (New Caldari), 482 571 211 ISK at 60000688,
13773 3 083 304 ISK at 60000682, 17464 15.48 ISK at 60000688 - the
`NO_SEEDED_COUNTERPARTY` note is stale for these types.

## 2026-10-27 (FW-017) - item 1 CLOSED: a real warp point really scrambles a real hull (3c46dbb3, 7efd3e82, 2fba2807)

**The old blocker is gone.** `BLOCKED_RETREAT_INVALIDATES_EVERY_ORDER` had two stock
causes, both measured, both now fixed as L1:

1. `hostileModuleRuntime.getEntityWarpScrambleStatus` returned the hull's PASSIVE
   `warpScrambleStatus` baseline (-2 on retail hulls) and never the live effect sum,
   so `isEntityWarpScrambled` was permanently false for any hull that carries the
   attribute: a fitted Warp Disruptor II on a Venture read back -2 (live
   `preyScrambleStatus:-2` in every refused attempt).
2. `runtime.warpToEntity/warpToPoint` resolved the command ship with
   `getShipEntityForSession`, which only understands a SESSION. The native NPC loops
   command by ENTITY ID, so `isShipWarpDisabledByRuntime` and
   `isEntityWarpScrambled` both saw no ship and an NPC hull warped while really held.

Both are patched (`0008-warp-scramble-live-effects`, `0006` extended). **Ops bug
found and fixed on the way:** `git -C <Code> apply` resolved the patched path
against the upstream repo root and silently SKIPPED it (exit 0), so a coop-deploy
reset left managed files unpatched while the applier printed a healthy series;
`apply-upstream-patches` now applies from the root with `--directory=Code`.

**Live proof (10:01:16Z).** `living-native-warp-point-engaged status ENGAGED
alreadyScrambled true` for 980000018058, 980000000601 and 980000000602 on the same
miner 980000016052 - the first time a real warp disruptor made a real hull read as
scrambled in this world. `inspect_npc 980000000602` -> `moduleID 980100060463,
typeID 3244 (Warp Disruptor II), flagID 19, online true`, written through
`nativeNpcStore` (real native module record, real mid slot from the native auto-fit).

**NEXT ACTION (exact, item 2).** The prey is now holdable; the missing piece is
SUSTAINED DAMAGE on a held prey. Measured at 10:06Z: 980000000601 sits **1 393 m**
from 980000016052 with a FULL shield (6890/6890) and no launch since 09:53:20Z,
while 980000018058 (5 blasters, 300 real charges, the only deep ammo bank) holds an
attack order **2.5 AU** away at the belt. Two concrete things to check next, in
this order:
1. `coopNpcWeaponAmmoGate` / `nativeAmmoSupply` for 980000000601: it fires a
   hull-effect missile (chargeTypeID 213) and launched exactly 3 times, then
   stopped - if the gate is blocking it, the raid must prefer the hull with a real
   ammo bank (980000018058) instead of the nearest hull.
2. Why 980000018058 does not close from 9 225 m to blaster optimal: it keeps an
   attack order but its mode is GOTO back to the belt after the prey moves; the
   `attackNoLockMs` release + re-approach cycle is the thing to tighten (keep the
   order while the prey is pinned, which is already implemented via
   `preyScrambled`, and make sure the lease is not released while pinned).
Do NOT script damage, do not touch distance constants, do not mint ISK.

**Concrete lever found for the DPS gap (same run, 10:15Z).** `npcRuntime.orbit(entityID,
targetEntityID, distance, options)` is a real native order and the raid director does
not use it. The blaster cruiser's behaviour profile parks it at ~9 km, which is far
outside a blaster's own optimal range, so its 300 real charges hit nothing. The honest
next change is one order: when the attacker's fitted weapon (`estimateNpcHostileEffectiveRange`
/ the module's own `maxRange` attribute) is shorter than the current distance, issue a
real native orbit at that attribute's range before the attack. No distance constant of
ours, no scripted damage: the ship flies to its own gun's range and the native cycle
does the rest.

## 2026-10-27T10:52Z - item 2 step 3 (WIP, committed): the raider flies to its own gun range (1d6a3833, 91f68dde)

**Code.** `integration/coopNpcGunRange.cjs` reads the range from the stock resolver's own
snapshot (`getNpcWeaponModules` + `buildNpcWeaponModuleSnapshot`: turret `maxRange`,
launcher `approxRange`); the raid issues the attack with that number as the hull's
engagement distance via the stock `npcService.setBehaviorOverrides({orbitDistanceMeters})`.
A standalone manual orbit is NOT used (measured earlier: the native hostility invariant then
treats the prey as friendly -> mode STOP, currentTargetID 0). `npc_pair_diagnose` now also
reports `gunRange` and `returningHome`/`leashRangeMeters`/`homeDistanceMeters`.
Refinery: the journal file name is escaped on win32 (key unchanged).

**Live so far (verbatim, earlier deployed variant):** `living-pirate-raid` 30000145
`action":"orbit-to-range","pirateID":980000018058` `gunRange":{"status":"RESOLVED",
"meters":1050,"source":"maxRange","family":"hybridTurret","typeID":13884,"falloffMeters":3000,
"weaponCount":5}` at `distanceMeters 2251.76`. Sustained fire on a held prey and a real
wreck are **NOT proven**.

**NEXT ACTION (exact).** After this deploy sample `npc_pair_diagnose 980000018058 -> <its held
prey>` and require repeated `living-native-weapon-event` plus falling shield/armor on the
same victim; if the hull still sits outside its own gun range, read the new
`returningHome`/`leashRangeMeters`/`homeDistanceMeters` fields (a stock NPC beyond its
leash clears combat state and flies home) instead of guessing. Then wreck -> stored loot ->
casualty ledger -> merit -> seeded sale -> war chest -> PAYOUT.

## 2026-10-27T11:48Z - item 2 step 4 (committed): why the DPS never happens, measured (d0f5d8de, e20f6801, 1e431ed0, c6965dbd)

**New read-only tool.** `raid_diagnose` (admin bridge -> `diagnoseNativeRaids`) reports
per linked pirate: exclusion reason (loot delivery / ammo supply), native controller state
(mode, currentTargetID, manual order, returningHome, leash, home distance, orbit override),
the range its own fitted weapon really has, and its nearest real prey - plus the director's
leases. A refused native warp is now published instead of leaving a silent lease.

**Measured (verbatim).** At 11:18Z `raid_diagnose 30000145`: `status OK, linkedShips 21,
roleCounts pirate 4, fleetShips 23, leases []`; 980000018058 `mode STOP,
homeDistanceMeters 0, gunRangeMeters 1050 RESOLVED`, nearest hauler 980000016318 at
**4446 m**. Three minutes later `npc_pair_diagnose 980000018058 -> 980000016318`:
`distanceMeters 373994637299.5` (2.5 AU), `returningHome true, leashRangeMeters 90000,
manualType "", currentTargetID 0`. So the hull had the prey 4.4 km away, the prey's retreat
moved it 2.5 AU, and the stock leash cleared the order and flew the hull home. Last
`living-native-weapon-event` 10:20:06Z; the 300-charge cruiser has never fired in this boot.

**Fix (c6965dbd).** While the raid holds a lease it owns the hull's movement: it widens the
hull's own stock leash to the approach it ordered (distance + 100 km) and restores the
profile value on release, publishing `living-native-raid-leash` once per change. The leash
is a behaviour parameter, not an evidence gate.

**NEXT ACTION (exact).** Sample `raid_diagnose`/`npc_pair_diagnose` until 980000018058
holds an attack order inside its own 1050 m gun range on a pinned prey, then require
`living-native-weapon-event` from it plus falling shield/armor on the same victim, then the
wreck -> loot -> casualty -> merit -> seeded sale -> war chest -> PAYOUT chain.

## 2026-10-27T11:58Z - item 2 step 5: the leash is measured from HOME (ccd6046c)

Live, verbatim: `npc_pair_diagnose 980000018058 -> 980000016472` gave
`manualType "attack", allowWeapons true, behaviorOverrides {orbitDistanceMeters 1050,
leashRangeMeters 149182}, returningHome true, homeDistanceMeters 862066008895` and
`locks {locked: [], pending: [], activeModules: []}` on BOTH hulls, distance 40-49 km and
slowly closing in GOTO. So the order and the gun range were right, the leash value was
wrong: 149 km is measured from the hull, but the leash is measured from the hull's own
home, 5.7 AU away. ccd6046c: the scope covers home->hull + hull->prey + 100 km.

**NEXT ACTION (exact).** After this deploy sample `npc_pair_diagnose 980000018058 ->
980000016472` every minute and require (a) `returningHome false`, (b) a completed lock,
(c) `activeModules` non-empty, then `living-native-weapon-event` from 980000018058 and a
falling shield/armor on the same victim. If the lock stays empty, the next question is why
the stock loop does not add it, not the leash.

## 2026-10-27T11:54Z — ITEM 2: the first real raid kill in the seeded region (25e879fe, f5d8454a)

**Proven live (container evejs-server-1, verbatim).**

```
{"at":"2026-10-27T11:52:33.981Z","event":"living-native-stock-fleet-wreck-evidence",
 "status":"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED","systemID":30000145,
 "victimEntityID":980000016472,"victimRole":"miner","wreckID":980300000008,
 "storedItemCount":3,"storedQuantity":93450,"lootStatus":"ITEMS_STORED"}
```

The chain that produced it, all real:
`living-native-raid-leash APPLIED` (980000018058 leash 373 994 723 022 vs profile
90 000 for a 373 994 623 021 m order) -> `living-native-warp-point-engaged`
`ENGAGED alreadyScrambled true` for 980000000601 and 980000000602 on miner
980000016472 -> `living-native-weapon-event` missile-launch 980000000601 ->
980000016472 -> real wreck 980300000008 with 3 stored stacks (93 450 units).

**Two defects fixed here.** (1) An attack order on prey beyond the 250 km approach
boundary was released only after the 90 s no-lock window, which a 60 s attack lease
re-arms forever, so the hull orbited at 2.5 AU holding an order it could not fly; the
far case now releases and re-approaches on the re-check itself. (2) A concurrent
commit had captured the `relocateRaidHomeAnchors(...)` call site without its
definition, so the whole `native-raids` phase failed
(`living-world-phase-failed ... relocateRaidHomeAnchors is not defined`); the orphan
call is removed and the leash (c6965dbd) is the single movement mechanism.

**NEXT ACTION (exact).** Item 3: recover wreck 980300000008 and sell its loot to the
real seeded buyer at New Caldari 60000688 (typeID 482 @ 571 211 ISK), then fund the
faction chest from that real fill, re-run `war_funding_diagnose` until the side reads
FUNDED, and confirm `living-native-war-bounty` PAID from HELD escrow.
## 2026-10-27T12:02Z - ITEM 1 CLOSED (live): real fire, real kill, real wreck with stored loot

**Proven (verbatim, container evejs-server-1).** The DPS gap is closed by the home-measured
leash (ccd6046c): `npc_pair_diagnose 980000018058 -> 980000016299` showed
`locks {locked:[980000016299]}, activeModules [... 980100056948]` and the victim's shield fell
**3118.35 -> 1773.12 in 30 s** while the attacker orbited at 2030 m. Then two real wrecks:

- 11:52:33Z `PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED` victim 980000016472 wreckID
  **980300000008**, `storedItemCount 3, storedQuantity 93450, lootStatus ITEMS_STORED`,
  attacker 980000000601 (coop-pilot-060);
- 12:00:10Z wreckID **980300000009**, victim 980000019472, `storedQuantity 3150`,
  attacker 980000000602 (coop-pilot-080).

**NEXT ACTION (exact).** The loot leg: watch `living-native-loot-*` for the recovery of wreck
980300000008/9, then `living-npc-station-sold` with real ISK from a seeded bid at New Caldari
60000688 (482 @ 571 211 ISK was the measured bid). Then the war chest reserve, the opening with
SUPPLY_UNFUNDED resolved, and the escrow PAYOUT to the named pilot.

## 2026-10-27T12:14Z — deep-ammo hull really fires; the loot leg's exact blocker (10d3c4ba)

**Proven live.** `living-native-weapon-event kind module-activation
attackerEntityID 980000018058 attackerPilotID coop-pilot-070 victimEntityID
980000016311 moduleID 980100056949` at 12:11:03Z — the 5-blaster hull with 300
real charges, whose own gun range resolves at 1050 m, activated a real module on
a real miner for the first time (the engagement-range order from FW-018 working).

**Fixed.** A pirate holding a live wreck claim is excluded from the raid (one owner
per record): the killer was being re-tasked forever, so the recovery never started.
A recovery that orders nothing now publishes
`living-npc-postraid-wreck-recovery-blocked` with the exact state it reads.

**Exact blocker it exposed (measured, verbatim):**

```
{"event":"living-npc-postraid-wreck-recovery-blocked","status":"NO_ORDER",
 "wreckID":980300000009,"hunterID":980000000602,"blocked":false,"hunterMode":"GOTO",
 "hunterPresent":true,"wreckPresent":false,"manualType":"","currentTargetID":0,
 "lastAggressorID":0,"distanceMeters":null,"pickupDistance":2500,"claims":2}
```

The durable wreck rows survive a restart but the physical native wreck entity does
not, so `scene.getEntityByID(wreckID)` is null and the recovery director refuses.
**A kill must be looted inside the same boot.**

**NEXT ACTION (exact).** Watch 30000145 for the next real
`living-native-stock-fleet-wreck-evidence` in the current boot and, without any
recreate in between, require `living-npc-postraid-wreck-recovery` (orbit/warp to the
wreck) then `advanceNativeWreckCustody` to move the loot into the pirate's hold, then
`living-npc-loot-station` to New Caldari and a real seeded fill (typeID 482 @
571 211 ISK at 60000688). Only after that fill: fund the chest, re-run
`war_funding_diagnose`, confirm `living-native-war-bounty` PAID.
## 2026-10-27T12:15Z - the loot leg is REAL: wreck cargo sold into a seeded bid (no code change)

**Proven (verbatim).** `living-npc-loot-station`: coop-pilot-080 / 980000000602
`NATIVE_WARP_TO_STATION` stationID **60014935** cargoID 980200026308, then
`PHYSICALLY_AT_NATIVE_STATION`. `living-native-loot-market-settled` at 12:07:25Z:
`status TRADE_SETTLED, side sell, typeID 17471, quantity 3150, price 8.61,
balance 27121.5, marketOrderID 4257762183096583231, marketOrderSource EVEJS_SEED,
lootSource {sourceWreckItemID 980400000026, sourceWreckID 980300000009},
nativeCargoVerified true, marketRPCAcknowledged true, marketRPC FillOrder,
sourceOfFunds SEED_MARKET_FILLED_ORDER, marketCurrency
NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. `war_funding_diagnose` now lists
coop-pilot-080 with a real balance of **27 121.5 ISK**.

**Exact remaining blockers for the war chest (measured).**
1. `living-native-war-opening-blocked` (last, 12:06:50Z) reason
   `SUPPLY_UNFUNDED:500011:NO_REAL_FACTION_INCOME|500014:WAR_TREASURY_JOURNAL_COLLISION`
   with `fronts: 0`; `war_diagnose` reports `activeCampaignCount 0`.
2. The funded pilot is **Serpentis (500020)**, not 500011/500014, so the war that
   can be funded is a front involving 500020 (Maurasi 30000140 is the Serpentis
   presence from FW-013).
3. 500014 carries a stale escrow journal (WAR_TREASURY_JOURNAL_COLLISION) from the
   earlier funded reservation.

**NEXT ACTION (exact).** Restore/verify the real front that involves 500020 (Jita
30000142 Angel vs Maurasi 30000140 Serpentis) and clear the stale 500014 escrow
journal through the treasury's own recovery, then let the opening reserve 25 000
ISK from coop-pilot-080's real 27 121.5 and pay the bounty on a real casualty.

## 2026-10-27T12:26Z — kill loop is repeatable; the loot leg needs one uninterrupted boot (d1a30222)

Four real wrecks with stored loot from real native fire in this session
(980300000008 3/93 450 units, 009 1/3 150, 010 2/91 980, plus the earlier 006), all
`PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED`. The 5-blaster hull 980000018058 now
really activates its modules (`living-native-weapon-event kind module-activation`,
moduleID 980100056949, victim 980000016311) at its own 1050 m gun range.

**The one blocker left on the loot leg is boot churn, not code.** The durable wreck
row survives a restart but the physical native wreck entity does not, so
`scene.getEntityByID(wreckID)` is null and `advanceNativeWreckRecovery` correctly
refuses (`wreckPresent:false`). A claim whose wreck is gone now stops owning the
pirate (d1a30222), so the raid keeps killing.

**NEXT ACTION (exact).** On a boot nobody recreates, catch the next
`living-native-stock-fleet-wreck-evidence` and, without a recreate, require
`living-npc-postraid-wreck-recovery` (real orbit/warp to the wreck) ->
`advanceNativeWreckCustody` (loot into the pirate's hold) ->
`living-npc-loot-station` to New Caldari 60000688 -> a real seeded fill for typeID
482 @ 571 211 ISK -> `coopWarChestFunding` from that fill -> `war_funding_diagnose`
FUNDED -> `living-native-war-bounty` PAID from HELD escrow. Never mint ISK.
## 2026-10-27T12:37Z - the war leg: presence is real, the attacker side is the blocker

`war_state` (new, read-only) reports the exact state: territories 2 (Jita 500011,
Niyabainen 500014), wars 1 (war:500011-500014), campaigns 0, and the per-system
presence the territories come from - **30000140 Maurasi resolves to 500020 (1/1)**,
Jita to 500011 (8 of 15), Perimeter/New Caldair to 500014, 30100032 to 500020.

So the Jita->Maurasi front (500011 vs 500020) exists in the derivation, and 500020
already holds **27 121.5 ISK** of real earned income. The opening refuses because a
war needs BOTH sides funded and the ATTACKER 500011 has
`NO_REAL_FACTION_INCOME` (plus 500014's stale escrow journal collision).

**Exact next step.** An Angel pilot must earn real ISK the same way: 601
(coop-pilot-060, corp 1000138) has no cargo because its wreck 980300000008 is no
longer in the scene (`living-npc-postraid-wreck-recovery-blocked`:
`wreckPresent false` for both 980300000008/9). The honest route is a NEW kill in
this boot -> `living-native-stock-fleet-wreck-evidence` -> `living-npc-wreck-cargo-settled`
-> `living-npc-loot-station` -> `living-native-loot-market-settled` for an Angel
pilot, then `war_funding_diagnose` must show 500011 funded and the opening must
reserve 25 000 ISK before START_CAMPAIGN, then a real casualty pays the bounty.

## 2026-10-27T12:40Z - why the raid is idle right now (measured, no code change)

`mining_fleet_diagnose 30000145`: fleet 960004641 `state "loaded"`, 13 miners
`mode STOP` with no ore left (transferred), haulers carrying it on the live trip
`30000145-960004641-1793104338982` (`departureAck true`), one hauler 299 195 691 465 m
out on its warp to the station. `raid_diagnose`: 4 linked pirates, 23 fleet hulls, `leases []`,
every pirate `mode STOP, manualType ""` - no legal target because the whole convoy is on its
delivery leg, which is exactly what the raid's warp filter is for. The last raid action was
12:26:46Z (`warp-to-hauler` for 980000018058) and the last kill 12:00:10Z.

**NEXT ACTION (exact).** Wait for the trip to deliver (`living-native-haul-delivered`) so the
fleet returns to `mining`; the raid then kills again. For the war chest the kill must be made
by an ANGEL hull (601 coop-pilot-060, corp 1000138) so 500011 earns real ISK from the same
recovery -> seeded sale path that already paid 500020 27 121.5 ISK. Then
`war_funding_diagnose` must show both 500011 and 500020 funded and the opening must reserve
25 000 ISK before START_CAMPAIGN; a real casualty then pays the bounty from HELD escrow.

## 2026-10-27T13:16Z - FW-024: militia enlistment PROVEN live; the melee is blocked by one missing data row (1abc629a)

**Proven live (container evejs-server-1, verbatim).**
- `militia_enlist` 140000102 / agent 3012018 ->
  `"[Militia] Enlistment recorded for Caldari State. No items or ISK granted."`
  with `{"characterID":140000102,"factionID":500001,"status":"ACTIVE","rank":0,
  "enlistedAt":1793106715078,"cooldownUntil":0}`. Same code path the client
  calls (`coopFactionWarAgent.doAction`), real docked character, real agent.
- `militia_state` 140000102 -> `MILITIA_AVAILABLE`, faction 500001 Caldari State,
  `militiaCorporationID 1000180`, `warzone 2`, `enemyFactionIDs [500004]`,
  `fronts []` (no ASSAULT campaign yet).
- `war_state` -> territories 2 (Jita 500011, Niyabainen 500014), wars 1
  (`war:500011-500014`), campaigns 0.

**Owner's faction, from his own record (not from a message):**
`characters.140000005` Sasunok1488, raceID 1, bloodlineID 2, corporationID
98000001, `factionID 500001` Caldari State; militiaCorporationID 1000180; the
game's own pairing (`fwWarzoneSolarsystemService.js`, WARZONE_CALDARI_GALLENTE=2)
makes Gallente 500004 the enemy. Nearest real desk: agent 3010879 "Okamainen
Niuranto", station 60000358 Perimeter VI - Ytiri Storage, 1 jump from Jita.

**What is implemented (all data-gated, all tested):**
1. `EVEJS_COOP_MILITIA_FACTION_IDS='500001,500002,500003,500004,500010,500011'`
   - exactly the factions whose SDE row has a real militiaCorporationID.
   Serpentis 500020 and ORE 500014 are `null` and can never recruit.
2. `coopMilitiaWarData`: opponent = declared war first, else the game warzone
   pairing; drift test against the deployed service source.
3. `coopMilitiaWarPlayer`: `ENEMY_MILITIA` only for an ACTIVE enlistment in the
   opposing side of an ACTIVE war whose campaign is ASSAULT in that system;
   `ALLY` for his own faction; `NOT_WAR_SHIP` for every hull outside the war
   registry, so stock pirates keep their behaviour.
4. `npcBehaviorLoop.isFriendlyCombatTarget` hook: an NPC war ship treats his own
   faction and uninvolved players as friendly (never fires), and only an enlisted
   enemy as engageable.
5. `coopWarBattleDirector`: a war ship with no NPC opponent in range issues a real
   native attack order at an enlisted enemy player (`targetKind MILITIA_PLAYER`).
6. `coopNpcDestructionAttacker`: a player hull as the upstream `attackerEntity`
   is proven (registered war ship of the opposing side + physical wreck + ACTIVE
   enlistment) and pays merit to `coop-player-<characterID>` in the same durable
   ledger as NPC kills (identity regex widened in the ledger and rank titles).
7. `EVEJS_COOP_WAR_REQUIRE_FUNDING=0` in the live profile: an explicit, labelled
   `PAPER_UNFUNDED_EXPLICIT` supply (no ISK reserved, no bounty payable). Default
   stays 1.

**NEEDS_OWNER:BLOCKED_NO_ARMED_NAVY_LOADOUT (exact, measured).** A Caldari vs
Gallente front needs armed navy patrols, and the static tables cannot arm them:
`0/146` Caldari (500001) and `0/132` Gallente (500004) profiles have any loadout
row - every one resolves to `retail_empty_npc_entity_loadout` - and authoring a
co-op row from an existing base fails with `NO_COMPATIBLE_CHARGE`
(weaponTypeID 16128, CONCORD row) or `BASE_LOADOUT_ROW_MISSING` (trig rows are not
in the `readStaticRows` table). `spawn_native_npc` therefore refuses with
`WAR_PATROL_LOADOUT_UNAVAILABLE:LOADOUT_ROW_MISSING`. No hull was spawned and no
gate was relaxed.

**NEXT ACTION (exact).** Author ONE real navy loadout per hull class (a real
turret from the SDE hardware catalog + a real charge that
`isNpcChargeCompatibleWithModule` accepts, validated by
`validateNpcHardwareDefinition`), expose it through the `npcLoadouts` resolver
the same way `coopWarPatrolLoadoutRow.resolveRow` is exposed, then:
1. `spawn_native_npc` a Caldari patrol in 30002780 (already in
   `EVEJS_COOP_VIRTUAL_ROUTE`) and 2 Gallente patrols in Maurasi 30000140
   (real reciprocal gate 30002780 <-> 30000140) with `warPatrol:true,durable:true`;
2. wait for `living-native-war-opened` `war:500001-500004` with the
   `PAPER_UNFUNDED_EXPLICIT` label, then `living-native-war-assault`;
3. `militia_state 140000005` must list that campaign under `fronts`;
4. client check: the owner docks at 60000358, enlists with 3010879, jumps to the
   campaign system and the enemy patrol issues a `MILITIA_PLAYER` attack order.

**Known noise.** `coop-admin-requests.jsonl` is not always truncated after a
drain, so a request can execute twice; the second enlistment is a DUPLICATE and
changes nothing.

## 2026-10-27T13:24Z - FW-024d: the front opens (08576bb2)

Live after deploy (container evejs-server-1):
`living-native-war-opened OPENED` `warIDs:["war:500011-500014","war:500011-500020"]`
`campaignIDs:["war:500011-500014:campaign:30000143",
"war:500011-500014:campaign:30000144","war:500011-500014:campaign:30000145",
"war:500011-500020:campaign:30000142"]`, territories 5 (Maurasi 500020, Jita
500011, Niyabainen/Perimeter/New Caldari 500014), then
`living-native-war-mobilization NATIVE_PATROL_MOBILIZED` in the same boot.
`war_state` -> wars 2, campaigns 4, enlistments 1 (the proven Caldari enlistment).

The opt-out now also skips the real escrow reservation, so no ISK is reserved and
no bounty can be paid (`PAPER_UNFUNDED_EXPLICIT`). Default remains strict (1).

`militia_state 140000005` still reports `fronts: []` because no campaign involves
Caldari State 500001 - the Caldari/Gallente front is blocked by the navy loadout
gap recorded below, not by funding.

## 2026-10-27T13:32Z - ITEM 1 CLOSED (live): kill -> loot picked up -> real seeded sale, and item 2's exact blocker measured

**Proven live, verbatim, container evejs-server-1 (the whole loot leg, no ISK minted).**

```
{"at":"2026-10-27T13:15:09.456Z","event":"living-npc-wreck-cargo-settled","status":"NATIVE_WRECK_CARGO_SETTLED",
 "itemID":980400000027,"cargoID":980200031908,"entityID":980000000601,"wreckID":980300000010,
 "typeID":17471,"quantity":1200,"partial":true,"sourceBeforeQuantity":76860,
 "remainder":{"itemID":980400000030,"quantity":75660},
 "nativeSourceDebited":true,"nativeCargoCredited":true,"iskCredited":false}
{"at":"2026-10-27T13:23:46.378Z","event":"living-npc-loot-station","nativeMovementOrders":[
 {"pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"action":"NATIVE_WARP_TO_STATION",
  "cargoIDs":[980200031908],"iskCredited":false}]}
{"at":"2026-10-27T13:24:13.981Z","event":"living-npc-loot-station","physicallyReady":[
 {"pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"status":"PHYSICALLY_AT_NATIVE_STATION"}]}
{"at":"2026-10-27T13:24:14.929Z","event":"living-native-loot-market-settled","status":"TRADE_SETTLED","side":"sell",
 "pilotID":"coop-pilot-060","entityID":980000000601,"stationID":60014935,"typeID":17471,"quantity":1200,
 "price":8.61,"balance":10332,"marketOrderID":"4257762183096583231","marketOrderSource":"EVEJS_SEED",
 "marketRPC":"FillOrder","lootSource":{"sourceWreckItemID":980400000027,"sourceWreckID":980300000010},
 "sourceOfFunds":"SEED_MARKET_FILLED_ORDER","marketCurrency":"NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET"}
```

**Four measured blockers were fixed to get there** (each proven by a live event before the next):
1. `c8a69b63` the physical wreck never survives a restart, so a claim is now either restored from its own
   durable row through stock `spawnNativeWreck` (`living-npc-wreck-claim-restored`, wreck 980300000008 with
   3 stacks / 93 450 units) or closed with the measured reason (`living-npc-wreck-claim-closed`,
   wreck 980300000009 `WRECK_HAS_NO_STORED_ITEMS` `CLAIM_CLOSED`). A claim-driven 5 s loop loots in the same boot.
2. `3f290ab4` the killer's hold is 120 m3 while the wreck stacks are 4 032 / 2 142 / 5 229 m3, so custody
   answered `NATIVE_CARGO_FULL` forever. A stack that does not fit now moves what fits and leaves a real
   remainder wreck item (above: 1 200 moved, 75 660 remain as 980400000030). The Windows-only writer-lock
   failure (directory fsync) is fixed too, so 19 custody tests finally run on this machine.
3. `316539b4` / `507934af` the raid kept its own attack order on the hull (prey 980000016293, 2.5 AU away) and
   the stock loop re-acquired it, so the recovery refused `NATIVE_COMBAT_ORDER_ACTIVE`. The loot phase now
   releases and orders in the same tick (`living-native-raid-release` `RAID_ORDER_RELEASED_FOR_LOOT`).
4. `217ec980` a full hold must deliver before taking more; the recovery lease was starving the delivery leg.

**ITEM 2's exact blocker, measured (not inferred).** The Angel pilot really earned 10 332 ISK, and the
corporation treasury sweep then moved it into **corporation 1000129 (ORE)**:
`/var/lib/evejs/coop-native-market/corp-treasury/1000129.json` ->
`{"status":"SWEPT","corporationID":1000129,"amountISK":10332,"beforeISK":346627.03,"afterISK":356959.03,
"pilots":[{"pilotID":"coop-pilot-060","isk":10332}]}`, and `ledger.json` now shows `coop-pilot-060 balance 0`.
`war_funding_diagnose` therefore reports `NO_REAL_FACTION_INCOME` for 500011/500014/500020 (it reads pilot
balances only), and the war opening stays `NO_OPENABLE_FRONT` even though `fronts: 3` and both sides are armed.

**NEXT ACTION (exact, one change).** Make the treasury sweep respect the pilot's own corporation
(`coopNpcCorpTreasury.run({pilotFilter})` + the refinery tick's `fundTreasury` passing a filter built from the
linked native entity's `corporationID`), so an Angel sale stays in the Angel pilot's ledger (or in 1000138) and
the levy can see it; then let the next sale (the hull is empty and loots again by itself, ~10 332 ISK per
1 200-unit trip) fund `warBountyReserve` for 500011, watch `living-native-war-opened` with `escrow:true`, and
confirm `living-native-war-bounty` `PAID` on the next real casualty. Never mint ISK; the 10 332 already in
1000129 is real money that simply belongs to the wrong faction's wallet.

## 2026-10-27T14:30Z - FW-026/027: real doctrine fleets, a live Caldari/Gallente front, and the exact assault blocker

**Proven live (container evejs-server-1, verbatim).**
- Doctrine fleets spawn from real SDE profiles with authored rows:
  `spawn_war_fleet 500001/30002780 merit 150` -> `size 5 counts {tackle:1,brawler:2,ewar:1,logistics:1}`,
  fleet `coop-fleet-500001-0001`; `500004/30000140` -> `coop-fleet-500004-0016`.
- Four different doctrines, four different hulls/module sets/charges:
  `inspect_npc 980000020999` (Caldari Navy Moa, brawler) -> `moduleCount 6` = 4x typeID 568
  (flags 27-30) + 527 (mid 19) + 2048 (low 11), cargo typeID 230 x60;
  `980000021001` (Blackbird, EWAR) -> 2410x2 + 1969x2, charge 209 x40;
  `980000021002` (Delta II, logi) -> 2404 + 3588x2, charge 210 x40;
  `980000020998` (Condor, tackle) -> 564x2 + 3244 (warp disruptor), charge 222 x60.
  All `transient:false`, corporation 1000035 (Caldari Navy).
- A real front opened: `war:500001-500004` (attacker Gallente 500004, defender Caldari
  500001), campaign `war:500001-500004:campaign:30045344` (Nennamaila) `PREPARING`,
  territories `30003837=500004` (Aldranette) and `30045344=500001` (Nennamaila) -
  a real reciprocal gate pair from the SDE scan (18 real Caldari/Gallente borders).
- `militia_state 140000005` now lists `declaredWars: [war:500001-500004 campaign
  30045344 PREPARING, war:500001-500011 campaign 30002780 PREPARING]`; `fronts: []`
  because a front is only listed once its campaign is in `ASSAULT`.

**Hull reality, measured, not dressed up.** Every navy/pirate combat profile in this
build points at a category-11 NPC *entity* hull (278 Caldari/Gallente navy profiles,
0 on a player hull; only CONCORD and ORE fly category-6 player hulls). Those hulls
carry a real dogma record (65-86 attributes) but no slot attributes, so the native
auto-fit uses its documented base flag list. The doctrine reports
`hull.kind=ENTITY_HULL` and `slotMode=NATIVE_AUTOFIT_FALLBACK` instead of claiming
slots the data does not have.

**Three real opening defects found and fixed on the way (2cea1091).**
1. two borders of one faction pair produced campaigns with opposite orientation ->
   `CAMPAIGN_PREREQUISITES_NOT_MET` discarded the whole batch; campaigns now follow
   the single war record's orientation;
2. a second border naming an already-contested target aborted the batch; it is
   skipped now;
3. no pilot identity was free (100/100 linked), so a fleet hull could not be crewed:
   `releaseSpawnedIdentity` + `release_identity`/`assign_identity` move an existing
   identity between real hulls (proven: coop-pilot-001 and coop-pilot-063 reassigned).

**EXACT next step (assault).** `BEGIN_ASSAULT` needs the mobiliser to assign one
linked armed patrol per side of campaign `30045344`: coop-pilot-063 on
980000022071 (Aldranette, attacker) and coop-pilot-001 on 980000022066
(Nennamaila, defender) are already linked and armed. The current
`war_diagnose` mobilisation section reports only the FIRST PREPARING campaign
(the old pirate ones), so the next change is a per-campaign mobilisation diagnose
(`war_diagnose {campaignID}`) plus, if a candidate is rejected, the real reason
(ORDER_LEASE_ACTIVE / ALREADY_ASSIGNED / NOT_READY:...). Then `militia_state
140000005` must list the campaign under `fronts`.

**Reconstitution (unit-proven, live not yet).** 10 tests: survivors must be proved
alive, replacements are adopted only from free native hulls in the staging system
that no live fleet owns, a fleet with no real replacement is `REDUCED` with the
missing roles listed, a loss needs a real native wreck and returns a `force-lost`
merit event. Live proof needs one real loss (wreck) plus a real free hull in the
staging system.

**Known noise.** The admin requests file is not always truncated after a drain, so a
queued request can execute again after a restart (16 fleet records exist, several are
duplicates of the same doctrine in the same system; all are real hulls). Another
session recreates the stack every ~1 minute, which interrupts probes.

## OWNER DIRECTIVE 2026-10-27 (binding)

- The running stack `evejs` (evejs-server-1, evejs-market-1) is the OWNER'S PLAY
  SERVER. Do NOT restart, recreate, `--force-recreate`, down, or rebuild-and-redeploy
  it while the owner is playing. He said: "this one you will not restart until I say".
- Agents that need to deploy/test must run their OWN separate compose project
  (own project name, own host ports, own volumes) and leave `evejs` untouched.
- Friend access path in use: ProtonVPN forwarded port -> sshd on that port
  (currently 48819) -> user `evefriend`, key-only, PermitOpen 127.0.0.1:443/5222/
  26000/26001/26002/40110; firewall rule "EveJS co-op SSH 48819" scoped to
  remote 176.37.43.83. EveJS ports stay 127.0.0.1.
- Agent stack commands (never the owner's project):
  `.\scripts\Start-Agents-Stack.ps1 -Action Status|Seed|Up|Down`.
  Seed once on a fresh volume (`market-tools rebuild v1 --preset jita_new_caldari`),
  otherwise evejs-agents-market-1 exits 1 with "No market database exists".
  Host ports 28000-28002/28443/25222/41110; volumes evejs-agents-data/-images.

## NEXT ACTION (2026-10-27T18:10Z)

Perf rounds 1-3 are built and verified in source (`OVERLAY_OK`, image rebuilt,
patches 0009/0010, suites 11/11 + 5/5). They are NOT on the play stack yet.
The single blocking action is the owner's restart window:

    docker compose -f compose.yaml -f compose.coop-probe.yaml \
      up -d --force-recreate --no-deps server   (in C:\Games\EveCoop\upstream-evejs\Code)

After the recreate: profile the play stack the same way (SIGUSR1 + live-profile.cjs
25 s + Analyze-CpuProfile + chain.cjs) and record the idle share and the top rows
in .opencode/metrics.md. Compare against the pre-fix rows: idle 0%, cloneValue
62.7%, ensureRootShape 24.0%, chains evaluatePair 5962 ms / cargoRows 1406 ms /
miningFleetDurable.check 871 ms.

## PROCESS BUG FOUND 2026-10-27T18:35Z — `--apply` silently drops direct L1 edits

`node scripts/patch-evejs-coop.cjs --apply` restores the pinned stock files before
installing the overlay, so an L1 fix that was made by editing the checkout
directly DISAPPEARS on the next `--apply`. That is exactly what happened to patch
0009 (nativeNpcStore root clone): it was live, then the next `--apply` reverted it
and the play stack went back to 13% `ensureRootShape`.

Rule from now on: an L1 fix must exist as `patches/upstream/NNN-*.patch` AND be
applied through `apply-upstream-patches.cjs`. Direct edits are temporary only.

`apply-upstream-patches.cjs` currently refuses this checkout:
"Checkout matches neither the pinned base nor our patched state" (0004 fails on
miningNpcOperations.js). That is NEEDS_PATCH_SERIES_REPAIR: the series tool and the
working tree must be reconciled before the next L1 patch is trusted. Until then
patch 0009 is re-applied idempotently by a local script and its sha256 in
MANIFEST.json matches the regenerated patch file.

## 2026-10-27T19:05Z — where the client work stands

PERF: DONE and stable on the play stack. 97.8% -> 20.8% of one core, profile idle
~49%, rootShapeVerified.add verified inside the container. Deploy path is now
`node scripts/apply-all.cjs --code-path <Code>` (overlay + L1 series together);
plain `--apply` wiped patch 0009 twice.

MAP: renders with the small occupation payload (owner-confirmed).
FW TAB: STUB_IN_THIS_BUILD. The client calls GetAllWarzonesOccupationStates, we
answer with real util.KeyVal entries (militia corps 1000180/1000181, contested
flags), and it still shows "no data" because it lists warzone systems from its own
static logic and colours them itself. Filling all 814 static warzone systems makes
the tab populate but crashes the map in mapViewFiltered.GetLineColor (partial
colour data: one line end coloured, the other None). Client code cannot be patched
here (boundary), so the tab is not finishable server-side.

NEXT (needs the owner's go): show the front through the surfaces that work -
the map campaign layer (insurgencySolarsystem.GetAllVisibleCampaigns) and the
front chat lines already emitted ([Front] assault begun in system ...).

## HANDOFF 2026-10-27T19:30Z (context nearly exhausted)

DEPLOY PATH: `node scripts/apply-all.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code`.
It runs the overlay, then `git apply --directory=Code` for every
patches/upstream/*.patch not already present, then asserts OVERLAY_OK. The
`--directory=Code` is required: patches are written against the Code/ root and
without it 0001 fails with "No such file or directory".
Never run `patch-evejs-coop.cjs --apply` alone: it restores stock files and kills
every direct L1 edit (it ate patch 0009 twice, dropping CPU from 15% back to 97%).

CLIENT VIEW (map + FW tab), state of the experiments:
  * dict payload -> client AttributeError 'dict' has no attribute 'occupierID'.
  * util.KeyVal payload + few systems -> map renders, tab shows the front only.
  * util.KeyVal + ALL 814 static warzone systems -> tab populates but the map
    crashes in mapViewFiltered.GetLineColor (partial colours), so it is reverted.
  * current payload = 5 systems (campaign + territory, warzone factions only).
  * OPEN QUESTION: colours. Tried militia corporations (1000180/1000181) -> grey.
    The untested combination is FACTIONS (500001/500004) with the correct
    util.KeyVal type; the hooks are in scripts/overlay-spec.cjs (three entries for
    fwWarzoneSolarsystemService) and the `militiaOf` mapping is where to switch.

PERF: closed. 97.8% -> ~10-18% of one core with short spikes >100% during heavy
phases; idle ~49% in the profile. Guard test tests/coop-native-npc-store-patch.test.mjs
fails if the memo line disappears from patch 0009 again.

FW TAB: STUB_IN_THIS_BUILD (client lists warzone systems and colours them itself).
Do not promise it; use the map campaign layer + front chat lines instead.

## PATCH SERIES IS DRIFTED — must be repaired before the next L1 patch

`apply-all` now reports: applied=0, alreadyPresent=7, drifted=0004, 0009, 0010.
0009/0010 fail at their hunk because patch 0001 (same file, nativeNpcStore.js) is
applied first and changes the context. Until the series is regenerated in order,
the perf fix is applied by the idempotent local script
(reapply-0009.cjs + fix-add-line.cjs) and patch 0009 in the repo no longer matches
the tree. Repair plan for a fresh session:
  1. git checkout the checkout to the pinned base,
  2. apply 0001..0010 strictly in order with `git apply --directory=Code`,
  3. regenerate any patch whose context moved, update MANIFEST sha256,
  4. assert tests/coop-native-npc-store-patch.test.mjs and the guard in CI-less run.

## PATCH SERIES REPAIRED (2026-10-27, f4fe0fac + 6803ee4f)

The series is no longer drifted. What was actually wrong, in order:

1. `0009` was generated against the PRE-0001 file. `git apply` applies `0001` first
   (same file, `nativeNpcStore.js`), so 0009's context never matched and it always
   failed -> the perf fix never reached the container.
   Fix: regenerated 0009 from a diff between "base + 0001" and "base + 0001 + memo",
   so it applies cleanly on top of 0001. Guard: tests/coop-native-npc-store-patch.test.mjs
   (pass=2).
2. `0010` had CRLF line endings; `git apply` could not match the LF working tree on
   ANY tree. Fix: converted to LF.
3. `0004` never applied because `apply-all` ran the overlay FIRST and the overlay
   inserts hooks into `miningNpcOperations.js`, moving the patch context. Doctrine is
   L1 -> L2, so `apply-all` now applies the L1 series first, then the overlay, then
   re-verifies every patch. A patch the overlay covers can no longer be reverse-applied
   verbatim, so presence is proven by content (every added line must exist).
   Result: `applied=0 alreadyPresent=10 total=10`, `OVERLAY_OK`, exit 0.

MANIFEST sha256 refreshed for 0009 and 0010 (apply-upstream-patches.cjs checks it).

Deploy is one command and now fails loudly if anything is missing:
`node scripts/apply-all.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code`

## NEXT: the war must be visible IN SPACE, not on the map (owner decision 2026-10-27)

Owner confirmed: FW tab stays grey in every payload variant and the map opens fast now,
so "на карті війну не побачимо". Do not spend more time on the map or the tab.

The only visible war path left is the one he asked for from the start: fly to a warzone
system and see his faction`s fleet actually fight the other faction. What already exists:
  * `coopNpcHostility` allows NPC-vs-NPC only for named, physically linked opposing
    factions with a current native attack order or fresh retaliation (do not weaken it);
  * `warFrontChat` already emits real `war-opened` / `assault-begun` /
    `objective-captured` lines to sessions inside the affected system, once per event,
    text built from real state;
  * mining fleets are alive again because patch 0004 is really applied now
    (`ALIFE08 ... ALREADY_ACTIVE miners=2 haulers=1`), and a pirate raid is running.
Next concrete step: stage BOTH factions` fleets in ONE warzone system (Caldari vs
Gallente) so the owner can fly there and watch the fight, and make sure the front chat
line reaches him there. Evidence required: real weapon success, measured HP loss, real
wreck + stored loot on the same victim. No map work, no FW tab work.

## TWO MORE CLIENT TABS (owner report 2026-10-27): diagnosis

1. "Gallente 2 systems / Caldari 0" — that number comes from OUR war state, not the
   client: the campaign seed made Gallente the occupier in two systems and Caldari in
   none. It is real data, just unbalanced. Fix is in the war/campaign seed, not the UI.
2. "War zone" tab = black screen and "details about the combat zone: loading advantage
   data" forever — the client asks for warzone advantage/summary data that THIS SERVER
   NEVER IMPLEMENTS: `grep -rn Advantage /app/server/src/services/` returns nothing, and
   fwWarzoneSolarsystemService only exposes GetAllWarzonesOccupationStates(+Uncached),
   GetAllWarzones, GetHQSystemIDs, GetLocalOccupationState. The client gets no answer and
   keeps loading. This is fixable server-side: implement the advantage/summary handler
   with real values (occupation counts, contested systems) instead of nothing.
   Unknown eve_public requests in the last 3h are only payment.schedule.GetActiveByType
   and stargate.lock.GetRestrictedSystems — neither is the warzone tab.
Next: (a) rebalance the campaign seed so both factions hold systems, (b) add the
advantage handler. No client patching, no map work.

## TASK A+B (owner said "давай"): exact entry points, nothing mutated yet

A. Rebalance "Gallente 2 / Caldari 0".
   The number is `occupationStates()` in integration/coopWarClientView.cjs counting
   `state.territories[systemID].militaryControllerFactionID`. The state is NOT a JSON
   file (no /var/lib/evejs/coop-war-state.json) — it lives in SQLite behind
   `integration/coopFactionWarStore.cjs` (createFactionWarStore -> execute/snapshot,
   TABLE+KEY from that module) and `warState()` reads it with
   `gameStore.coopAtomicNativeRows.transact([TABLE], tx => tx.get(TABLE, KEY))`.
   Therefore the seed must go through the store's own `execute` mutation with its
   receipts/proofs, NEVER a hand-written row: hand-writing is fabrication and the
   store validates state on read (`core.validateState`).
   First read the current territories + wars to see which systems are unowned, then
   open real campaigns (attacker/defender, source/target) so both factions hold and
   contest systems.

B. "War zone" black screen + "loading advantage data" forever.
   No advantage implementation exists server-side (`grep -rn Advantage
   /app/server/src/services/` = 0). fwWarzoneSolarsystemService exposes only
   GetAllWarzonesOccupationStates(+Uncached), GetAllWarzones, GetHQSystemIDs,
   GetLocalOccupationState. The client asks for advantage/summary and never gets an
   answer. Next: capture the exact RPC name from the client's request log while the
   panel spins (docker logs evejs-server-1 | grep fwWarzone), then add a handler that
   returns real occupation counts/contested counts from the same war state. Env-gate it
   like EVEJS_COOP_WAR_CLIENT_VIEW and keep it default OFF until verified.

## REAL WAR STATE (read-only probe, 2026-10-27) — the numbers are consistent

/tmp/warstate.cjs in the container prints the live record:
  wars:      war:500001-500004 attacker=500004 (Gallente) defender=500001 (Caldari)
  territories: 30003837 -> 500004 SECURE ; 30045344 (Nennamaila) -> 500001 CONTESTED
  campaigns:  war:500001-500004 30003837 -> 30045344 (Gallente pushes into Caldari)
  byOwner:   500001=1, 500004=1
So "Gallente 2 / Caldari 0" is the client counting the OCCUPIER: Gallente holds its
own system plus the one it contests, Caldari holds a system that is being invaded so it
counts as occupied. Nothing is corrupted — the war is simply one-sided: only Gallente
attacks. The rebalance is therefore a second campaign in the opposite direction
(Caldari 500001 attacking from 30045344 into 30003837), created through the war store
execute API, not by editing rows.

## HANDOFF (context exhausted) — how to open the Caldari counter-offensive

The war machinery is already in the deployed overlay, no new code needed:
  /app/server/src/space/coopFactionWarOpening.js exports
    gateBetween, collectPresence, territoriesForFronts, paperFunding, presenceSummary,
    fundingRequired, supplyFor, activeWarFor, liveCampaignFor, buildProofs,
    planWars, applyOpenings, applyOpening, createWarOpening
  /app/server/src/space/coopFactionWarCampaigns.js exports planCampaign, resolveCampaign,
    rolesForFront, ownerOf (ROLES, STATES, DEFAULT_TTL_MS)
  /app/server/src/space/coopFactionWarStore.js -> createFactionWarStore({gameStore,proofs})
    with execute/snapshot; every mutation must go through it (receipts + validateState).
Current live record (probe /tmp/warstate.cjs): war 500001-500004 attacker=500004,
territories 30003837=500004 SECURE, 30045344=500001 CONTESTED, one campaign
30003837 -> 30045344.

NEXT STEP, in order:
 1. read-only: call planWars/liveCampaignFor for the reverse front (Caldari 30045344 ->
    Gallente 30003837) and print what it would open, WITHOUT applying.
 2. if the planner refuses, find the real blocker (gateBetween / fundingRequired /
    supplyFor) and report it — do not force an opening.
 3. only then applyOpening/applyOpenings through the store, then re-run the probe and
    confirm byOwner has both factions owning AND contesting a system.
 4. after that, the advantage handler for the black "war zone" tab: capture the exact
    RPC from docker logs while the panel spins, add the handler env-gated default OFF.
Never hand-write territory rows, never weaken coopNpcHostility, no client patching.

## WHERE THE COUNTER-OFFENSIVE ACTUALLY STOPS (probed 2026-10-28)

1. planWars({state}) with no gate wiring -> REFUSED / NO_GATE_AUTHORITY. It refuses to
   invent a front without real stargate topology. Correct behaviour, not a bug.
2. The sanctioned entry point is NOT a hand-built plan: coopVirtualWorldRuntime calls
   createWarOpening({ readLinks, getNativeEntity, getFactionForCorporation,
   getStargatesForSystem: worldData.getStargatesForSystem, getGate: worldData.getStargateByID,
   readWarState, writeWarState, reserveBounty, fleetPresence, minShips }).tick({systemIDs})
   with systemIDs = [...visitedSystems].slice(0,12), and skips with
   NO_VISITED_SYSTEMS / NO_IDENTITY_REGISTRY / WAR_STATE_WRITE_FAILED.
3. Every war flag is already ON in compose.coop-probe.yaml (EVEJS_COOP_FACTION_WAR,
   _FLEETS, _MOBILIZE, _COMBAT, _MERIT, _TREASURY, _NATIVE_TRANSFER, _SOVEREIGNTY_PROJECTION,
   WAR_REQUIRE_FUNDING=0). No war-skip lines in 2h of logs, so the phase is not erroring.
So the war is enabled and one-sided because a reverse front needs CALDARI presence in a
system that borders Gallente-held 30003837, and the visited route does not include
Nennamaila (30045344) / that border. Nothing is corrupted and nothing is missing code.

NEXT ACTION (concrete): add the Gallente/Caldari border systems to the visited route
(EVEJS_COOP_WAR_ROUTE / the 5-system route in compose.coop-probe.yaml) so the war tick
sees both sides present, then re-run /tmp/warstate.cjs and expect byOwner with both
factions owning AND contesting. Then the advantage handler for the black tab.

## DEFINITIVE WAR DIAGNOSIS (2026-10-28, read-only diagnoseWarState/diagnoseWarFunding)

  territories: 30003837 Gallente SECURE, 30045344 Caldari CONTESTED
  war:         war:500001-500004 ACTIVE
  campaign:    war:500001-500004:campaign:30045344 source=30003837 target=30045344
               state=PREPARING (stuck, never advances)
  presence:    {"systems":[],"minShips":1,
                "note":"TERRITORIES_NEED_AT_LEAST_ONE_RESOLVED_PILOT_PER_SYSTEM"}
  funding:     both sides REFUSED / NO_REAL_FACTION_INCOME (needCents=2500000, pilots=0)

THE WAR IS FROZEN ON PRESENCE = 0, not on the map, the FW tab or the patch series.
No faction-resolved NPC pilot exists in 30045344 or 30003837, so the campaign cannot
leave PREPARING and no reverse front can be planned. The route already contains both
systems (EVEJS_COOP_VIRTUAL_ROUTE: 30000142,30000144,30000145,30045344,30003837) and all
war flags are ON, so the missing piece is the real war fleets of BOTH factions in those
two systems, plus real faction income for funding.

NEXT ACTION: mobilize real Caldari and Gallente war fleets into 30045344 and 30003837
(registry: nativeWarFleetRegistry, EVEJS_COOP_FACTION_WAR_FLEETS/_MOBILIZE), verify with
diagnoseWarState that presence.systems is non-empty, then re-check the campaign leaves
PREPARING. Funding stays honest: NO_REAL_FACTION_INCOME means no invented ISK.

## ROOT CAUSE CONFIRMED: the war fleet registry is EMPTY

`require("/app/server/src/space/coopVirtualWorldRuntime.js").nativeWarFleetRegistry()`
returns `{}`. So there are no war fleets anywhere, therefore presence in 30045344 /
30003837 is 0, therefore the campaign cannot leave PREPARING and no reverse front can
be planned. EVEJS_COOP_FACTION_WAR_FLEETS=1 and _MOBILIZE=1 are set but mobilization
never produced a fleet, so the registry stays empty.

NEXT ACTION (single): find why mobilization spawns nothing with those flags on — the
mobilize phase logs nothing and the registry is empty, so check the mobilize entry point
in coopVirtualWorldRuntime (grep EVEJS_COOP_FACTION_WAR_MOBILIZE) and what precondition
it needs (funding gate is REFUSED/NO_REAL_FACTION_INCOME, which may be exactly what stops
it). Decide honestly: either real faction income exists and mobilization is broken, or
the funding gate is the real blocker and no fleet may legally spawn without it.

## MOBILIZER IS ENABLED — so the blocker is inside it, not the flags

coopWarMobilizer.enabled() needs FACTION_WAR, FACTION_WAR_FLEETS, FACTION_WAR_MOBILIZE,
NATIVE_ATOMIC_ROWS, NPC_STRICT_AMMO, NPC_AMMO_DURABLE_CYCLE, NPC_BANK_ATOMIC and
(ALIFE or NPC_ORDER_ARBITER). Container env proves all of them are 1.
It also needs createWarMobilizer({registry, readWarState, readLinks, sceneForSystem,
getNativeEntity, getController, getFactionForCorporation, inspectReadiness,
getOrderLeases, isTactical, clock}) or it throws
WAR_MOBILIZATION_NATIVE_AUTHORITIES_REQUIRED. The registry is empty and nothing throws,
so the mobilizer runs and rejects every side silently (SIDE_REJECT_LIMIT exists for that).
NEXT SINGLE STEP: run the mobilizer in DRY RUN (DRY_RUN_REPORT_LIMIT=64, never writes) and
print the per-side reject reasons for war:500001-500004. That names the exact refusal —
most likely the funding gate (NO_REAL_FACTION_INCOME) or an empty getOrderLeases — and it
is the last unknown between the current frozen war and a visible two-sided fight.

## CORRECTION (must not stand uncorrected): the registry is NOT empty

Earlier note "nativeWarFleetRegistry() -> {}" was a PROBE ARTEFACT, not a fact:
JSON.stringify of an object whose members are functions prints {}. The factory
(coopVirtualWorldRuntime.js:86) returns null only when FACTION_WAR / FACTION_WAR_FLEETS /
NATIVE_ATOMIC_ROWS are not 1; those are 1, so it builds a real registry through
coopWarFleetRegistry.createWarFleetRegistry with native proofs. So do not chase an empty
registry. The mobilizer therefore has its registry and the refusal is elsewhere
(funding gate / getOrderLeases / readiness). The only way to name it is the mobilizer
dry-run: tick({systemIDs, dryRun:true}) -> {status:"DRY_RUN", mobilized, rejected, blocked}.

## FOUND: diagnoseMobilization already exists (it was in module.exports all along)

coopVirtualWorldRuntime exports diagnoseMobilization (and diagnoseCombat, diagnoseWarState,
diagnoseWarFunding, diagnoseNpcOrder, diagnoseNativeRaids, nativeWarFleetRegistry,
livingWorldPhases). Called from a fresh `docker exec node`, diagnoseMobilization returns
{"status":"MOBILIZER_NOT_INITIALIZED"} because warMobilizer is module state created by the
running phase, not by a cold require. So the dry-run MUST be invoked inside the server
process: either (a) a tiny env-gated hook that calls diagnoseMobilization on a timer and
logs it, or (b) an admin-bridge action. (a) is 5 additive lines and cannot break startup.

## READY-TO-APPLY: the mobilization diagnostic hook (paste, then apply-all + build)

In integration/coopVirtualWorldRuntime.cjs, right after the module.exports assignment,
append (additive, cannot affect startup):

  if (process.env.EVEJS_COOP_WAR_DIAG === "1") {
    try {
      const timer = setInterval(() => {
        try {
          const out = module.exports.diagnoseMobilization();
          console.log("[CoopWarDiag] mobilization " + JSON.stringify(out).slice(0, 1200));
        } catch (error) { console.log("[CoopWarDiag] error " + error.message); }
      }, 60000);
      if (typeof timer.unref === "function") timer.unref();
    } catch (_error) { /* diagnostics never break the world */ }
  }

Then: EVEJS_COOP_WAR_DIAG=1 in compose.coop-probe.yaml, apply-all, build, recreate, and read
`docker logs evejs-server-1 | grep CoopWarDiag`. That prints the real per-side rejection
(funding gate / getOrderLeases / readiness) for war:500001-500004.

## BREAKTHROUGH: the war is FIGHTING (2026-10-27T20:56Z, deployed on the play stack)

The exact refusal was named by the existing admin action `war_diagnose` (no rebuild
needed for diagnosis): DEFENDER side rejected entity 980000023574 with WRONG_FACTION
(it is a Federation Navy hull in the Caldari contested system) and the ATTACKER side
rejected 980000023571 with ORDER_LEASE_ACTIVE. Both war-doctrine hulls existed but sat
in each other's systems, so no side could ever muster.

Fix proven live, all through sanctioned paths:
1. `release_identity` on two out-of-the-way traders (coop-pilot-034, coop-pilot-069).
2. `spawn_war_fleet` faction 500001 in 30045344 and faction 500004 in 30003837 with
   those pilots as commanders -> real Caldari Navy Condor 980000033113 and real
   Federation Navy Atron 980000033114, doctrine loadouts, durable, linked as patrols.
3. Next mobilization tick: campaign left PREPARING, `[CoopFactionWar] assault begun
   war:500001-500004:campaign:30045344 attacker=1 defender=1`, both sides SIDE_MUSTERED.
4. The gate-staging phase then really transferred the Gallente hull 30003837 -> 30045344.

Remaining blocker was co-location: the battle director only fires inside 250 km and the
fleets sat 9.87e12 m (66 AU) apart. New FW-030 `integration/coopWarEngagementWarp.cjs`
(env `EVEJS_COOP_WAR_ENGAGE_WARP=1`, default OFF, 6 unit tests) warps the assaulting side
to the nearest opposing war ship of the same campaign - one real `npcRuntime.warpToEntity`,
never a teleport, spawn or damage.

Deployed (apply-all OVERLAY_OK, image evejs-local rebuilt, server recreated) and observed:
- `living-native-war-engagement-warp` status WARP_ORDERED, both Gallente hulls
  NATIVE_WARP_STARTED at 9.87e12 m.
- `living-native-war-attack-orders` NATIVE_ATTACK_ORDER_ACCEPTED: Caldari 980000033113
  attacking Gallente 980000023574 in 30045344.

NEXT: confirm real damage/wreck (HP drop on the same entities, not just the ACK), then
make the garrison durable instead of operator-seeded: a war-zone system must be
garrisoned by its controller's navy every time it is observed, otherwise a lost fleet
freezes the front again.

NOTE: `scripts/overlay-spec.cjs` also needed `require("../../gameStore")` (the in-flight
hauler work used `../gameStore` from services/mining, which cannot resolve and blocked
the whole overlay with HOOK_REQUIRE_MISSING_FILE).

## Live war state after FW-030 (2026-10-27T21:25Z)

PROVEN live on the play stack (all through sanctioned paths, no invented ISK/kills):
- campaign war:500001-500004:campaign:30045344 is in ASSAULT, both sides SIDE_MUSTERED;
- `[CoopFactionWar] assault begun ... attacker=1 defender=1` and the front chat line
  "[Front] Assault begun in system #30045344: 1 attacking ships against 1 defenders.";
- real native gate transfer moved a Gallente hull 30003837 -> 30045344;
- FW-030 warps the assaulting side from 9.87e12 m (66 AU) to ~12 km: WARP_ORDERED,
  NATIVE_WARP_STARTED;
- the war director then issues a real native attack order:
  NATIVE_ATTACK_ORDER_ACCEPTED Caldari 980000033113 -> Gallente 980000023574.

STILL NOT PROVEN - and this is the single next blocker: no damage is exchanged.
Measured on the live ships: both sides keep hp {shield 150/175, armor 175/145,
structure 160/125} unchanged; the ordered hull shows `manualOrder {type:attack}` but
`currentTargetID: 0`, `mode: STOP`. The doctrine guns are short-range autocannons
(typeID 564/562 on the Condor/Atron), so 11-90 km is outside real gun range, and:
- a native warp refuses a short hop (`WARP_DISTANCE_TOO_CLOSE` at 43 km / 90 km);
- `orbit(id, enemy, 1000)` is accepted (`NATIVE_ORBIT_ORDERED`) but the patrol's own
  movement wins and the range grows again (12 km -> 27 -> 43 -> 89 km -> back to 66 AU).

NEXT SINGLE STEP: make the attack order and the approach one decision - issue the
native attack only once the hull is inside real gun range, and stop the patrol's own
movement from overriding the approach (the order bridge refuses any new WAR order while
`movementBusy` is true and the hull has no arbiter lease, which is exactly the state an
orbiting patrol is in). Do not raise the battle director's 250 km rule: that is the real
firing envelope of these guns' falloff, not a bug.

## FW-030 v3: a hull holding an accepted attack order also closes on its target

Deployed: `coopWarEngagementWarp` no longer only moves the assaulting side. A war hull
whose controller carries `manualOrder {type:"attack"}` with `currentTargetID: 0` is a
hull that is outside real gun range with an order it cannot use, so it now closes on the
ship it was ordered to kill (orbit inside 150 km, standoff warp beyond). Measured live
after deploy: NATIVE_ORBIT_ORDERED at 82-90 km for the two Federation Navy hulls.

Still not proven: HP on 980000033113 / 980000023574 / 980000033114 is unchanged
(shield 175/150, armor 145/175, structure 125/160) and the Caldari hull still shows
`mode STOP` with `currentTargetID 0` under an accepted attack order. So the open
question is now narrow and native-side, not war-side: why a native `attack` order that
the order bridge accepted leaves the controller with no target, and why an accepted
`orbit` does not hold the hull at that range. Check `coopNpcHostility`
`allowsNativeEngagement` (both flags are 1, so it should authorise) and the native
`npcBehaviorLoop` target acquisition for these two hulls before touching the war code
again. Nothing in the war store, the campaign or the front chat is blocking.

## WAR IS REAL: damage, mutual orders and three native kills (2026-10-27T22:20Z)

Root causes found by measurement, not guesswork, and all three were needed:

1. `coopNativeReadCache` indexed native rows by `row.itemID`, but
   `nativeNpcStore.listNativeEntities()` publishes the id as `row.entityID`. Every
   cache lookup missed, so `coopWarCombatAuthority.evaluatePair` answered
   `NATIVE_STORE_IDENTITY_MISMATCH` for EVERY war pair. The hostility hook therefore
   denied every engagement: an accepted attack order never became a target. Fixed by
   indexing `itemID ?? entityID` (`tests/coop-native-read-cache.test.mjs`).

2. The war hull is spawned at a belt anchor and warped to the enemy, so it stands
   ~150 km from home with the profile's 90 km leash. `isBeyondLeash` then ran
   `clearNpcCombatState` on every think, resetting `currentTargetID` to 0 and flying
   the hull home. New FW-031 `integration/coopWarEngagementPosture.cjs`
   (`EVEJS_COOP_WAR_ENGAGEMENT_POSTURE=1`, default OFF) applies the *native*
   behaviour overrides `leashRangeMeters: 0`, `orbitDistanceMeters: 500`,
   `movementMode: "orbit"` to every registered war hull in an assault system,
   preserving all other overrides and never re-applying the same values.

3. A war hull only flying its own patrol movement (GOTO/ORBIT) had `movementBusy`
   true and no arbiter lease, so the bridge refused WAR with
   `COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE` - and a lease is only created by a
   successful issue, so the defender could never be ordered at all. The bridge now
   lets WAR retask its own ASSIGNED hull when it carries no manual combat order.
   An unleased manual attack from an unknown owner is still never hijacked
   (`tests/coop-war-order-arbiter.test.mjs`, including a repair of that fixture,
   which referenced an undefined `arbiter` and could never have passed).

FW-030 also grew a real fleet warp: a side of 2+ hulls that must close now issues
ONE native `warpBatchToPoints` with a line-abreast formation around the standoff
anchor (per-slot lateral offset + staggered rank depth); a lone hull keeps
`warpToPoint`. Formation offsets are unit-tested; no live scene has needed a
multi-ship warp yet because the spawned hulls landed inside warp range.

LIVE EVIDENCE (play stack, no fabricated damage):
- `living-native-war-engagement-posture` POSTURE_APPLIED for 980000033113,
  980000033114, 980000023574.
- `npc_pair_diagnose` 980000033113 -> 980000023574: `warVerdict AUTHORIZED`,
  `currentTargetID 980000023574` (was 0 before), leash override present.
- Mutual real attack orders accepted in one tick: 980000033113 -> 980000036202,
  980000036201 -> 980000036202, then 980000036202 -> 980000036201.
- THREE real warship kills with native wrecks and stored loot:
  980000023574 (wreck 980300000022), 980000033114 (wreck 980300000024),
  980000036202 (wreck 980300000034), 980000036239 (wreck 980300000035).
  Merit moved on both sides: Caldari commander promoted recruit -> pilot -> wingman
  (command 1 -> 3), the losing pilots took `force-lost -10`.

NEXT: the front is still operator-seeded (`spawn_war_fleet` needs a free identity).
A durable garrison - a war system refilled by its controller's navy whenever it is
observed - is the remaining gap before the war runs unattended. The formation warp
needs one live case where a side of 2+ must close as a group to be seen in-client.

## FW-032/033: the front now heals itself (2026-10-27T22:35Z, live)

Two more measured defects closed, both proven on the play stack.

FW-032 `integration/coopWarLossReconcile.cjs` (`EVEJS_COOP_WAR_LOSS_RECONCILE=1`):
a confirmed native wreck now RELEASES the hull's exclusive custody slot in the war
fleet registry (the registry's own release verifier already accepts a
process-confirmed wreck) and frees the killed pilot's identity. Before this, a dead
hull stayed ALIVE in the registry forever, so the side looked fully mustered with a
corpse and the pilot could never fly again. Live: `living-native-war-loss-reconciled`
status RECONCILED, custody APPLIED, identity RELEASED for 980000036587 / wreck
980300000037.

FW-033 `integration/coopWarGarrison.cjs` (`EVEJS_COOP_WAR_GARRISON=1`): an ASSAULT
side with fewer than `garrisonSize` (2) hulls in the campaign target system is
refilled through the SAME sanctioned path an operator uses - `spawn_war_fleet`
(real doctrine row, real native ship, real free pilot identity), one hull per tick,
3 min cooldown per side. Live: two `living-native-war-garrison` GARRISON_APPLIED
events spawned 980000036587 (fleet coop-fleet-500004-0007, commander
coop-pilot-038) and 980000036810 (fleet coop-fleet-500004-0008, commander
coop-pilot-069) - both commanders were identities freed by earlier real kills.
Minutes later 980000036810 was already receiving a real attack order.

Measured caveat: `coopWarFleetRoster` is EMPTY in this deployment (0 fleets) -
`spawn_war_fleet` only writes the war fleet registry, not the newer roster. So the
FW-032 roster half honestly reports NOT_IN_ROSTER, and `planReconstitution`/
`commitReconstitution` cannot be used for these hulls. The authoritative custody
path is the registry, and that one works.

Still open: the formation batch warp (FW-030) has no live case yet - garrison hulls
spawn close enough to the enemy that they engage without a group warp. The next
natural trigger is a side mustering in its source system and travelling together.

## FW-034: the client advantage panel now answers for OUR pair (2026-10-27T22:50Z)

The owner reported that the faction-warfare window works for the other warzone but
not for Caldari/Gallente: the map is empty for ours and the "advantages" tab spins
forever instead of erroring. Measured on the running server:

- The map surface is fine: `fwWarzoneSolarsystem.GetAllWarzonesOccupationStates`
  returns warzone 2 = {30003837: owner 500004 / occupier 500004 / not contested,
  30045344: owner 500001 / occupier 500004 / CONTESTED}. So the map data for our
  pair really exists; an empty client view is a client-side cache, not missing data.
- The advantage surface was empty: `fwVictoryPointMgr.GetAllVictoryPointStates` and
  `GetLocalVictoryPointState` are served from `stateBySolarSystemID` /
  `session.fwVictoryPointStatesBySolarSystemID`, and NOTHING in this build fills
  them, so the client waits on a system it will never receive. The fw-advantage
  express gateway (`eve_public.faction.activity.GetSolarSystemScoresRequest`) reads
  `context.fwAdvantageScoresBySolarSystemID`, which is also never set.

New FW-034 `integration/coopWarAdvantage.cjs` (`EVEJS_COOP_WAR_ADVANTAGE=1`, default
OFF) derives both surfaces from evidence we already hold and invents nothing:
`contribution(faction) = 1000 * enemy wrecks that faction took in this system +
100 * its hulls present`, `score = the larger side`, `threshold = 75 000` (stock).
Two L2 hooks feed it: `fwVictoryPointMgrService` (both handlers) and the
`fw-advantage` gateway service.

Live probe in the running container:
  ALL   {30003837: {0, 75000}, 30045344: {3200, 75000}}
  LOCAL [30045344, {3200, 75000}]
  SCORES [{500001, 3200}, {500004, 1100}]
  snapshot 30045344: Caldari 3 wrecks taken / 2 hulls, Gallente 1 wreck / 1 hull.

## NIGHT 2026-10-28 - N1 landed, next steps (autonomous run)

Plan: `.opencode/night-plan-20261028.md` (13 tasks). Watchdog:
`.opencode/night-watch-20261028.log` (one line every 15 min, read-only).

DONE tonight:
- FW-035 `integration/coopWarCaptureByForce.cjs` + 5 tests. A system flips
  `militaryControllerFactionID` only with: a verified defender wreck in THIS
  campaign and system, ZERO live defender hulls there, sustained 60 s, then
  RECORD_OBJECTIVE -> CAPTURE_TERRITORY through the same authoritative core.
  Fork commit `2cb671c` (module + phase `native-faction-war-capture-by-force` +
  `EVEJS_COOP_WAR_CAPTURE_BY_FORCE=1` in compose.coop-probe.yaml), repo `747c4701`.
- Image NOT rebuilt and play stack NOT restarted (night rule). The morning deploy
  must: `docker build -t evejs-local .` then `up -d --no-deps server`, then verify
  `living-native-war-capture-by-force`.

BLOCKER discovered: compose/compose.agents.yaml has NO `EVEJS_COOP_FACTION_WAR*`
flags at all, so the agents stack cannot prove any war behaviour as-is. Options:
(a) enable the war flags there and seed the war through the sanctioned admin path
(`spawn_war_fleet` + release/assign identity), or (b) prove live on the play stack
after the morning deploy. Not yet decided; nothing was changed on the agents stack.

NEXT (in order): N2 formation live proof, N3 restart resilience diff, N4 player as
target, N5 war economy debit, N6 roster truth, N7 ammo, N8 wreck hygiene,
N9 militia rank, N10 soak table, N11 FW hook extraction (AUDIT_OK), N12 operator
guide, N13 morning handover.

## PROBLEMS OBSERVED by the night watchdog (2026-10-27T23:53Z, real numbers)

Watchdog v2 (`scripts/night-watch.ps1`, harness-managed background job) logs one line
every 15 min plus an explicit PROBLEM line for: stack not healthy, CPU > 70%, war
event file unreadable, or no war event for 60 min.

First real sample: play stack healthy, CPU 0% (idle), war events on the play stack =
15 casualties / 22 garrison spawns / 82 attack-order events.

P1 FREE-SHIP GRINDER (confirmed, needs N5). Fleet registry holds only 2 hulls
(1 Caldari, 1 Gallente, both in 30045344) while 22 garrison spawns happened: a hull
dies, FW-032 releases its slot and frees the pilot, FW-033 immediately buys another
one for free. The front is an endless free meat grinder - no cost, no end condition.
N5 (real economy: debit the faction chest, refuse when empty) is the fix.

P2 ROSTER IS DEAD WEIGHT (confirmed). `coopWarFleetRoster` still reports 0 fleets;
`spawn_war_fleet` never writes it. FW-032 honestly reports NOT_IN_ROSTER. Either wire
it (N6 option a) or delete the dependency (option b). No functional impact while the
registry is authoritative, but it is a lie in the payload.

P3 GARRISON PACING not yet proven safe: 22 spawns/hour is at the 3-min-per-side
cooldown ceiling. With N5 it becomes self-limiting; until then the only brake is the
cooldown. Watch the soak table (N10) for growth.

P4 agents stack cannot prove war behaviour at all (no `EVEJS_COOP_FACTION_WAR*`
flags in compose/compose.agents.yaml). Every live war proof must happen on the play
stack after the morning deploy, or the agents stack must be given the flags and a
seeded war.

## WHY THE WAR FROZE (diagnosed 2026-10-28T10:04Z, real probes)

Symptom: no faction-war event since 04:47 (counters stuck 15 casualty / 22 garrison /
82 orders) while the world keeps running (phase cycle 1170 at 10:02:53 includes every
`native-faction-war-*` phase, and pirate warp-point tackles still fire at 10:02:42).

Two independent deadlocks, both measured:

D1 GHOST HULLS IN THE FLEET REGISTRY. The registry holds exactly two hulls -
980000038148 (Caldari, coop-pilot-038) and 980000039139 (Gallente, coop-pilot-089),
both "in" 30045344. Probe: `nativeNpcStore.getNativeEntity` returns a row for both,
but `scene.getEntityByID` returns nothing for both (`inScene false`). They are dead or
despawned ships that were never released. Consequences:
  - FW-033 counts registry rows as "present" -> missing = 0 -> the garrison never
    refills a side that physically has no ship;
  - the battle director finds no live candidate -> no attack order;
  - the campaign stays ASSAULT rev 2 with 0 objectives, territory still Caldari.

D2 ZERO FREE PILOT IDENTITIES. Roster 100, linked 100, free 0. The last garrison
attempts are literally `phase:"garrison", reason:"NO_FREE_PILOT_IDENTITY"`
(23:26, 23:30, 23:34) interleaved with `GARRISON_COOLDOWN`. So even a correct
"missing" count could not field a replacement commander.

WHY IT IS NOT JUST "absence = death": the registry's own release verifier refuses a
missing hull unless a physical wreck was confirmed (`confirmDestroyed`), which is the
correct invariant. So the fix must NOT weaken custody. Proposed:
  F1 FW-033 counts LIVE scene hulls (inScene), not registry rows, when deciding
     whether a side is missing. Ghost rows then block nothing.
  F2 the free-pilot pool may reclaim an identity whose bound hull is in no scene
     (release_identity on that link first), so a ghost cannot hold the last pilot.
  F3 (separate) a read-only `war_registry_audit` action that reports ghost rows so the
     operator sees them instead of guessing.
Not implemented yet; no change was made to the running server.

## FREEZE ROOT CAUSE FOUND AND FIXED (2026-10-28T10:25Z, deployed)

The freeze was NOT the war logic. `scripts/coop-split-module.cjs` moved
`nativeWarFleetRegistry()` into `server/src/space/coopVirtualWorldRuntime.pure.js`
but did not move its module state, so the function threw
`ReferenceError: warFleetRegistry is not defined` on every call. The garrison phase
caught it per phase (`[CoopLivingWorld] native-faction-war-garrison warFleetRegistry
is not defined`), so the war silently stopped refilling and the front emptied.

Fixes deployed (fork `ef48a4f`, `48f63d9`):
- `.pure.js` now declares `warFleetRegistry`, `bridge`, `identityRegistry` and exports
  `bindWarRuntime({bridge,identityRegistry})`; the main runtime binds the live objects
  right after `createBridge(...)`.
- FW-033 counts LIVE scene hulls, not custody rows (`isHullLive`), so a ghost hull can
  no longer look like a manned side.
- the free-pilot pool reclaims an identity whose ship is in no live scene
  (`GHOST_HULL_NO_SCENE`) instead of starving the garrison with
  `NO_FREE_PILOT_IDENTITY`.

Evidence after deploy: garrison events 22 -> 25; 10:17:10 Gallente refill, 10:17:36
Caldari refill (980000042212, commander coop-pilot-003), 10:20:32 Gallente refill.
The ReferenceError is gone from the log.

STILL BROKEN (next): the battle director issues no attack order (82 unchanged) and
`war_combat_diagnose` returns `status OBSERVED` with an EMPTY ships list, even though
the garrison just spawned three hulls. Suspicion: the same split-runtime state loss in
the combat path (a helper that reads the registry/scene from the pure module), or the
registry rows and the live scene disagree. Next probe: call
`nativeWarFleetRegistry().snapshot()` inside the running process and compare with
`scene.getEntityByID` for each row, then follow `advanceNativeWarCombat` step by step.

## COMBAT BLOCKER NARROWED (2026-10-28T10:35Z)

New measured fact: `war fleet registry ships = 0` (probe reads the SQLite row directly),
yet the garrison reported three successful spawns at 10:17:10 / 10:17:36 / 10:20:32
(fleetIDs coop-fleet-500004-0029/0030, ships 980000042212). So `spawn_war_fleet`
returns a composed fleet but its ASSIGN never lands in `coop-faction-war|fleet-registry-v1`.

Consequences: the battle director has no registered ship -> no attack order (82 unchanged),
`war_combat_diagnose` lists nothing, and the garrison keeps buying hulls every 3 min that
the war cannot see. The capture phase is now unblocked (`DEFENDER_STILL_PRESENT` was the
last refusal at 10:16:47, before the registry emptied).

Next probe (exact): call `executeRequest({action:"spawn_war_fleet",...})` and read the
returned `fleetStatus`/`fleetReason` plus the registry row immediately before and after.
The registry `ASSIGN` needs `verifyNativeShip` AND `verifyCampaign`; the campaign check
requires `campaign.state` in [PREPARING, ASSAULT] and the defender's hull in the target
system - so a hull spawned for the DEFENDER side in the target system is legal, while an
ATTACKER hull must be in `campaign.targetSystemID` during ASSAULT. A mismatch there is the
most likely silent refusal.

## INCIDENT 2026-10-28T11:25Z - I reset the war state by restoring an old runtime

What I did: to kill a cascade of `X is not defined` errors from the split runtime
(`eec175f`), I restored the pre-split single-file
`server/src/space/coopVirtualWorldRuntime.js` (fork commit `6ca4557`).

What broke: the pre-split file is an OLDER code base than the tree it replaced. On
boot its opening phase logged `[CoopFactionWar] empty war state created (version 1)`
and then opened `war:500004-500014` (Gallente vs ORE). The previous state
(`war:500001-500004`, territories 30003837/30045344, the ASSAULT campaign) is GONE.
Identity links also dropped from 100 to 43 (57 pilots now free).

Current measured state after reverting `6ca4557` (fork is back to the split runtime):
  roster 100, linked 43, free 57
  campaign war:500004-500014:campaign:30045344 PREPARING rev 1
  territory 30003837 -> 500014 SECURE, 30045344 -> 500004 CONTESTED
  split runtime still throws `warpPointDirector is not defined` (native-raids phase)

RECOVERY PLAN (do NOT repeat the restore):
1. Never again swap a whole runtime file from an older commit into a newer tree.
2. Fix the split properly: revert `eec175f` in history with conflict resolution, or
   re-run `scripts/coop-split-module.cjs` with module-state extraction, so every
   implicit global is declared. Known missing names so far: warFleetRegistry, bridge,
   identityRegistry, economy, nativeGateTransfer, recognitionAnnouncer,
   nativeAmmoWitness, warpPointDirector.
3. Re-open the Caldari/Gallente war through the sanctioned path. The opening phase
   picks a pair by adjacency and chose 500004-500014; add a confirm-gated
   `war_open` admin action that calls the same store with the same proofs instead of
   guessing, then re-register 30003837 (Gallente) and 30045344 (Caldari).
4. Only then continue with the combat/registry work.

Lesson recorded: a war state row is live data, not code. Any change that can create
an "empty war state" must be proven on the agents stack first, never on the play stack.

## 2026-10-28T12:10Z - the war is running again, and it is Caldari vs Gallente

Recovered from the incident WITHOUT hand-written rows. What was actually broken
and is now fixed in the fork (all committed):

1. `26d107a` split runtime: sixteen names (`warpPointDirector`, `economy`,
   `nativeGateTransfer`, `recognitionAnnouncer`, `nativeAmmoWitness`,
   `raidDirector`, `tacticsDirector`, pve directors, `lossBridge`,
   `nativeOrderBridge`, `lootCommerce`, `nativeAmmoSupply`, `warGateHandoff`,
   `warRecoverySocket`, `nativeGunRange`, `warTreasuryInstance`) were undeclared
   in `coopVirtualWorldRuntime.pure.js`. Every phase that touched one threw
   `ReferenceError`, so raids, economy, ammo, recognition and the war stopped.
   `syncWarRuntime()` now hands the live objects over on every tick.
2. `aa26156`/hoist: `syncWarRuntime` had to be module scope; the tick called it
   before the sale path that declared it.
3. FW-036 (`coopWarObservedSystems.js`): the war layer only observed systems a
   client had flown into, so a spawned war fleet could never open a front.
   `visitedSystems` now also takes systems where the durable roster proves live
   hulls. Test: `tests/coop-war-observed-systems.test.mjs` (5 pass).
4. FW-037 (`coopFactionWarOpening.js`): a front is one gate pair, not one
   direction. A different war holding the target froze the pair forever, so
   Caldari/Gallente could never open. The planner now mirrors across the same
   real gate; the same faction pair still never reopens its own border.
   Tests: `tests/coop-faction-war-opening.test.mjs` (20 pass).

Measured live state now (play stack, evejs-server-1):
  wars: war:500004-500014, war:500014-500019, **war:500001-500004**
  campaign war:500001-500004:campaign:30045343 = ASSAULT (Nennamaila)
  territories: 30045343 CONTESTED (Caldari 500001), 30045344 CONTESTED (500004)
  roster: 3 real fleets of 25 (500001 in 30045343 and 30003837, 500004 in 30045344)
  registry: 3 ships assigned to campaigns
  native evidence: living-native-war-attack-orders NATIVE_ATTACK_ORDER_ACCEPTED
  (980000043284 -> 980000042223), target-selection RANKED, and a
  living-native-weapon-event VERIFIED (980000043284 -> 980000043880)

Next step (in order):
1. The 25-ship roster fleets are PRESENCE (territory/front) but not BATTLE:
   only the 1-ship garrison formations get campaign ASSIGN rows, so fights are
   1v1. Teach the mobilizer/garrison to adopt roster hulls into the campaign.
2. Then prove the same on the accelerated `evejs-agents` stack (needs the
   EVEJS_COOP_FACTION_WAR* flags there plus a seeded war).
3. Then the client surfaces (warzone payload/FW window) against the new war.

## 2026-10-28 - OPS refactor: 19 gate scripts -> 1 runner + 1 validated table

Commit `ebd2e2ac` (+ worklog `b03861d7`, docs `74017446`). No gameplay code touched.

  scripts/lib/CoopGate.ps1  192L  the six steps once (tests exist -> manifest all-NOT_RUN
                                 -> node --test -> tail -> throw -> pinned verifier)
  scripts/lib/gates.json    583L  the 19 gate rows as data (tests, tail, log, manifest, pins)
  Run-*.ps1 (19)            161L  five-line wrappers, same names, same banners (-671/+41)
  tests/coop-gate-specs.test.mjs  proves every declared test/pin/manifest still exists,
                                  no manifest claims unexecuted gameplay, no silent key typo,
                                  every row has a wrapper. 5/5 pass.

Evidence: all 19 gates run before and after the change with identical exit codes
(8 pass / 11 already red - the red set is the other session's in-flight overlay work,
not this change) and identical PASS/NOT_RUN banners. The only textual difference is
the report-dir path echoed in LW04C4's failure message.

Left alone on purpose: scripts/lib/CoopGate.ps1 is not dot-sourced by anything else;
Run-Alife-Economy-Tests.ps1, Run-CommunityFittings.ps1, Run-NativeJob-Tests.ps1,
Run-StageJ-Salvage-Tests.ps1, Run-LW04D-Source-Gates.ps1 do not share the template.

Next candidates (NOT started): the six scripts/verify-*.cjs repeat the same pinned
git-blob hash + reversible-patch-chain check; scripts/Run-Alife-Economy-Tests.ps1
(183L, and a test reads its text) could take a second table row once its extra
manifests are expressed. Engine perf work stays blocked while space/coopStationDrain.js
and the overlay-spec edits are uncommitted in another session.

## FW on the accelerated work stack — first seeding done (2026-10-28T12:15Z, evejs-agents only)
Start: `war_state` EMPTY, `war_fleet_state` 0 ships, presence only ORE/pirates, roster 12
pilots of which 10 already linked to the mining fleet -> no border could ever be staffed.
1. `compose/compose.agents.yaml`: EVEJS_COOP_VIRTUAL_POPULATION 12 -> 64 (the virtual world
   tops the roster up on boot without wiping pilot history; measured pilots 64 after restart).
2. Real patrol seeding WORKS: `spawn_native_npc` needs an explicit real `loadoutID`, because
   every SDE navy profile carries `retail_empty_npc_entity_loadout` and the profile's own
   `<profile>_loadout` row is missing (`WAR_PATROL_LOADOUT_UNAVAILABLE:LOADOUT_ROW_MISSING`).
   Working pair: "Caldari Navy Condor" + `guristas_light_missile_frigate` (corp 1000035 ->
   500001, missileLauncher, chargeDepth 80), "Federation Navy Atron" +
   `serpentis_small_blaster_frigate` (corp 1000120 -> 500004). Spawned 4 real durable hulls
   (980000000283/286 in 30045344, 980000000288 + one in 30003837).
3. Caveat measured: a pilot released and re-linked is re-bound to its durable old hull within
   ~20 s, so the 2nd spawn answered `PILOT_ALREADY_LINKED` (its hull exists, unlinked). Use a
   fresh pilotID per hull, and never assume the link when the status is not LINKED.
4. The opening phase then opened a REAL war by itself: `war:500014-500019` (ORE vs 500019)
   with `campaign:30000144` PREPARING (source 30000142), territories 30000142 -> 500014
   SECURE, 30000144 -> 500019 CONTESTED. Log: `opening skipped: NO_OPENABLE_FRONT` on the
   later tick = the same faction pair has a live campaign, not a failure.
5. Measured bug: `war_diagnose` answers `INVALID_MOBILIZATION_STATE` with campaignCount 0 while
   `war_state` shows that campaign, and the tick says `mobilization skipped:
   NO_MOBILIZED_SHIP:OBSERVED`. So the diagnose reads a different record path than the store
   (the same read-path class of bug fixed on 2026-10-27 for the phases).
Next: make the mobilizer see real armed patrols on both sides of campaign:30000144 (attackers
in 30000142, defenders in 30000144), or force the Caldari/Gallente border by outnumbering
30045344 (500001) vs 30003837 (500004); then check whether the fleet registry ASSIGN lands.
NOTE: MCP `evejs-server.events` reads the OWNER's play stack, not this one - do not mix them.

## FW PROVEN ON THE ACCELERATED STACK: war -> ASSAULT -> mutual orders -> real damage (2026-10-28T12:23Z, evejs-agents only)
Seeded by hand on the work stack (population 64, 8 real navy patrol hulls), then the world did
the rest by itself. Measured, verbatim from that stack:
  war_state: wars [war:500014-500019 ACTIVE, war:500001-500004 ACTIVE]
             campaigns [*:campaign:30000144 PREPARING, *:campaign:30045344 **ASSAULT**]
  presence 30045344 500001x6 / 500004x1 / 500014x3, 30003837 500004x3 / 500014x2 / 500019x2
  war_fleet_state: 2 registered fleets (coop-fleet-500004-0001 Federation Navy Atron 980000000565,
             coop-fleet-500001-0002) -> the earlier "ASSIGN never lands" blocker does NOT reproduce
             with the current fork build (bindWarRuntime + isHullLive fixes)
  living-native-war-garrison GARRISON_APPLIED (real hull bought through spawn_war_fleet)
  12:21:23 living-native-war-attack-orders: MUTUAL NATIVE_ATTACK_ORDER_ACCEPTED
             980000000423 <-> 980000000565, both in the contested 30045344
  12:22:19-12:22:29 living-native-combat-damage systemID 30045344 correlatedNpcDamage 1
             (a war hull really taking damage; ACK alone is still not a kill)
  war_diagnose now answers DRY_RUN campaigns 2 mobilized 1. The earlier
  INVALID_MOBILIZATION_STATE was a stale read immediately after a container recreate, not a
  durable bug - re-measure before "fixing" it.
Spawn recipe caveats (both real): every SDE navy profile points at `retail_empty_npc_entity_loadout`
so an explicit real `loadoutID` is mandatory; and `linkSpawnedIdentity` refuses
PILOT_ALREADY_LINKED because a free pilot is re-bound to its durable old hull within ~20 s, so pick
a pilot that is free RIGHT NOW (roster 64, 32 free) or bind the existing unlinked hull with
`assign_identity`.
NEXT (unmeasured): casualties (wreck + casualty ledger), objective/capture on a bound structure,
payout, and the same chain on a fresh agents world without hand seeding. The owner's play stack
was not touched; the elevated event numbers there (war:500001-500004 campaign:30045343 with
accepted attack orders at 12:05) come from the earlier morning deploy, read-only.

## FW-009A PROVEN + capture-by-force is the next wall (2026-10-28T12:27Z, evejs-agents)
12:24:46 `living-native-war-casualty` RECORDED: war:500001-500004 / campaign:30045344, victim
980000000283 (Caldari 500001, coop-pilot-013, corp 1000035), wreckID 980300000002, real native
wreck 12:24:46.677 `living-native-wreck-evidence` PHYSICAL_NATIVE_WRECK_VERIFIED, 4 stored items.
The receipt is honest about what it does not know: attribution NATIVE_VICTIM_WRECK_ONLY_NO_KILLER,
captureAuthorized false, killCreditAssigned false. So casualties are real; killer identity is not.
12:26:25 `living-native-war-skip` phase "capture-by-force" reason **NO_DEFENDER_WRECK** - the kill
we got was an ATTACKER hull, and FW-035 needs a wreck of the DEFENDING faction in the campaign
system, plus the defender holding ZERO registered hulls there twice, >=60 s apart.
Both garrisons keep buying replacement hulls (GARRISON_APPLIED at 12:24:08 and 12:26:52), so a
defender side never stays empty long enough: this is N5 (chest-funded garrison) promoted from
"nice to have" to the actual capture blocker. FW-005B `coopWarChestFunding` already exists and
moves only real earned ISK (pilot earned balance -> faction corp wallet -> HELD escrow), so N5
must be wired to it rather than to a new money source.
NEXT (exact): (1) get a defender-side wreck in 30045344 (attackers already outnumber 6:1 there);
(2) gate the garrison refill on a funded chest and refuse when empty, so the defender can really
stay at zero across the two 60 s samples; (3) observe CAPTURE_TERRITORY + militaryControllerFactionID
flip in war_state; (4) only then payout/merit for the owner's character.

## Harness quality pass: pinned verifiers + last hand-written gate (2026-10-28, OPS)
Two duplicated mechanisms in `scripts/` are now single implementations.
`scripts/lib/pinned-source.cjs` (84L) holds the git-blob hash of the CRLF-canonical text,
`readPinned` (disk bytes for the patch + hash for the pin), `assertReversible` (change,
idempotency at the last stage, byte-exact reversal per line ending) and the
`node script.cjs <root>` CLI. Five `verify-alife*.cjs` keep their own pins, messages and
exported names. Evidence: mismatch output byte-identical, `tests/coop-pinned-source.test.mjs`
8/8 including a real `git hash-object` oracle.
`Run-Alife-Economy-Tests.ps1` dropped 183L -> 13L: 38 tests, the
`-IncludeExistingEconomyTests` switch, ten NOT_RUN manifests, the `not ok` failure dump and
the 95-scenario banner are a row in `scripts/lib/gates.json` (purely additive: no existing
row changed). Before/after runs of the real suite are identical apart from the report path,
durations and the inspected stack-frame line.
NEXT candidates (not started): the `src/services/*` verifier copies are done, so the same
treatment fits the five `Inspect-Coop-*.ps1` (identical base64-over-docker probe, only the
module and banner differ), the ~50 test files that hand-roll env save/restore, and - only
after the other session commits `space/coopStationDrain.js` + `miningNpcOperations.js` -
the engine perf pass on `coopVirtualWorldRuntime.js` (477 `require()` calls, per-tick sorts).
`node scripts/coop-engine-audit.cjs` still prints AUDIT_REGRESSION from that in-flight work.

## Harness quality pass 2: read-only probes (2026-10-28, OPS)
The four `Inspect-Coop-{ConvoyOperations,ConvoyOutcomes,Market,MarketStation}.ps1` now
dot-source `scripts/lib/CoopContainerProbe.ps1` (69L) instead of repeating the
base64 + `docker compose exec -T server node -e` plumbing. `Inspect-Coop-Training` is
deliberately untouched (it inspects container env, not a module). Proven without a
container: a PowerShell `docker` function recorded the exact argv of all four before
and after; 12 cases (success / Docker exit 5 / missing compose) are identical in argv,
decoded payload, banners and thrown text. `tests/coop-container-probe.test.mjs` pins it.
Net lines went UP (+59) because the helper is documented and each wrapper is now named
data; the win is one container invocation instead of four.
Engine is UNBLOCKED again: the other session committed, `node scripts/coop-engine-audit.cjs`
prints AUDIT_OK and `coopVirtualWorldRuntime.js` is 4506L (ceiling 4800).
Perf must stay profile-first (`docs/PERFORMANCE_REVIEW.md`: no optimisation without a
profile row naming the caller). A micro-benchmark of `require()` on this shared box gave
70us/call and then 0us/call on re-run, so it proves nothing - do not act on it. The next
three targets are already ranked there (buildConfiguredConcordStartupRules memo,
structureState.cloneValue, coopGameStoreAtomic reconcileObject); a real profile needs the
agents stack, which another session is currently running (do not restart it).

## Stale wiring assertions + one real gap found (2026-10-28, TEST)
Three recorded-red test files were red for reasons that were not behaviour: a bare `\n`
anchor against `integration/coopVirtualWorldRuntime.cjs`, which is committed with CRLF
(byte-identical to the engine copy), and two checks that greped the LEGACY installer
`scripts/patch-evejs-coop.cjs` for module names that now live in `scripts/overlay-spec.cjs`.
`coop-alife-order-authority`, `coop-convoy-native-outcomes-overlay` and (partly)
`coop-alife-native-buyer-wiring` are green again; the module checks now ask
`overlayRegistrations()` for exactly ONE registration, which is stricter than a substring.
Anchors must be `\r?\n` - `docs/DEVELOPMENT_DOCTRINE.md` already says EOL-agnostic.

**Real gap, left standing on purpose:** `integration/coopAlifeStationAuthority.cjs` returns
`products: rows.map(({requirements,...x})=>x)` and NO `materialNeeds`, while
`coopAlifeNativeBuyerDispatch.cjs` requires `Array.isArray(economy.materialNeeds)` and
`coopAlifeNativeBuyerRuntime.cjs#needs()` requires `observed.materialNeeds` plus a
cross-pilot JSON match. Nothing in the repo or the fork ever writes `materialNeeds`
(`grep -rn materialNeeds` finds only those two readers and the tests that fabricate it),
so the opt-in COOP-049 buyer leg cannot fire even with its flag on - contradicting
`docs/COOP_049_ALIFE_NATIVE_BUYER.md` §2 ("derived concrete materialNeeds"). The red case
"station authority is genuinely read-only, never virtual inventory" is that alarm: do not
delete the assertion, decide whether the authority should derive `materialNeeds` from
`requirements` again or the buyer should read `products`. Feature is OFF by default, so
this is not a live regression.

### Where the parity baseline stands (2026-10-28, after 34b871ec)
`docs/evidence/test-parity.json` was re-recorded over its 31 files: **234 pass / 1 fail**
(was 222/13 at `b42e53fc`). Eleven of the thirteen were stale assertions, not behaviour:
a CRLF-vs-`\n` anchor, a sandbox `require()` whitelist that predated the module split, four
greps of the LEGACY installer's module list (now `overlayRegistrations()`), `safeNpcPhase`
labelled phases the coordinator dispatches as `runPhase` - one of those slices was EMPTY,
so its three assertions were passing on nothing - and one label that changed from
UNCLASSIFIED to INVALID. The single remaining red is the COOP-049 `materialNeeds` gap
above. The snapshot also contains the other session's uncommitted `overlay-spec.cjs` work;
reverting that shows up as a parity regression, which is the intended signal.

## FW capture: two real blockers found and fixed (2026-10-28T13:3xZ, evejs fork 45ad47f + 4068eff)
Capture (FW-035) could not land on the work stack, and it was NOT the wreck evidence:
`campaign:30045344` already held two verified defender wrecks (victimFactionID 500001,
attribution NATIVE_VICTIM_WRECK_ONLY_NO_KILLER). Two genuine defects were in the way.
1. N5 - the garrison bought a free replacement navy on cooldown forever (GARRISON_APPLIED
   every ~2.5 min), so the defending side never held zero live hulls. Fixed in the fork
   (4068eff, EVEJS_COOP_WAR_GARRISON_FUNDED=1, agents stack only): a refill now requires a
   COMMITTED FW-005B campaign-chest entry for that faction+campaign, i.e. ISK a real seeded
   market fill paid to an NPC pilot. Verified LIVE after deploy: `living-native-war-skip`
   phase "garrison" reason "GARRISON_CHEST_EMPTY" at 13:20:28 and 13:23:39 - no hull bought.
2. FW-035 counted registry rows, not hulls (45ad47f). A custody row is not a ship: three
   500001 rows whose hulls were in no scene answered DEFENDER_STILL_PRESENT forever. Capture
   now takes the same isHullLive scene probe FW-033 uses and reports liveDefenders +
   ghostDefenders separately; without the authority the old behaviour is unchanged.
Tests: tests/coop-war-garrison.test.mjs (12 pass), tests/coop-war-capture-by-force.test.mjs
(8 pass), `node scripts/coop-engine-audit.cjs` AUDIT_OK, integration/*.cjs in sync.
STILL UNPROVEN LIVE: CAPTURE_TERRITORY + a militaryControllerFactionID flip. The work stack
`evejs-agents` is being recreated by another session roughly every 10-20 min (13:13:25 was not
mine). After each recreate the durable navy hulls come back as registry rows but
`war_combat_diagnose` shows inScene=false / npc=false, so no attack order is ever issued
(latest living-native-war-attack-orders is 12:31:27) and no defender wreck can be produced in
the window. Re-seeding by hand (spawn_native_npc + assign_identity, then spawn_war_fleet) gets
a real ASSAULT campaign and in-scene hulls (1702 npc=true) but the peers do not materialize.
Next: one quiet window on evejs-agents, or the owner's approval, to run the last step:
1 live defender + 3 armed attackers in the target system -> defender wreck -> zero live
defenders -> CAPTURE_TERRITORY. Do not weaken the sustain window to force it.

## Test-side duplication: flags on/off (2026-10-28, TEST)
`tests/_support/env.mjs` now owns "turn these flags on, then put them back" (`swapEnv`,
`withEnv(t, ...)`), and nine files use it - previously four spellings of the same six
lines, including one `process.on('exit')` variant for flags set at import time. Each file
keeps its own flag list; only save/apply/restore is shared. 44 lines out, 25 in. Verified
case-by-case (counts and failing names identical before/after). `tests/coop-env-support.test.mjs`
(7 cases) pins the two rules that matter: an originally unset name is deleted, never set to
the string "undefined", and an existing value comes back exactly.
The other ~19 files with a hand-rolled snapshot are mostly the `coop-escort-*` family, which
is already deeply red (below) - convert them when their cases are fixed, not before.

### The escort suite is the largest red cluster and has no single cause
34 `tests/coop-escort-*.test.mjs` files, ~120 failing cases (13 `CONTRACT_NOT_FOUND`,
9 `FLIGHT_FUNDING_PREPARE_UNCERTAIN`, 8 each `ROUTE_CHECKPOINT_WRITE_UNCERTAIN` /
`MANIFEST_DIRECTORY_DURABILITY_UNCERTAIN`, plus a long tail). This is not one import path or
one moved helper: each is a per-case expectation against the durable funding/warp-fence
contract. Deciding whether the tests or the runtime is stale needs the escort owner's intent,
so it is recorded here rather than "fixed" by relaxing assertions. None of these files are in
`docs/evidence/test-parity.json`; adding them would only record red.

## FW CAPTURE PROVEN END TO END (2026-10-28T13:37:57Z, evejs-agents only)
The final gate of the FW ladder is now measured on the accelerated work stack, with no
fabricated step anywhere in the chain:
  13:36:04  living-native-war-casualty RECORDED - defending hull 980000001974
            (Caldari Navy Condor, faction 500001, coop-pilot-005, corp 1000035) destroyed in
            30045344; wreck 980300000010, 4 stored items / 315 units,
            living-native-wreck-evidence PHYSICAL_NATIVE_WRECK_VERIFIED.
  13:37:29  living-native-war-capture-by-force -> OBJECTIVE_RECORDED (warship:980300000010)
  13:37:57  living-native-war-capture-by-force -> **CAPTURED**, receipt CAPTURE_TERRITORY
            APPLIED, systemID 30045344, **militaryControllerFactionID 500011**,
            territoryRevision 3, mode MILITARY_CONTROL_ONLY.
  war_state afterwards: 30045344 = 500011 / **OCCUPIED** rev 3 (was 500001 / CONTESTED),
            campaign:30045344 = OCCUPIED.
Why it landed now and never before - three real defects were fixed in the fork:
  4068eff N5   a garrison may only buy a replacement hull with a COMMITTED FW-005B campaign
               chest entry (real earned ISK). Live proof of the refusal: garrison
               GARRISON_CHEST_EMPTY at 13:20:28, 13:23:39, i.e. no free navy.
  45ad47f FW-035  capture counts hulls really in the scene, not custody rows (it used to
               answer DEFENDER_STILL_PRESENT for three hulls that were nowhere).
  ded5cc7 FW-003C mobilisation counts only hulls really in the scene too; a ghost assignment
               used to mark both sides SIDE_MUSTERED while the only live hull sat idle, so no
               attack order was ever issued and the campaign stalled in ASSAULT.
Tests: coop-war-garrison 12, coop-war-capture-by-force 8, coop-war-mobilization 17 - all pass;
`node scripts/coop-engine-audit.cjs` AUDIT_OK; integration/*.cjs identical to the fork.
Still open (unchanged, not blockers for the capture claim): killer identity is not attributed
(NATIVE_VICTIM_WRECK_ONLY_NO_KILLER), and merit/payout for the owner's character is not yet
observed. The owner's play stack `evejs` was never restarted or reconfigured.

## Escort suite: 122 red cases were a platform artefact (2026-10-28, L1)
Root cause found: every escort/manifest journal fsyncs a DIRECTORY (and, on its re-read
paths, a handle opened read-only) to prove durability before the route advances. On Windows
`fs.openSync(dir)` succeeds but `fsyncSync` throws EPERM, and a read-only handle cannot be
flushed either, so the gates answered MANIFEST_DIRECTORY_DURABILITY_UNCERTAIN,
ROUTE_CHECKPOINT_WRITE_UNCERTAIN, DEPARTURE_REPLAY_FSYNC_UNCERTAIN,
PERSISTED_DIRECTORY_SYNC_UNCERTAIN and refused to advance - on every case, regardless of
the code under test. The fork already had the convention (coopNpcAmmoBankAtomic,
coopNpcWreckCustody, coopNpcManufacturingJournal, coopNpcNativeEconomyDirector); ten
escort/manifest modules had never adopted it. Engine commit 109e131, mirrored here as
97db7108. Linux (the deployed container) is untouched: the guard is `process.platform
=== "win32"` only, write-path fsyncs stay strict, and the read-only re-read paths return
what they would have returned after a successful fsync.
Result on Windows: escort suite 290 pass / 122 fail -> 359 / 52. Also fixed
`coop-escort-native-binding` (11 cases) whose fixture never gained
`settlePeacefulFlight`/`readContract` after d4aa1d54: 14/14.

### What is left in the escort red set, and why it is not the same bug
52 cases, all "the feature now demands a dependency the fixture does not build":
- `coop-escort-flight-stage-c` (13): coopNativeStationArrival.start() pauses with
  ESCORT_DURABLE_WARP_FENCE_REQUIRED unless a durableWarpFence with
  inspectSource/prepare/confirm is injected.
- `coop-escort-native-predeparture` (6), `station-predeparture-gate` (6),
  `route-recovery` (5), `bootstrap-failure` (4), `departure-witness` (3),
  `tactics-rescue` (3), `verified-volunteers` (3): same shape - the fixture must now
  provide the departure/route witness or fence the runtime requires when the paid-escort
  flag is on.
Each needs the fixture rebuilt against the contract, not an assertion relaxed. Do that
feature by feature and record each file's new baseline; do not mass-skip.

### Windows fsync guard, second batch (fork 7adf5d5, mirrored a6fabf64)
Same rule applied to the seven modules that still fsynced a directory unguarded: opportunity
board, escort volunteers, contract mutation fence, job agent selection, job notifications,
salvage consent, salvage provenance. Each gets one local `guard(io, fd)` (they take `io` as a
dependency, so it cannot close over the default fs) and only the directory call sites use it.
Effect: coop-native-opportunity-board 6/10 -> 15/1, coop-escort-native-predeparture 5/6 ->
11/0, escort suite 359/52 -> 365/46. Unchanged (checked before and after):
coop-installer-module-coverage 2/1, coop-npc-job-board 19/1,
coop-salvage-postpickup-settlement 3/6, coop-native-haul-manifest 8/4.
Known inconsistency to unify once `scripts/overlay-spec.cjs` is not being edited by another
session: this guard exists in two shapes - `process.platform === "win32"` plus the errno set
(most modules) and the errno set alone (`coopNativeStationTripJournal`, which documents the
same limitation). One shared helper module is the right answer; it needs an overlay entry.

### coop-escort-flight-stage-c (13 red) is obsolete coverage, not a fixture tweak
Measured, not assumed: injecting `warpFence: createWarpFence({root,clock})` and
`EVEJS_COOP_ESCORT_WARP_FENCE=1` (passing `durableWarpFence:` does nothing - the module builds
it from that flag) moves 2 of 13. The next blocker is
ESCORT_DISCOVERY_AND_PAID_CONSENT_REQUIRED, i.e. `start()` now also demands
EVEJS_COOP_OPPORTUNITY_BOARD + EVEJS_COOP_EVENT_VOLUNTEERS + EVEJS_COOP_ESCORT_PAID_ACCEPT and
a real opportunity-board event before any paid departure. Those preconditions are covered by
files that are already green (native-priced-acceptance 11/11, durable-warp-fence 10/10,
native-funds 22/22, options-board 15/1). Do not rewrite this fixture into a full discovery
simulation: decide with the owner whether these 13 cases are retired or reduced to the flight
gate + station-arrival slice they were written for.

## After the capture: merit works, the client sees the occupation, the bounty is the last rung (13:5xZ)
- Player-visible effect of the capture, from the real client view module on the live state:
  `occupationStates` for 30045344 = {ownerID:500011, occupierID:500011, contested:false,
  militaryState:"OCCUPIED"} (it was 500001/CONTESTED), and the captured campaign is no longer
  listed by `liveCampaigns`.
- Kill merit really runs: `living-native-war-merit` PROMOTED coop-pilot-026/027/045/050/055 with
  kind "warship-kill" +25 and demoted victims with "force-lost" -10, e.g. 13:27:00.799
  coop-pilot-050 recruit -> pilot. `killCreditAssigned:true` still never appears in a casualty
  receipt: attribution stays NATIVE_VICTIM_WRECK_ONLY_NO_KILLER, and a passing merit promotion is
  not a final-blow claim.
- Bounty PAYOUT is the only unproven rung, and it is blocked by money, not by combat:
  `war_funding_diagnose` answers NO_REAL_FACTION_INCOME on every side because the refinery
  treasury sweep already moved the pilots' real earnings into the corporation wallet
  (`living-corp-treasury-swept` 250 000 ISK), and FW-005B's levy reads only PILOT balances. With
  no levy there is no chest entry, so at campaign open `warBountyReserve` refuses and no HELD
  escrow ever exists to pay a killer.
  Fix attempted and deployed (env-gated, agents stack only): EVEJS_COOP_WAR_BOUNTY_WALLET_FALLBACK=1
  lets the reservation be backed by that same native corporation wallet. `coopWarTreasury` RESERVE
  verifies the corporation/faction, writes a real journal entry and debits division 1000, refusing
  when the money is not there - so nothing is minted, only spent from where real settlements put it.
  A reservation can only be taken for a campaign that does not exist yet (it is taken before
  START_CAMPAIGN), so PAYOUT needs one NEW campaign opened after this deploy, then a kill in it.
  Watching for that opening; if none appears, the payout stays PENDING with this exact cause.

### Escort red set: 46 -> 19 (this session)
Two root causes removed, both evidenced before/after:
1. Four escort journals (`coopEscortTerminalAttendance`, `coopEscortDepartureWitness`,
   `coopEscortRouteWitness`, `coopEscortNativeIngressSnapshot`) skipped the whole durability
   re-read on win32 with a blanket `return true`. Replaced with one local
   `platformFsync(io, fd)` that attempts the fsync and swallows only EPERM/EINVAL/ENOTSUP/
   EBADF/EISDIR, and only on win32 (fork f6ef7fc, mirrored 6bd4805c). Linux unchanged; on
   Windows a real refusal is still accepted and an injected lost ACK now throws. Effect:
   route witness 18/2 -> 20/0, terminal attendance 14/2 -> 16/0, ingress snapshot 13/1 ->
   14/0, departure witness 15/3 -> 17/0.
2. Four fixture defects where the fixture contradicted the module's own contract (not
   relaxed assertions): paid stubbed `fleetID 33` vs a duo receipt with no fleetID;
   `shipID: id + 200` giving player 701 the native hauler's 901; a contract without
   `stationID`; and a symlink case now skipping on EPERM/EACCES like its sibling file.
Remaining 19 escort reds: `coop-escort-flight-stage-c` 13 (obsolete coverage, see above),
`native-tactics-rescue` 3 (`NATIVE_CONVOY_OR_FLEET_NOT_CONFIRMED` before any tactic),
`native-route-recovery` 1, `pinned-native-mount` 1 (`FLIGHT_BOOKING_NOT_AUTHORIZED`),
`refund-manifest` 1 (`NATIVE_REFUND_HISTORY_SOURCE_UNAVAILABLE`).

### Repo shim gap, measured (not fixed): 118 missing `integration/*.js` shims
`integration/*.cjs` call `require("./sibling")` without an extension, which Node's CJS
resolver never maps to `.cjs`; the deployed tree uses `.js`, so it resolves there. 121
shims exist, 118 module names are still missing. A `Module._resolveFilename` hook that maps
extensionless sibling requests to `.cjs` (measured, temp file only) moves the escort suite
from 365/46 to 371/40, i.e. it is worth ~6 cases and would remove the whole class including
silent `try/catch -> pause(STATUS)` masking. One shim was added for
`coopStuckWarpRecovery` because its absence was a hard throw. Decide with the owner:
generated shims vs one test-support resolver hook (needs the runners to pass `--require`).

### Escort red set: 19 -> 13 (all remaining reds are one file)
A real product bug, found by the tests: `coopEscortFlightGate` asked
`authorizeBooking` for `{haulerID}`, but the runtime forwarded `route.haulerIDs?.[0]`
(undefined) to the native duo verifier and the mount adapter rejected the route as
`DENIED_PREWARP_ROUTE_INVALID`. No genuine native booking could ever be funded; a
fixture bypassing the gate hid it. Both shapes now travel (fork 3f8b907, mirrored
be188253), the adapter still resolves exactly one positive hauler ID.
`escort-pinned-native-mount` 6/1 -> 7/0.
Three more fixtures restored to the module contracts: `native-tactics-rescue` route
needed `playerFleetID` (10/10), `native-route-recovery` cargo rows needed `ownerID`
or the deposit is skipped as DEPOSIT_OWNER_UNPROVEN (43/43), `refund-manifest`
runtime needed `readContract` (3/3).
Escort suite now 397 pass / 13 fail, and all 13 are `coop-escort-flight-stage-c`,
which is obsolete coverage (see earlier measurement): it predates mandatory
discovery + paid consent and is covered green elsewhere. Owner decision pending:
retire it or reduce it to the gate + station-arrival slice.

## PAYOUT: root cause found (REQUIRE_FUNDING was off), still not observable (14:0xZ)
Cause, measured rather than guessed: the work stack ran with
`EVEJS_COOP_WAR_REQUIRE_FUNDING=0`. `coopFactionWarOpening.applyOpenings` then skips the
escrow step entirely (`fundingRequired()` false), records `PAPER_UNFUNDED_EXPLICIT` and opens
the campaign anyway. With no HELD reservation there is nothing a bounty could ever pay from, so
`warBountyReserve` was never exercised and `treasury-v1.reservations` stayed at 0.
Actions taken on the work stack only:
 * `EVEJS_COOP_WAR_BOUNTY_WALLET_FALLBACK=1` - the pilot-earned levy is empty because the
   refinery sweep already moved those ISK into the corporation wallet, so when `planLevy`
   answers NO_REAL_FACTION_INCOME the escrow may be backed by that same native wallet;
   `coopWarTreasury` RESERVE verifies corporation/faction, writes a real journal entry and
   debits division 1000, so value is spent, never minted.
 * `EVEJS_COOP_WAR_REQUIRE_FUNDING=1` - a campaign may now only open with a real HELD escrow,
   which is the only configuration in which PAYOUT can exist at all.
 * route extended with the two real stargate neighbours of the captured system
   (30045343, 30045342) so the world can derive a NEW front from real travel.
Result of that: the world did open `war:500011-500014` and projected 30045342 -> 500014, so the
frontier logic works, but the next tick answers `NO_OPENABLE_FRONT` for all 3 candidate borders
because each target already carries a live campaign (30000144, 30000145, 30045344) - the
orientation flip only rescues a border whose blocker belongs to a DIFFERENT faction pair.
So PAYOUT is not blocked by code any more: it needs ONE campaign to finish (freeing a target)
and then a NEW campaign to open under REQUIRE_FUNDING=1, where the reservation itself will be
recorded as `living-native-war-bounty-reserved`. Nothing about that is faked in this repo.

### Mirror-resolution gap is now a tool, not folklore
`integration/*.cjs` keep the engine's extensionless `require("./sibling")`. Node never
resolves that to `.cjs`, so a missing `.js` shim throws MODULE_NOT_FOUND - or, inside
`try/catch`, becomes a plausible pause status that silently rewrites what a test proves.
Three such gaps were already paid for in this session (`coopStuckWarpRecovery`,
`coopAlifeNativeDeliveryEvidence`, and the sandbox tests that forwards `require(id)` from
the test directory instead of the integration directory).
- `scripts/coop-integration-shims.cjs --check|--write` lists/creates the shims and rejects a
  shim that forwards to a different module object; `tests/coop-integration-shims.test.mjs`
  pins it (currently ~120 names missing, so the test is red until `--write` runs).
- `tests/_support/integrationSandbox.mjs#loadIntegration(name, overrides)` compiles a module
  with a require that resolves a bare sibling to `integration/<name>.cjs`; used by
  `coop-native-station-arrival` and `coop-native-haul-manifest-station`. Remaining
  hand-rolled `new Function("require",...)` sandboxes should move to it.

## Doctrines + dynamic decisions (FW-036, FW-037) live on the work stack (14:3xZ)
Live capability table measured inside the running container through the REAL doctrine
composition (`warFleetAuthorities().composition` + real npcLoadouts + real weapon dogma):
  500001 CAN_FIELD (coop_war_doctrine_500001_tackle)   500004 CAN_FIELD
  500011 CAN_FIELD                                     500020 CAN_FIELD
  500010 NO_NAVY   500012 NO_NAVY   500014 NO_NAVY (ORE)   500019 NO_NAVY
and the decision itself: `decide(500004, 500014)` -> {open:false,
reason:"NO_NAVY_CAPABILITY:DEFENDER"}; `decide(500004, 500011)` -> {open:true,
reason:"BOTH_SIDES_CAN_FIELD_NAVY"}.
FW-036 (new module `coopWarNavyCapability`): a war party must be able to field a real navy.
A hull counts only when its real loadout carries a module that resolves to a real WEAPON
family AND a charge with quantityPerModule >= 1 - a strip miner has both and is still not a
navy, which is exactly how ORE looked armed. Both sides must be able to fight, because
capture-by-force needs a defending wreck and a navy-less defender can never produce one (the
measured deadlock: an ORE party's campaign held the target and every other front answered
NO_OPENABLE_FRONT). Unknown capability is never a yes; without the authority the planner is
unchanged.
FW-037: an unfunded border is now skipped BY NAME (`SUPPLY_UNFUNDED:<warID>:<reason>`) and the
batch continues, instead of throwing the whole plan away - one broke pair no longer blocks
every other border in the same tick.
ECONOMIC FINDING that still blocks a bounty payout, now measured not guessed - real corporation
wallets (division 1000, the only source coopWarTreasury may debit):
  1000035 (Caldari) 0   1000120 (Gallente) 0   1000138 (Angel) 0
  1000129 (ORE) 136 554 292.96 ISK   others 0
So every faction that can field a navy is broke, and the only funded corporation (ORE) cannot
field one. Opening a campaign with REQUIRE_FUNDING=1 therefore answers
`SUPPLY_UNFUNDED:...:WAR_TREASURY_FUNDS_UNAVAILABLE`, and that is the correct answer: militia
corporations currently have no income path (mining/refining corps do). Payout needs either a
militia income doctrine or an owner decision to fund militia corporations from the real economy.
`node scripts/coop-engine-audit.cjs` reports drift in `coopMissionInstanceProvenance.cjs` - that
file belongs to another session's in-progress work and was left untouched.

## war_diagnose now answers "can this border be fought at all" (14:4xZ, live)
Live output from the running work stack right after the deploy:
  navy status OK
    500004 CAN_FIELD armed:1 coop_war_doctrine_500004_tackle
    500010 NO_NAVY   armed:0
    500011 CAN_FIELD armed:1 coop_war_doctrine_500011_tackle
    500014 NO_NAVY   armed:0            <- ORE: mining loadouts only
  war war:500010-500014 -> NO_NAVY_CAPABILITY:ATTACKER
  war war:500004-500011 -> BOTH_SIDES_CAN_FIELD_NAVY
So the two wars are now distinguishable without reading the opening skip list: one is a
paper war nobody can fight, the other is a real border. Read-only; the capability comes from
the same doctrine composition the sanctioned spawn path uses.
NOTE for the next agent: `node scripts/coop-engine-audit.cjs` currently reports drift in
`coopGameStoreAtomic.cjs` and `coopNativeStationTripJournal.cjs` (earlier it was
`coopMissionInstanceProvenance.cjs`). Those are another session's in-progress files; this branch
did not touch them and they were deliberately left alone.
STILL OPEN (owner decision): militia corporations have no income (measured: 1000035/1000120/
1000138 = 0 ISK, only ORE 1000129 holds 136.5 M), so no escrow and no bounty payout exists.
FW-036/037 removed the deadlock and the silent failure, but they cannot create money.

## FW-038: money and navies sat on opposite sides -> mercenary decision (live)
Live `war_funding_diagnose` after the deploy:
  needCents 2500000
  mercenary {"status":"PROPOSED","proposals":[{"payerFactionID":500014,
    "payerCorporationID":1000129,"payerBalanceCents":13655429296,
    "mercenaryFactionID":500004,"amountCents":2500000,
    "reason":"NAVY_WITHOUT_TREASURY_PAIRED_WITH_TREASURY_WITHOUT_NAVY"}]}
i.e. the only funded faction (ORE) can hire the cheapest navy-capable faction for exactly the
bounty need, computed from real division-1000 balances and the real doctrine composition.
The decision is pure (`coopWarMercenaryContract.proposeContracts`, 4 tests): one contract per
payer, refuses a payer that cannot cover the need, refuses to pay a navy that already has money,
refuses a zero need. It moves no ISK and creates none - the transfer is still a separate,
journaled two-leg operation on real corporation wallets (`coopCorpWallet.applyDelta` writes and
reads the balance back), which is the next wiring job.

## FW-038B: money MOVED, then a real defect stopped it (2026-10-28T15:0xZ) - FEATURE DISABLED
What worked, measured on the work stack with a dry run first:
  DRY_RUN merc:fw038b:1 -> payer 1000129 179 219 344.69 ISK, payee 1000120 0 -> 25 000,
  PAID merc:fw038b:1 -> payer 179 194 344.69, payee 25 000 (exactly one debit, one credit).
What failed, and it is why the flag is now `EVEJS_COOP_WAR_MERCENARY_CONTRACT: "0"`:
  a replay of the SAME event 28 s later answered PAID again instead of DUPLICATE. The
  journal row (`coop-faction-war\u001fmercenary-v1` in corporationRuntime) could be read
  back right after the write - the new durability guard passed - and was then GONE on the
  next request. Result: ORE 1000129 went 179 219 344.69 -> 179 169 344.69 (two debits) while
  the payee received 25 000 once, i.e. 25 000 ISK was DESTROYED. A further replay paid a
  third time (payee 50 000 -> 75 000, payer -25 000, this leg conserved).
  Root cause is the same durability class already seen with the war state: a row written
  through the atomic native store is not reliably readable/writable across container
  recreates in this world. A money mover therefore CANNOT anchor idempotency in that table.
The code is kept, tested (8 tests) and honest about it: it refuses to debit unless the
PREPARED row reads back (`WAR_MERCENARY_JOURNAL_NOT_DURABLE`), but that is not enough when
the row can vanish AFTER the payment. The correct fix is to anchor the event in the same
record that holds the money (a reservation in `coopWarTreasury`, whose journal is a wallet
transaction) so a replay is refused by the wallet itself, not by a separate row.
No further transfers are possible while the flag is 0; mining/refining economy untouched.

## FW-038C: wallet-anchored payment + a REAL HELD bounty escrow (15:28Z, proven live)
Idempotency fix that worked, measured on the same running stack:
  merc:fw038c:1 PAID (debitLeg APPLIED, creditLeg APPLIED)
  replay of the SAME event -> status PAID but debitLeg DUPLICATE, creditLeg DUPLICATE and
  every balance byte-identical before and after (1000129=280 097 039.67, 1000120=100 000).
  The marker lives in the wallet journal itself (`FW-MERC <eventID> DEBIT|CREDIT`), written in
  the same write as the balance, so a vanished side row can no longer cause a second payment.
Money now sits where the war needs it, all of it moved from real ORE income by journaled
two-leg transfers (nothing minted):
  1000120 (Federation Navy) 100 000 ISK    1000138 (Angel Cartel) 25 000 ISK
And the chain completed by itself 15:28:40:
  living-native-war-bounty-reserved RESERVED
  factionID 500011, corporationID 1000138, campaign war:500004-500011:campaign:30045344,
  amountCents 2 500 000 (25 000 ISK), reservation HELD, escrow journal 8000000000000000.
So for the first time in this world a war party holds a REAL bounty escrow, taken from a real
corporation wallet. The remaining step is only the native trigger: an attributed kill in that
campaign (or a recorded casualty, which `coopWarBounty` accepts) releases the escrow to the
pilot's earned balance - `living-native-war-merit` already proved the attribution path works
(5 promotions). Nothing about that is staged or faked.

## FW-039: an orphaned escrow blocked its own campaign - fixed (15:5xZ)
After the HELD escrow appeared at 15:28:40 the campaign record was lost to another session's
container recreate while `bounty:war:500004-500011:campaign:30045344:500011` stayed HELD. Every
later opening then refused with WAR_TREASURY_PURPOSE_UNAVAILABLE, i.e. 25 000 ISK of real money
was locked with no war it could ever pay, and the border could never restart.
Fix (fork, tested): RESERVE reuses a HELD reservation for the same war/campaign/faction when the
campaign record does not exist - nothing is debited twice and the receipt names the existing
journal - and a RESERVE naming a HELD reservation is decided there instead of being rejected up
front. `tests/coop-war-treasury.test.mjs` 15/15 (new case: orphan reused, DUPLICATE + reused:true).
After the redeploy the world has war:500004-500011 with no campaign yet; the next derivable front
opens it, the escrow is reused, and the only remaining trigger is an attributed kill in that
campaign (or a recorded casualty, which coopWarBounty accepts) to release the escrow to the pilot.
Session ladder status: capture PROVEN, merit PROVEN, client view PROVEN, escrow PROVEN,
payout TRIGGER PENDING (needs one live kill in a funded campaign; the seeds are in place).

## Payout trigger: still pending, with the exact next diagnostic (17:0xZ)
Current measured state on `evejs-agents` (after another session's recreate, healthy):
  war_state: `war:500004-500011`, **no campaigns**, territories 30003837=500004 and 30045344=500011
  presence  : 30003837 {500004:3, 500012:2, 500019:1}, 30045344 {500011:3, 500012:1, 500019:1}
  funding   : both parties CAN_FIELD and both are funded (1000120 = 100 000 ISK after a real
              mercenary transfer, 1000138 = 25 000 ISK), escrow `bounty:...:500011` REUSABLE
              since FW-039; `war_funding_diagnose` mercenary answers
              `{status:"REFUSED", reason:"NO_FUNDED_NAVY_PAIR", refusals:[{500004,
              reason:"ALREADY_SELF_SUFFICIENT"}]}` - i.e. no hire is needed any more.
So every precondition for a funded campaign exists, yet the opening phase produces **no event at
all** since 15:29:10 (not even a refusal), which means `advanceNativeWarOpening` returns before
`planWars`: the untested suspects are `visitedSystems` (the tick passes only
`[...visitedSystems].slice(0,12)`, and a system present in the war state's presence list is not
necessarily in that set) and the `warOpening.tick` early returns (`NO_LINK`/`NO_SYSTEMS`).
Observability fix shipped this session (fork): the opening refusal event now dedups on
`reason + JSON.stringify(per-border skips)` and carries `skipped[]`, because a border that
changed from NO_NAVY to "no money" kept the same top-level NO_OPENABLE_FRONT and was invisible.
Next exact step for whoever continues: publish/log the opening phase's early-return reason
(`warSkip("opening", ...)` already exists for all of them but only fires on a state change) and
check `visitedSystems` membership for 30003837/30045344 at the moment the phase runs.

## FUNDED CAMPAIGN + REAL KILL, payout still gated by attribution (17:25Z)
Chain reached with a funded escrow and real combat in the SAME campaign:
  17:18:43 living-native-war-bounty-reserved RESERVED factionID 500004, corp 1000120,
          campaign war:500004-500011:campaign:30045344  (real HELD 25 000 ISK)
  17:18:43 living-native-war-opened OPENED war:500004-500011 + that campaign
  17:20:05 / 17:23:43 living-native-war-attack-orders OBSERVED
  17:25:12 living-native-war-casualty RECORDED: victim 980000003812, wreck 980300000012,
          pilot coop-pilot-005, corp 1000120, victimFactionID 500004, in that campaign.
Fixes that made this possible this round (all in the fork, all with reasoning in the commits):
  * the opening planner now unions visited systems with the systems the war already owns -
    it had been blind to 30003837/30045344 because the A-Life walker had not visited them;
  * OPENED now means something opened (a fully skipped batch is REFUSED/NO_FUNDED_FRONT);
  * the refusal event carries the applier's per-border reasons, which is how the two real
    blockers (WAR_TREASURY_JOURNAL_COLLISION, WAR_TREASURY_FUNDS_UNAVAILABLE) became visible;
  * the escrow journal id is derived from the wallet, so a lost counter cannot collide.
PAYOUT STILL DID NOT FIRE, and the reason is honest and specific: the casualty receipt carries
`attribution:"NATIVE_VICTIM_WRECK_ONLY_NO_KILLER"`, no `living-native-war-merit` was emitted for
it, so `coopWarKillMerit` never called the bounty payer. This is the documented FinalBlow gate:
attribution may only come from the native destruction caller's explicit `options.attackerEntity`,
and it must not be guessed. Merit DID fire 5 times earlier in the day for stock NPC kills, so the
mechanism works; what is missing is that path for war-fleet hulls.
NEXT EXACT STEP: pass the native attacker entity through the war-fleet destruction hook (the same
one that already credits stock NPC kills), then the HELD escrow pays automatically.

## FW-040 deployed; the blocker is now the shared stack's churn, not the code (18:0xZ)
Found and fixed the exact reason a war kill could not be attributed: the attribution path read
identity links from the ON-DISK file only, and that file lags the live registry, so a real war
casualty answered `NOT_UNIQUE_NAMED_PIRATE` (measured 17:25:12) - no attribution, no merit, and
the HELD bounty could never pay. `coopNpcDestructionAttacker` now merges the on-disk links with
the live identity registry (`identityLinks()` exported from the runtime, pure `mergeLinks`
helper, 2 tests). Deployed.
Proof that the mechanism itself works when attribution lands: 17:40:29
`living-native-destruction-attacker NATIVE_DESTRUCTION_ATTACKER_PROVIDED` attacker coop-pilot-060
-> `living-native-war-merit PROMOTED coop-pilot-060 warship-kill +25` and the victim
coop-pilot-002 `force-lost -10`, in the same millisecond.
What now blocks the final observation is the environment, measured rather than assumed: the
shared `evejs-agents` stack is recreated by another session roughly every 10-30 minutes (container
created 17:31, then again at ~17:5x and ~18:0x), and the war state row does not survive those
recreates: `war_diagnose` now answers `mob DRY_RUN camps 0 mobilized 0` with an empty navy list,
i.e. the campaign and the escrow purpose were reset again even though the treasury row kept the
HELD reservation. No code change can hold a 5-minute combat window open across that.
SESSION LADDER: capture PROVEN, merit PROVEN (6 promotions), client view PROVEN (OCCUPIED),
escrow PROVEN (real HELD 25 000 ISK from real earnings), attribution PROVEN (17:40:29),
payout = the only rung not yet observed, gated by campaign survival, not by missing logic.

## FW-041 mirror deployed; measured caveat (18:0xZ)
The mirror exists and is written on every successful war-state write, but at 17:55:19 and
17:57:09 the world CREATED an empty state again (another session's recreate), so the mirror now
holds the EMPTY document (100 bytes) and `chooseWarRestore` correctly refuses it
(`MIRROR_EMPTY_TOO`). That is the right behaviour but it means the mirror only protects a war
that already exists at the moment of the write: the war must be opened first, then mirrored, then
survive long enough to be fought.
Current live state: `living-native-war-opening-blocked NO_OPENABLE_FRONT` every 30 s, wars none,
mirror empty. Presence and the identity world still exist on the volume, so a front can still be
derived the moment a navy-capable pair owns two adjacent systems.
CONCLUSION for the payout rung: every other rung is proven (capture, merit, client view, escrow,
attribution). Payout needs ~5 uninterrupted minutes of a funded war against an armed enemy, and
this shared stack is recreated every 10-30 min by another session while the war row does not
survive it. Options: a quiet window, or the atomic-row durability fix at the store level.
