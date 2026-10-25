# Stage J — paid rescue lifecycle recovery after native pickup

This hotfix is based on the current main (PR #96 and PR #100 merged; older #116 was closed without merge and overlapping Stage J modules are already in main).

## Confirmed breakage in current main

The immutable original salvage witness is created before physical PICKUP. The stock native-atomic transfer then removes the wreck item from `npcWreckItems` and installs an authentically source-tagged player item + persistent `coopSalvageMoves` receipt in one SQLite transaction.

But `coopSalvageNativeOffers.readOffer` used to require the physical wreck item for **every** subsequent command. After PICKUP, `/events salvage ... deliver` could no longer resolve its own offer; independent `coopSalvageNativeRewards.quote` also called `coopSalvageNativeConsent.readDuo`, which re-read the same live wreck requirement and therefore refused payout. The native funds would remain reserved despite valid delivery.

## Fix

- Strict `readOffer(manifestKey)` still refuses new offers or fresh acceptance unless every original cargo row remains in the actual native wreck. An NPC rival or any prior pickup therefore blocks new corporate escrow.
- Internal `readOffer(manifestKey,{allowStarted:true})` validates the immutable original manifest, fsynced provenance receipt, NPC corporation, original real convoy event, real two-pilot volunteer evidence, actual hauler-loss source, and the original fixed quote amount, but deliberately does not demand those physically MOVED items still be in wreck.
- `coopSalvageNativeConsent.readDuo` FIRST verifies that a durable signed duo receipt already exists, THEN checks historical source terms. `accept` continues to use the strict unstarted source. Missing pair always fails closed.
- `coopSalvageGameAuthority` switches to accepted terms only for PICKUP, DELIVER or REFUND; OFFER and ACCEPT remain live-wreck-only. Delivery still requires real escrow, authenticated original pilot, real dock position, independently verified GameStore atomic item ownership and then calls the existing wallet settlement engine, which independently requires ALL original rows in the warehouse.
- Idempotent terminal wallet logic is unchanged. A replay of DELIVER with SETTLED escrow does not pay again.

## Test evidence

New `tests/coop-salvage-postpickup-settlement.test.mjs`: 8 Node test cases for fresh quote, post-pickup history, two real fsynced consents, denial of new acceptance, tampered native event, post-pickup delivery to wallet SETTLED and replay after terminal settlement.

9/9 supplemental V8 source-shaped live-path checks PASS with current GitHub sources; 4/4 changed files and test parse. The full checkout's Node test suite and two EVE client E2E are not proven by these checks; do not claim a live GO.

Flags and native SQLite transaction authority are unchanged and remain default OFF. No data/world mutation.
