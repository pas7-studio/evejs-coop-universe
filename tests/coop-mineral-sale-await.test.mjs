import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Measured on the work stack 2026-10-28: every sale in the world's history was ORE
// (types 17464, 1228, 1230) and never a single mineral, while the refinery kept
// producing them and one hauler hold held 47 lift-tagged rows. The lift is async and
// its Promise was read as a result, so no mineral type ever joined sellTypes and the
// trader answered NO_REAL_NATIVE_CARGO.
const fork = path.join("C:", "Games", "EveCoop", "upstream-evejs", "Code", "server", "src", "space",
  "coopVirtualWorldRuntime.js");
const present = fs.existsSync(fork);
const source = present ? fs.readFileSync(fork, "utf8") : "";

test("the mineral lift is awaited before the sale is priced", { skip: !present }, () => {
  const liftAt = source.indexOf("loaded=await ensureMineralLift()?.lift({systemID,stationID,haulerID,");
  const wantedAt = source.indexOf("const wanted=[...new Set(sellTypes.filter(typeID=>");
  assert.ok(liftAt > 0, "the lift must be awaited");
  assert.ok(wantedAt > liftAt, "the sale list must be built after the lift really finished");
  assert.ok(!/loaded=ensureMineralLift\(\)\?\.lift\(/.test(source),
    "a Promise must never be read as a lift result");
});

test("the lifted mineral types join the sale list", { skip: !present }, () => {
  assert.ok(source.includes('if(loaded&&loaded.status==="LIFTED")'));
  assert.ok(source.includes("if(!sellTypes.includes(typeID))sellTypes.push(typeID);"));
  assert.ok(source.includes("liftedTypes.add(typeID);"));
});

test("an arrival with nothing sellable is still reported", { skip: !present }, () => {
  assert.ok(source.includes('if(!wanted.length)last="NO_ALLOWED_ORE";'));
});
