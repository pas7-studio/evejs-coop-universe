# COOP STATE 2026-11-04T15:09:54.514Z
rev 857b68d6 | pin c3ea396b | overlay WRONG_PIN

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
runId 20261104-150954 | note 2026-11-04: FW map allowlist (ef26dcb), launcher noconsole (14da668), skill free-SP rebase (85ce916), corp wallet immediate sell (d4e2b20), corp-market extraction + path fix (b4c04b6/0efb78b), durable
server events 5000 (living-haul-custody-blocked, living-native-weapon-event, living-haul-approach-issued, living-haul-empty-retry, living-native-activity) | client log files 0

## NEXT
Retest on the client: FW landing map, Neocom/overview after relaunch, corp-wallet immediate sale, skill injector. Remaining audit gate: coopVirtualWorldRuntime.js 5966 lines > 4800.

## READ
state/digests/20261104-150954.md | state/ledger.json
docs/DEVELOPMENT_DOCTRINE.md | docs/GAMEPLAY_TESTING.md
