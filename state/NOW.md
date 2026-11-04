# COOP STATE 2026-11-04T16:22:50.556Z
rev 93fd94d0 | pin c3ea396b | overlay WRONG_PIN

## TESTS
807 files / 7015 pass / 14 fail / 84 skip | baseline REGRESSION
REGRESSION coop-career-goals.test.mjs
REGRESSION coop-client-contract-payloads.test.mjs
REGRESSION coop-fleet-slot-recompose.test.mjs
REGRESSION coop-integration-shims.test.mjs
REGRESSION coop-native-durable-slot-heal.test.mjs

## GATES
telemetry events 5000
client logs 3 file(s)

## LAST RUN
runId 20261104-162250 | note 2026-11-04 late: <token> gates unfrozen; campaign presenting character; durable log; noconsole in both launchers
server events 5000 (living-haul-custody-blocked, living-native-weapon-event, living-native-activity, living-haul-approach-issued, living-haul-empty-retry) | client log files 0

## NEXT
Owner: relaunch via Play.bat and confirm noconsole in the exefile command line; then FM map, corp-wallet sale, injector, campaign issued-by row. Remaining red: coop-fleet-slot-recompose + coop-native-

## READ
state/digests/20261104-162250.md | state/ledger.json
docs/DEVELOPMENT_DOCTRINE.md | docs/GAMEPLAY_TESTING.md
