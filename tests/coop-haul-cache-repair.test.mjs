import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// MEASURED 2026-11-05 on the owner's live stack: once the refusal named its clause, every
// blocked ore fleet said "cached_quantity_differs" - the durable cargo row and the miner
// entity's display copy disagreed, and the strict check refused for ever. The durable table is
// the authority (the same function verifies it row by row), so a stale copy must be repaired
// from it; every real integrity failure must still refuse.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = fs.readFileSync(
  path.join(forkRoot, "Code/server/src/space/coopNativeHaulCargo.js"), "utf8");
const validation = source.slice(source.indexOf("const cargoIDCounts=new Map();"),
  source.indexOf("cargo.push({item,volume:"));

test("a stale entity copy is repaired from the durable row, not refused", () => {
  assert.doesNotMatch(validation, /conflict\("cached_item_missing"\)/);
  assert.doesNotMatch(validation, /conflict\("cached_type_differs"\)/);
  assert.doesNotMatch(validation, /conflict\("cached_quantity_differs"\)/);
  assert.match(validation, /Object\.assign\(local,cacheRowFromStoreRow\(item\)\)/,
    "an existing but stale copy is overwritten from the durable row");
  assert.match(validation, /miner\.nativeCargoItems\.push\(cacheRowFromStoreRow\(item\)\)/,
    "a copy the entity did not have at all is added back");
  assert.match(validation, /repairedCargoRows\+=1/, "the repair is counted");
});

test("real integrity failures still refuse", () => {
  for (const clause of ["wrong_entity", "wrong_owner", "fitted_module_row", "transient_row",
    "not_an_ore_category", "stale_fleet_flag", "cargo_id_not_unique"]) {
    assert.ok(validation.includes(`conflict("${clause}")`), `clause ${clause} still refuses`);
  }
});

test("the repair is announced once per fleet and window, never silently", () => {
  assert.match(source, /safeObserve\(probe,"living-haul-cache-repaired"/);
  assert.match(source, /DURABLE_CARGO_ROW_IS_AUTHORITATIVE_OVER_THE_ENTITY_COPY/);
  const observeIndex = source.indexOf('safeObserve(probe,"living-haul-cache-repaired"');
  const gateIndex = source.indexOf("const repairGate=gateBlockNotify(");
  assert.ok(gateIndex > 0 && gateIndex < observeIndex,
    "the announcement goes through the same fleet+reason suppression gate");
});
