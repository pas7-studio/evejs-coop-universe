#!/usr/bin/env bash
# Loop gate: the suites that must be green before any build that touches the
# mining -> hauler -> station -> sale path. Manual and local only (no CI).
#
#   scripts/coop-loop-gate.sh [--code-path <EveJS/Code>]
#
# Without --code-path it runs only the repo-side suites; with a checkout it also
# runs the structural overlay gates (require resolution, isolated real-engine
# GameStore gate), which need a pinned tree.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd -P)
CODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --code-path) CODE=${2:-}; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

cd "$REPO" || exit 1
FAILED=0
run() {
  local label=$1; shift
  if "$@" > /tmp/coop-loop-gate.out 2>&1; then
    echo "PASS $label"
  else
    echo "FAIL $label"
    tail -20 /tmp/coop-loop-gate.out | sed 's/^/     /'
    FAILED=1
  fi
}

run "mining-activate"        node --test tests/coop-mining-activate.test.mjs
run "capacitor-gate"         node --test tests/coop-mining-capacitor-gate.test.mjs
run "mining-trace-shape"     node --test tests/coop-mining-trace-shape.test.mjs
run "mining-target-guard"    node --test tests/coop-mining-target-guard.test.mjs
run "mining-startup-retry"   node --test tests/coop-mining-startup-retry.test.mjs
run "mining-atomic"          node --test tests/coop-native-mining-atomic.test.mjs
run "mining-atomic-blocking" node --test tests/coop-native-mining-atomic-blocking.test.mjs
run "mining-conservation"    node --test tests/coop-native-mining-cycle-conservation.test.mjs
run "mining-contract"        node --test tests/coop-mining-cycle-transient-isolation.test.mjs
run "cargo-isolation"        node --test tests/coop-native-cargo-transient-isolation.test.mjs
run "haul-atomic"            node --test tests/coop-native-haul-transfer-atomic.test.mjs
run "haul-physical"          node --test tests/coop-native-haul-transfer-physical.test.mjs
run "haul-routing"           node --test tests/coop-native-haul-atomic-routing.test.mjs
run "haul-load"              node --test tests/coop-haul-load-verification.test.mjs
run "haul-unload"            node --test tests/coop-native-haul-unload-readback.test.mjs
run "gamestore-atomic"       node --test tests/coop-gamestore-atomic.test.mjs
run "fleet-durable"          node --test tests/coop-native-mining-fleet-durable.test.mjs
run "mining-cargo-integrity" node --test tests/coop-native-mining-cargo-integrity.test.mjs
run "module-coverage"        node --test tests/coop-installer-module-coverage.test.mjs
run "require-style"          node --test tests/coop-overlay-require-style.test.mjs
run "hook-requires"          node --test tests/coop-hook-requires.test.mjs
run "hook-inventory"         node --test tests/coop-hook-inventory.test.mjs
run "deploy-reset-list"      node --test tests/coop-deploy-reset-list.test.mjs
run "overlay-l1-baseline"    node --test tests/coop-overlay-l1-baseline.test.mjs
run "fleet-composition"      node --test tests/coop-fleet-composition.test.mjs
run "fleet-audit"           node --test tests/coop-fleet-audit.test.mjs
run "loop-verdict"           node --test tests/loop-verdict.test.mjs

if [ -n "$CODE" ]; then
  run "hook-requires(code)"  node scripts/coop-hook-requires.cjs --checkout "$CODE"
  run "flags"                node scripts/coop-flags.cjs
  run "isolated-gamestore"   node scripts/Verify-Coop-GameStore-Atomic-Isolated.cjs --code-path "$CODE"
fi

if [ "$FAILED" -eq 0 ]; then echo "LOOP_GATE_PASS"; else echo "LOOP_GATE_FAIL"; fi
exit "$FAILED"
