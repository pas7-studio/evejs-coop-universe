# COOP STATE 2026-11-04T15:48:10.857Z
rev 81adcbd0 | pin c3ea396b | overlay WRONG_PIN

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
runId 20261104-154810 | note 2026-11-04: overlay installer now covers every required module; stale gates unfrozen (absent-state 404/412, gaps 216/262/11, flag baseline 492); campaign presenting character; durable log
server events 5000 (living-haul-custody-blocked, living-native-weapon-event, living-native-activity, living-haul-approach-issued, living-haul-empty-retry) | client log files 0

## NEXT
Owner: relaunch through the patched Play.bat and confirm noconsole in the process command line (the running client has none). Then FM map, corp-wallet sale, injector, campaign 'Item 0'.

## READ
state/digests/20261104-154810.md | state/ledger.json
docs/DEVELOPMENT_DOCTRINE.md | docs/GAMEPLAY_TESTING.md
