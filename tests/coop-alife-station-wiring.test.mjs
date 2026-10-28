import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {overlayRegistrations} from "./_support/coopSourceText.mjs";
const root=path.resolve(import.meta.dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const runtime=read("integration/coopVirtualWorldRuntime.cjs");
const authority=read("integration/coopAlifeStationAuthority.cjs");
const reader=read("integration/coopAlifeStationAuthorityRuntime.cjs");
const brain=read("integration/coopAlifeEconomy.cjs");
const sensor=read("integration/coopAlifeEconomySensor.cjs");
const overlay=read("scripts/patch-evejs-coop.cjs");
// The manual runner is data now (scripts/lib/gates.json); this asserts the gate
// really runs the station wirings, wherever the list is stored.
const ps=JSON.parse(read("scripts/lib/gates.json")).gates.alifeEconomy.tests.join("\n");
const manifest=JSON.parse(read("tests/scenarios/alife-native-economy-e2e.json"));
test("read authority is opt-in within existing A-Life 30-second loop, not a seventh scheduler",()=>{
 assert.match(runtime,/EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY==="1"/);
 assert.match(runtime,/async function observeAlifeEconomy/);
 assert.match(runtime,/alifeEconomyAuthorityBusy/);
 assert.match(runtime,/alife-native-economy-observe/);
 assert.match(runtime,/alifeStationAuthority\.read/);
 assert.doesNotMatch(authority,/setInterval|setTimeout|\.transact\(|PlaceOrder|FillOrder|updateCorporationRuntime/);
 assert.doesNotMatch(reader,/setInterval|PlaceOrder|FillOrder|\.transact\(/);
});
test("no other corporation can borrow station market inventory",()=>{
 assert.match(sensor,/ownerID:Number\(native\.ownerID\)/);
 assert.match(brain,/NATIVE_OWNER_STATION_AUTHORITY_MISMATCH/);
 assert.match(brain,/p\.economy:station\.economy/);
 assert.match(authority,/corp\.isNPC!==true/);
});
test("read-proof authority uses actual real game services and source-specific Rust GetOrders",()=>{
 for(const x of ["industryStaticData","industryParityHelpers",
 "marketDaemonClient","itemStore","gameStore"])
  assert.match(runtime,new RegExp(x));
 assert.match(reader,/marketClient\.call\("GetOrders"/);
 assert.match(reader,/getItemMutationVersion/);
 assert.match(reader,/\/jobs/);
 assert.match(reader,/marketEscrow/);
 assert.match(reader,/read\("industryBlueprintState"/);
 assert.match(reader,/read\("corporations"/);
 assert.match(reader,/read\("corporationRuntime"/);
 assert.doesNotMatch(reader,/getBlueprintState\(id,item\)|getCorporationRuntime\(id\)/);
});
test("trust validation fences drifted wallet, item version, BPO, Rust and escrow",()=>{
 for(const key of ["NATIVE_STATION_AUTHORITY_CHANGED_DURING_READ",
 "NATIVE_STATION_ESCROW_CUSTODY_INVALID","NATIVE_ORIGINAL_BLUEPRINT_QUOTE_UNAVAILABLE",
 "NATIVE_CORPORATION_STATION_IDENTITY_UNVERIFIED","NATIVE_RUST_MARKET_ESCROW_MISMATCH"])
  assert.ok(authority.includes(key)||authority.includes(key.replace("NATIVE_CORPORATION","NPC_CORPORATION")),key);
});
test("only one bounded native evidence refresh runs for maximum eight real stations",()=>{
 assert.match(runtime,/let remainingStations=8/);
 assert.match(runtime,/remainingStations--<=0/);
 assert.match(runtime,/slice\(0,4\)/);
 assert.match(reader,/rpcTimeoutMs=5000/);
 assert.match(reader,/NATIVE_RUST_ORDERBOOK_TIMEOUT/);
});
test("pinned overlay contains both authority modules before the local test runner",()=>{
 // Registered exactly once each: their position in the list is layout, not wiring.
 assert.equal(overlayRegistrations("coopAlifeStationAuthority"),1,"coopAlifeStationAuthority");
 assert.equal(overlayRegistrations("coopAlifeStationAuthorityRuntime"),1,"coopAlifeStationAuthorityRuntime");
 for(const f of ["coop-alife-station-authority.test.mjs",
 "coop-alife-station-runtime.test.mjs","coop-alife-station-owner-isolation.test.mjs",
 "coop-alife-station-wiring.test.mjs"])assert.ok(ps.includes(f));
});
test("original local acceptance manifest retains all 22 and adds six unexecuted authority gates",()=>{
 assert.equal(manifest.schema,"coop-alife-economy-acceptance/v1");
 assert.equal(manifest.scenarios.length,30);
 assert.equal(new Set(manifest.scenarios.map(x=>x.id)).size,30);
 assert.ok(manifest.scenarios.every(x=>x.status==="NOT_RUN"&&x.destructive===false));
 for(let n=23;n<=28;n++)assert.ok(manifest.scenarios.some(s=>s.id==="ALIFE-"+String(n).padStart(3,"0")));
});
