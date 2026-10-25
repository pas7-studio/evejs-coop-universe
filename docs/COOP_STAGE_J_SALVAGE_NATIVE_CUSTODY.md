# EveJS Stage J — native salvage cargo identity and atomic custody

## Status
Draft, based on PR #100, **not live**. Current main, other simultaneous open PR #96, pinned upstream and evejs-data untouched. All flags default OFF.

## Source-backed code
- `integration/coopSalvageProvenance.cjs`: validates unchanged original FSYNCED hauler manifest, authentic stock native wreck source, exact original cargoID/type/quantity linked to a unique wreckItemID, and zero duplicate original cargo in hauler or NPC warehouse. FSYNCs a unique immutable record before allowing rescue navigation.
- `integration/coopEscortRescueNavigation.cjs`: the real rescue move now requires the provenance witness to match all original wreck items, beyond matching item type. If actual pinned NPC wreck destruction omits cargo source IDs, this returns RESCUE_SALVAGE_WITNESS_NOT_VERIFIED rather than offering fake salvage.
- `integration/coopSalvageAtomicCustody.cjs`: generic native transaction gate requires a *single* host-provided atomic source wreck debit + destination warehouse credit, plus independently replayable durable dual custody evidence. No fallback to grantItemToCharacterLocation followed by an unsafe non-atomic wreck removal; any uncertainty blocks settlement. Repeated move after crash returns native receipt instead of recredit.
- Original pinned reversible installer registers both Stage J modules, without removing concurrent A-Life, NPC weapons or industry.
- `tests/coop-salvage-native-provenance.test.mjs`: 9 authored Node cases for original witness, crash/restart, misattributed same-type cargo, duplicate cargo and corrupt storage.
- `tests/coop-salvage-atomic-custody.test.mjs`: 6 authored Node cases for native atomic debit/credit receipt, repeat delivery and crash, bad receipt and flag OFF.

## Unfinished necessary native integration — explicit blockers
The pinned upstream `nativeNpcWreckService` does not guarantee a durable sourceCargoID on NPC hauler wreck drops, and its generic `transferNativeWreckItemToCharacterLocation` gives destination items before attempting to remove wreck items. Therefore a native provider with genuine atomic GameStore source debit/destination credit is essential; the Stage J custody module **deliberately does not claim** an atomic provider is mounted. Without that, there is no authorized salvage delivery, NPC salvage-funding contract, player rescue payout, or A-Life NPC competitor collecting that exact stock. Do NOT offer payment or advertise rescuable source goods when this evidence is absent.

The following requested parts are NOT YET IMPLEMENTED and should be tracked for a subsequent patch: native wreck materializer original cargo custody and persistent IDs, stock GameStore dual transfer transaction, salvage delivery/escrow/payout state machine, NPC-generated dynamic rescue contracts with actual corporate cash, physically competing native salvage NPCs, post-rescue reputation and market restoration, real two-EVE-client E2E, original source tests on pinned world, and rebasing/merging Draft PR #96 and #100. All require fail-closed identity, source and idempotency tests.

## Local preflight
Run Node 22 from an isolated checkout:
    node --test tests/coop-salvage-native-provenance.test.mjs tests/coop-salvage-atomic-custody.test.mjs
    node --test tests/coop-escort-*.test.mjs

Do NOT point storage or tests at populated evejs-data. The executable current-source Node tests were authored but not run in this turn. Source shape and JS syntax may be checked in tool runtime; do not mistake them for real game E2E.

Flag opt-in only on disposable test data, after implementation:
    EVEJS_COOP_SALVAGE_PROVENANCE=1
    EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER=1

No live gameplay PASS or production merge.
