# COOP Escort Stage E — Native runtime binding

Status: DRAFT, all feature flags OFF. No Docker, main merge, live NPC or evejs-data mutation.

## Root integration defect

The physical station director already accepted an escortGate constructor argument, but the real getRuntimeDirector() never passed one. Even after Stage A/B/C existed, switching on the paid convoy flag always blocked the first warp with ESCORT_ROUTE_GATE_UNAVAILABLE.

## Stage E implementation

- coopEscortNativeBinding.cjs installs one stable, default-OFF, server-only route gate in the physical director. An uninstalled native authority returns ESCORT_NATIVE_RUNTIME_NOT_INSTALLED and NEVER attempts a debit or warp. Late trusted server binding works with the existing director reference. A second mount cannot switch to a different wallet mid-trip.
- coopEscortNativeMount.cjs composes the actual pinned EveJS gameStore.coopAtomicNativeRows, NPC corporation State, native NPC cargo store, itemStore, stock authenticated sessions, EVE FleetRuntime, native scenes, immutable manifest, genuine combat incidents and native cargo outcome journals. The native source calls never fabricate money, inventory or a fleet.
- It REQUIRES trusted in-server readAuthorizedOffer, readPilotConsent and readNativeFailure callbacks. The server source offer must match the immutable manifest, NPC corporation/ship, contract ID, fixed budget and two real player character IDs. Two independent durable player consents plus verified stock EVE fleet/physical ships are needed before a native corporate debit.
- After complete physically observed warehouse delivery, the native station director calls settleVerifiedNativeRaid by immutable manifest. The gate accepts exactly one actual PIRATE_WRECK_CONFIRMED incident with matching two characters and native pirate wreck. Missing or ambiguous evidence never pays. The station can return DELIVERED with an explicit separate escortSettlementStatus, never inventing a paid flag.
- The pinned reversible overlay installer now copies the binding and mount modules, preserving native source ownership. No upstream fork, credentials, dependencies, deployment or Github CI.

## Operator flags (leave OFF now)

EVEJS_COOP_ESCORT_CONTRACTS=1
EVEJS_COOP_ESCORT_ROUTE_GATE=1
EVEJS_COOP_NATIVE_HAUL_MANIFEST=1
EVEJS_COOP_NATIVE_ATOMIC_ROWS=1
EVEJS_COOP_NATIVE_ESCORT_WALLET=1
EVEJS_COOP_ESCORT_RUNTIME_MOUNT=1

Do not enable these based only on unit tests.

## Remaining exact P0 gameplay blockers

1. Pre-departure player offer and consent lifecycle. PR #81 only advertises a convoy AFTER EN_ROUTE; players cannot voluntarily accept it before escrow/warp. Add genuine native PREPARING event, two durable opt-ins, source-approved bounded NPC budget, physical route wait/retry and strict immutable trip link. A pair of merely online pilots is NOT an accepted contract. installPinnedNative refuses to auto-mount without these server authorities.
2. Provide irreversible genuine native wreck or prewarp cancellation proof for refund; unknown warp ACK or timeout must not refund.
3. Resume completion of a verified terminal journal after a crash before settlement; never repeat a money transfer without independent native wallet verification. Trigger payout when real pirate proof arrives after delivery as well as at delivery.
4. Actually verify full pinned better-sqlite3/GameStore worker and TWO authenticated EVE clients: real alerts, one shared fleet, native NPC motion and damage, exact warehouse contents, corporation debit and both character credit, wallet journals, reconnect/crash handling.
5. Run overlay --check / --dry-run / remove-reinstall byte exact tests on the actual approved pinned checkout, preserving evejs-data and the user's local changes.
6. Compose existing P0 PR #86 with separate event-board PR #81 and volunteer/reputation PR #89 without replacing concurrent installer or economy patches.

## Evidence from this development turn

- 12/12 isolated V8 tests on actual committed native binding: no install blocks route, late one-time install, genuine incident, fake/ambiguous incident blocked, terminal identity, default-OFF.
- 6/6 isolated V8 tests on actual committed native mount using an injected source-shaped provider: no consent, wrong fleet, missing active second session, unauthorized server offer, genuine pair verification.
- 10 Node binding cases and 6 Node mount cases committed, source syntax validated. Official Node runner NOT executed.
- Source syntax PASS on all modified integration modules and patch installer. No real Docker or EVE client tests here.
- PR #86 separately provided 8/8 isolated Stage A/B/C source-shaped transaction path tests, NOT live money or gameplay acceptance.

This is another substantial infrastructure gate, NOT a claim that paid escort offers are available to players in the game yet. Leave all new flags OFF until both real clients pass.
