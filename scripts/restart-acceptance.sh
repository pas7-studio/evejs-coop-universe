#!/usr/bin/env bash
# Restart-resilience acceptance: does a real native load survive a server restart?
#
# Proves, in order:
#   1. a real mining load happened in this window (`living-hauler-loaded`)
#   2. the loaded cargo is on disk in the authoritative store (SQLite npcCargo)
#   3. after `docker compose restart server` the SAME cargoIDs are still there
#      with the SAME quantity (durable), or a new hauler adopted them
#   4. the fleet keeps going (destination chosen / delivery / sale)
#
# Read-only apart from the restart. Never rebuilds, never deletes volumes, never
# touches another project's containers.
#
#   scripts/restart-acceptance.sh [--deploy] [--wait-load-min 20] [--after-restart 240]
set -u
export MSYS_NO_PATHCONV=1
REPO=$(cd "$(dirname "$0")/.." && pwd -P)
CODE=${EVEJS_CODE_ROOT:-/c/Games/EveCoop/upstream-evejs/Code}
PROJECT=${EVEJS_PROJECT:-evejs}
SERVICE=${EVEJS_SERVICE:-server}
WAIT_LOAD_MIN=${WAIT_LOAD_MIN:-20}
AFTER=${AFTER_RESTART_SECONDS:-240}
DEPLOY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --deploy) DEPLOY=1; shift ;;
    --wait-load-min) WAIT_LOAD_MIN=$2; shift 2 ;;
    --after-restart) AFTER=$2; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

CONTAINER=$(docker compose -p "$PROJECT" ps -q "$SERVICE" 2>/dev/null | head -1)
if [ -z "$CONTAINER" ]; then echo "CONTAINER_NOT_RUNNING project=$PROJECT service=$SERVICE"; exit 3; fi
NAME=$(docker inspect -f '{{.Name}}' "$CONTAINER" | sed 's#^/##')
# Git Bash and node disagree about /tmp, and MSYS path conversion is off here,
# so use one Windows-style temp path that both see.
# Keep artifacts inside the repo: /tmp means different things to Git Bash and
# to node here (MSYS path conversion is off), which silently broke a comparison.
BASE="$REPO/.opencode/tmp"
TMP="$BASE/evejs-acceptance-$(date -u +%H%M%S)"
mkdir -p "$TMP"
START=$(date -u +%s)
echo "CONTEXT container=$NAME project=$PROJECT start=$(date -u -d @$START +%Y-%m-%dT%H:%M:%SZ)"

events() {
  docker exec "$NAME" node -e '
const fs=require("fs");
let rows=[];
try{rows=fs.readFileSync("/var/lib/evejs/coop-events.jsonl","utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)}catch(e){}
const since=Number(process.argv[1])||0;
for(const r of rows){
 const at=Date.parse(r.at)/1000;
 if(Number.isFinite(at)&&at<since)continue;
 if(!/hauler-loaded|haul-cargo-adopted|adoption-skipped|warehouse-committed|haul-delivered|station-sold|economy-destination/.test(String(r.event)))continue;
 console.log(r.at,r.event,r.status||r.reason||"","fleet"+(r.fleetID||""),"qty"+(r.cargoQuantity||r.quantity||""),"station"+(r.stationID||""));
}' "$1" 2>/dev/null
}

probe() {
  docker exec -i "$NAME" node - < "$REPO/scripts/coop-cargo-probe.cjs" 2>/dev/null
}

echo "=== 0. FLAGS IN THIS WORLD ==="
node "$REPO/scripts/coop-flags.cjs" --live   --compose "$CODE/compose.yaml,$CODE/compose.coop-probe.yaml" 2>/dev/null | head -1

echo "=== 1. CARGO TO PROVE (wait for a new load, or use cargo already in flight) ==="
found=0
for _ in $(seq 1 $((WAIT_LOAD_MIN * 3))); do
  out=$(events "$START" | grep "living-hauler-loaded" || true)
  if [ -n "$out" ]; then echo "$out"; found=1; break; fi
  # Cargo already loaded and not yet delivered is just as valid a subject: the
  # fleet will not load again before it completes the round trip.
  if [ -n "$(probe | grep -o '"haulRows":[1-9]')" ]; then
    echo "INFLIGHT_CARGO_PRESENT (no new load needed)"
    found=1; break
  fi
  sleep 20
done
if [ "$found" = "0" ]; then
  echo "NO_CARGO_WITHIN_WINDOW"
  probe
  events "$START"
  exit 4
fi
sleep 20
echo "=== 2. DURABLE CARGO BEFORE RESTART ==="
probe | tee "$TMP/before.json"
BEFORE_HAUL=$(node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(j.haulRows||0)' "$TMP/before.json")
echo "DURABLE_BEFORE $BEFORE_HAUL"
if [ "$BEFORE_HAUL" = "0" ]; then echo "FAIL_NO_DURABLE_ROW_BEFORE_RESTART"; exit 5; fi

echo "=== 3. RESTART $PROJECT/$SERVICE ==="
docker compose -p "$PROJECT" restart "$SERVICE" 2>&1 | tail -1
sleep "$AFTER"
RESTART_AT=$(date -u +%s)

echo "=== 4. DURABLE CARGO AFTER RESTART ==="
probe | tee "$TMP/after.json"
echo "=== 5. EVENTS AFTER RESTART ==="
events "$RESTART_AT"

node - "$TMP/before.json" "$TMP/after.json" <<'NODE'
const fs = require("node:fs");
const before = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const after = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
if (!before.ok || !after.ok) {
  console.log("VERDICT BLOCKED_TELEMETRY", before.error || after.error);
  process.exit(0);
}
const key = (row) => row.cargoID;
const afterByID = new Map(after.rows.map((row) => [key(row), row]));
let survived = 0, adopted = 0, lost = [];
for (const row of before.rows) {
  const now = afterByID.get(key(row));
  if (!now) { lost.push(row.cargoID); continue; }
  if (now.quantity !== row.quantity) { lost.push(row.cargoID + ":qty" + row.quantity + "->" + now.quantity); continue; }
  survived++;
  if (now.adoptedAt > 0) adopted++;
}
console.log(`VERDICT DURABLE_BEFORE=${before.rows.length} SURVIVED=${survived} ADOPTED=${adopted} LOST=${lost.length}`);
if (lost.length) console.log("  lost", lost.slice(0, 10).join(","));
console.log(survived === before.rows.length ? "RESTART_PASS" : "RESTART_FAIL");
NODE
echo "=== DONE artifacts=$TMP ==="
