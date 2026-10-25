# Escort Contracts — Stage C: funded departure and durable arrival

Status: DRAFT, DEFAULT OFF. This PR is stacked on PR #64, #59, #40. It does not include the separate corporate wallet adapter from PR #69, nor the native convoy outcome observer from PR #53, and is not runtime/deployer enabled.

## Why split contract booking from combat

PR #64 originally requested pirateID and duoFleetID while creating a contract. In real gameplay the native pirate incident can occur after the hauler has departed. It is invalid to invent a pirate before it exists, so Stage C separates two facts:

- Pre-warp booking: exact immutable trip manifest, one native hauler, approved corporation, exactly two distinct verified character IDs, funded native corporate escrow and contract ID. No future pirate guessed.
- Post-raid binding: exactly one actual native incident, two independent player hits in one fleet, native wreck, cargo outcome and a durable terminal station delivery. Only then may the already funded contract be settled.

## Implementation

1. Existing manifest.prepare() saves all predeparture source native cargo before warp.
2. coopEscortFlightGate.fundBeforeWarp() asks a trusted server-only authorizeBooking callback to approve exactly one immutable manifest, two character IDs and the NPC budget. The module itself is not a player RPC, a wallet or a source of authorization.
3. It writes a FUNDING_PREPARED record, fsyncs file and directory, calls the injected nativeFunds.reserveAtomic exactly once, then verifies the real corporate escrow. It writes FUNDED and rechecks the native identity. Unknown results NEVER retry a potentially executed debit.
4. coopNativeStationArrival.start(), with EVEJS_COOP_ESCORT_ROUTE_GATE=1 and EVEJS_COOP_NATIVE_HAUL_MANIFEST=1, strictly requires an injected flightGate and FUNDED_BEFORE_WARP before native warp. When the flag is off, existing native route behavior remains unchanged.
5. After true physical native station approach/dwell and all immutable warehouse COMMITTED/itemStore receipts, tick() calls flightGate.recordDelivered(). DELIVERED is returned only after the resulting JSONL terminal event has been fsynced. A write failure leaves the route unresolved.
6. An independent readNativeDelivery(contract) survives process restart but rechecks the current manifest custody and reservation instead of reconstructing a flight from a timer.
7. Stage A's new attachPrefunded(contractID) accepts a later actual pirate combat contract only when readPrefunded(contract) and the existing native escrow both match; it does NOT call reserveAtomic again. Then ordinary Stage A proof still demands pirate kill, both authenticated pilots and every cargo stack before atomic Stage B payout.

The terminal record is proof of past trusted physical arrival, not a permit to mint items or pay a client directly. All path and amount identities fail closed.

## Important unresolved release blockers

- PR #69 native GameStore transaction provider must be composed and injected; this PR does not install its adapter.
- The trusted server-side offer/participant source has not been wired. Never accept character identities, contract price or paid status from an untrusted client.
- The route is still in memory. After a crash before terminal DELIVERED is fsynced, no automatic resumption, payout or false arrival is allowed.
- If the real warp order fails AFTER native funds were reserved, that escrow remains reserved and requires explicit operator reconciliation. No automatic refund is implemented. A later loss/refund PR must atomically prove unspent escrow and no payment before returning funds.
- Current full manifest verification expects exact stock to remain at the warehouse. Manufacturing that consumes it must not run before the contract is settled unless a complete durable downstream provenance chain is added.
- Gameplay still needs real SQLite worker restart tests, both player wallet clients, two-pilot damage, wreck, actual delivery and crash fault injection.
- This is one-hauler, two-pilot, 50/50 integer-ISK scope only.
- New flag remains unregistered in the live operator deployment script; do not enable the raw environment variable in production.

## Tests

Stage C regression file: tests/coop-escort-flight-stage-c.test.mjs. It tests funded-before-warp, rejected booking, missing gateway, ambiguous reservation, actual physical dwell and all warehouse receipts, corrupt/missing terminal, destroyed hauler, restart read, post-raid attachPrefunded without a second debit, payment denial for undelivered trips, and default-OFF behavior.

Manual local commands:

    node --test tests/coop-escort-flight-stage-c.test.mjs tests/coop-escort-native-contract-settlement.test.mjs tests/coop-native-haul-manifest-station.test.mjs
    node scripts/patch-evejs-coop.cjs --code-path C:\Games\EveCoop\upstream-evejs\Code --dry-run

Verified here: four modified/related CommonJS modules parse successfully in isolated V8. Full official Node runner and genuine pinned better-sqlite3/Docker/two-client gameplay are NOT VERIFIED. No live wallets, evejs-data, main or CI were touched.

## Merge order

PR #59 -> PR #64 -> this Stage C PR. Independently PR #53 must integrate PR #48; PR #69 must integrate PR #54. Combine carefully without replacing unrelated installer/A-Life/industry changes wholesale, then enable behind explicit operator testing only.
