#!/usr/bin/env bash
# P0 isolated native NPC ammunition durability checks. NO CI, no production data.
set -euo pipefail
here="$(cd -- "$(dirname -- "$0")" && pwd)"
cd -- "$here/.."
if [ "$(node -p 'process.platform')" != "linux" ]; then
 echo "NPC_AMMO_POSIX_REQUIRED: run with Node 22+ inside Linux/WSL2, not Windows Node" >&2
 exit 2
fi
version="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$version" -lt 22 ]; then
 echo "NPC_AMMO_NODE_22_REQUIRED" >&2
 exit 2
fi
node --test \
 tests/coop-npc-strict-ammo.test.mjs \
 tests/coop-npc-durable-ammo-debit.test.mjs \
 tests/coop-npc-ammo-journal-audit.test.mjs \
 tests/coop-npc-ammo-posix-crash.test.mjs \
 tests/coop-npc-atomic-weapon-bank.test.mjs \
 tests/coop-npc-fire-outcome-witness.test.mjs \
 tests/coop-npc-atomic-sqlite-crash.test.mjs \
 tests/coop-npc-atomic-sqlite-audit.test.mjs \
 tests/coop-npc-fire-debit-source.test.mjs \
 tests/coop-gamestore-atomic.test.mjs
# Also verify the real scratch SQLite -> POSIX full-sync -> outcome path.
node scripts/bench-coop-npc-atomic-outcome.cjs --iterations=5 --warmup=0 --barrels=2
if [ "$#" -gt 1 ]; then
 echo "Expected zero or one explicit disposable Code directory" >&2
 exit 2
fi
if [ "$#" -eq 1 ] && [ -n "$1" ]; then
 if [ ! -d "$1" ]; then
  echo "NPC_AMMO_DISPOSABLE_CODE_PATH_MISSING" >&2
  exit 2
 fi
 # Dry-run only. The actual live upstream Code and Docker volume are untouched.
 node scripts/patch-evejs-coop.cjs --dry-run --code-path "$1"
fi
echo "NPC_AMMO_TARGETED_TESTS_PASS (native two-client gameplay NOT accepted)"
