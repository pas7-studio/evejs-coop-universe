# COOP STATE 2026-11-04T15:12:18.036Z
rev 0b536b7a | pin c3ea396b | overlay WRONG_PIN

## TESTS
769 files / 6852 pass / 10 fail / 84 skip | baseline REGRESSION
REGRESSION coop-absent-state.test.mjs
REGRESSION coop-client-contracts.test.mjs
REGRESSION coop-flag-registry.test.mjs
REGRESSION coop-hook-requires.test.mjs
REGRESSION coop-installer-module-coverage.test.mjs

## GATES
telemetry events 5000
client logs 3 file(s)

## LAST RUN
runId 20261104-151218 | note 2026-11-04 late: durable server log verified across recreates, state published, 29 undeclared EVEJS flags baselined (flag registry 4/4), structures measured: 43/43 site structures deal zero damage
server events 5000 (living-haul-custody-blocked, living-native-weapon-event, living-native-activity, living-haul-approach-issued, living-haul-empty-retry) | client log files 0

## NEXT
Client retest list (FW map, Neocom/overview, corp-wallet sale, injector). Next engineering: overlay manifest for <token>, CLIENT_GAPS regeneration (262), giga-module split.

## READ
state/digests/20261104-151218.md | state/ledger.json
docs/DEVELOPMENT_DOCTRINE.md | docs/GAMEPLAY_TESTING.md
