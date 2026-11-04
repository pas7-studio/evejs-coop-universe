#!/usr/bin/env node
// Re-extract the client's faction-warfare frontlines map system ids.
//
// The client builds its "Occupancy changes" map from
//   res:/staticdata/warZonesPositionData.fsdbinary
// (fwwarzone/client/data/warzoneMapPositionsDataLoader.py) and indexes its own
// system table with the newest dateTaken among the states we publish. A published
// state for a system that file does not contain kills the panel with KeyError, so
// the server is restricted to exactly this id set
// (Code/server/src/space/coopFwFrontlineMapSystems.js in the fork).
//
// Usage:
//   node scripts/coop-fw-frontline-ids.mjs                 # verify the fork copy
//   node scripts/coop-fw-frontline-ids.mjs --dump          # print the id list
//   node scripts/coop-fw-frontline-ids.mjs --file <path>   # explicit resfile
//
// Exit code 0 = in sync, 1 = drift or unreadable file.
import fs from "node:fs";
import path from "node:path";

const MIN_ID = 30_000_000;
const MAX_ID = 30_999_999;
const DEFAULT_FILE = "W:/EVE Online - 3396210/ResFiles/9b/9bb1f9a5fd7397d9_76076130da97b1175b77f8d6e5c8ec0a";
const FORK_ROOT = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";

function parseArgs(argv) {
  const args = {dump: false, file: DEFAULT_FILE, help: false};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dump") args.dump = true;
    else if (argv[i] === "--file") args.file = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

export function extractFrontlineSystemIds(file) {
  const buffer = fs.readFileSync(file);
  const ids = new Set();
  for (let offset = 4; offset + 4 <= buffer.length; offset += 4) {
    const value = buffer.readInt32LE(offset);
    if (value >= MIN_ID && value <= MAX_ID) ids.add(value);
  }
  return [...ids].sort((left, right) => left - right);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("node scripts/coop-fw-frontline-ids.mjs [--dump] [--file <resfile path>]");
  process.exit(0);
}

let ids;
try {
  ids = extractFrontlineSystemIds(args.file);
} catch (error) {
  console.error(`cannot read ${args.file}: ${error.message}`);
  process.exit(1);
}

if (args.dump) {
  console.log(JSON.stringify(ids));
  process.exit(0);
}

const modulePath = path.join(FORK_ROOT, "Code/server/src/space/coopFwFrontlineMapSystems.js");
const forkModule = await import(`file://${modulePath.replace(/\\/g, "/")}`);
const expected = forkModule.FRONTLINE_MAP_SYSTEM_IDS;
const missing = ids.filter((id) => !expected.includes(id));
const extra = expected.filter((id) => !ids.includes(id));

console.log(`client file: ${ids.length} ids`);
console.log(`fork module: ${expected.length} ids`);
if (missing.length || extra.length) {
  console.error(`DRIFT missing=${missing.slice(0, 10).join(",") || "-"} extra=${extra.slice(0, 10).join(",") || "-"}`);
  process.exit(1);
}
console.log("FRONTLINE_IDS_OK");
