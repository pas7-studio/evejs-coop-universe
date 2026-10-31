# COOP STATE 2026-10-31T17:52:51.905Z
rev 244e340c | pin c3ea396b | overlay WRONG_PIN

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
runId 20261031-175251 | note Gateway notices: sequencing Started/Completed, title, component purchase, skin licence, daily-goal progress. All measured on evejs-agents; play stack still one build behind.
server events 5000 (living-native-combat-damage, living-native-activity, living-world-topology, virtual-faction-patrol, virtual-world-presence) | client log files 3

## NEXT
Restart the play stack in an owner window, then confirm in-client. War suite was not re-run: node --test tests/coop-war-*.test.mjs did not finish in 15 min.

## READ
state/digests/20261031-175251.md | state/ledger.json
docs/DEVELOPMENT_DOCTRINE.md | docs/GAMEPLAY_TESTING.md
