import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {createStationOreSettlement} = require("../integration/coopNativeStationOreSettlement.cjs");
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-station-ore-"));
  const file = path.join(dir, "settlements.json");
  let audit = {status: "OK", unresolved: 0, invalid: 0};
  const receipt = {cargoID: 777, typeID: 34, quantity: 50, haulerID: 201,
    fleetID: 9, systemID: 30000144, at: 1};
  const depot = {audit: () => audit, snapshot: () => ({receipts: {777: {...receipt}}})};
  let station = {stationID: 60000111, solarSystemID: 30000144, ownerID: 1000001};
  let safeOwner = true, safeOre = true, grantCount = 0;
  const rows = [{typeID: 34, ownerID: 1000001, locationID: 60000111,
    flagID: 4, singleton: 0, stacksize: 10}];
  const inventory = {ITEM_FLAGS: {HANGAR: 4},
    listContainerItems: (owner, location, flag) => rows.filter(r =>
      r.ownerID === owner && r.locationID === location && r.flagID === flag),
    grantItemToOwnerLocation: (_owner, _station, _flag, type, quantity, options) => {
      assert.deepEqual(type, {typeID: 34});
      assert.deepEqual(options, {singleton: 0});
      grantCount++;
      rows[0].stacksize += quantity; // exercise real itemStore merging behavior
      return {success: true, data: {quantity, items: [{...rows[0]}]}};
    }};
  const create = () => createStationOreSettlement({file, depot, inventory,
    getStation: () => station, isWarehouseOwner: () => safeOwner,
    isOreType: () => safeOre, clock: () => 12345});
  const cleanup = () => fs.rmSync(dir, {recursive: true, force: true});
  return {dir, file, depot, inventory, rows, receipt, create, cleanup,
    setAudit: a => {audit = a;}, setStation: x => {station = x;},
    setOwner: x => {safeOwner = x;}, setOre: x => {safeOre = x;},
    grants: () => grantCount};
}
test("committed NPC ore is credited to native station owner once, across reopen", () => {
  const f = fixture();
  try {
    assert.equal(f.create().preview(777, 60000111).status, "READY");
    assert.equal(f.create().settle(777, 60000111).status, "STATION_STOCK_SETTLED");
    assert.equal(f.rows[0].stacksize, 60);
    assert.equal(f.create().snapshot().entries["777"].phase, "COMPLETED");
    assert.equal(f.create().settle(777, 60000111).status, "ALREADY_SETTLED");
    assert.equal(f.grants(), 1);
  } finally { f.cleanup(); }
});
test("PR20 depot audit must be OK, and no pending or invalid cargo can be minted", () => {
  const f = fixture();
  try {
    for (const audit of [{status: "PENDING_CUSTODY_RECONCILIATION", unresolved: 1, invalid: 0},
      {status: "NEEDS_OPERATOR_REPAIR", unresolved: 0, invalid: 1},
      {status: "OK", unresolved: 1, invalid: 0}]) {
      f.setAudit(audit);
      assert.equal(f.create().settle(777, 60000111).status, "CUSTODY_NOT_RECONCILED");
    }
    assert.equal(f.grants(), 0);
    assert.equal(fs.existsSync(f.file), false);
  } finally { f.cleanup(); }
});
test("wrong station/system, unverified warehouse owner and non-ore fail closed", () => {
  const f = fixture();
  try {
    assert.equal(f.create().settle(777, 60000112).status, "STATION_NOT_IN_SOURCE_SYSTEM");
    f.setStation({stationID: 60000111, solarSystemID: 30000142, ownerID: 1000001});
    assert.equal(f.create().settle(777, 60000111).status, "STATION_NOT_IN_SOURCE_SYSTEM");
    f.setStation({stationID: 60000111, solarSystemID: 30000144, ownerID: 1000001});
    f.setOwner(false);
    assert.equal(f.create().settle(777, 60000111).status, "WAREHOUSE_OWNER_UNVERIFIED");
    f.setOwner(true); f.setOre(false);
    assert.equal(f.create().settle(777, 60000111).status, "RECEIPT_TYPE_NOT_VERIFIED_ORE");
    assert.equal(f.grants(), 0);
  } finally { f.cleanup(); }
});
test("native grant mutates but throws: record remains indeterminate after restart", () => {
  const f = fixture();
  try {
    f.inventory.grantItemToOwnerLocation = (_a, _b, _c, _d, n) => {
      f.rows[0].stacksize += n;
      throw Error("lost reply after native write");
    };
    assert.equal(f.create().settle(777, 60000111).status, "NEEDS_OPERATOR_REPAIR");
    assert.equal(f.rows[0].stacksize, 60);
    assert.equal(f.create().snapshot().entries["777"].phase, "GRANT_OUTCOME_UNKNOWN");
    assert.equal(f.create().settle(777, 60000111).status, "NEEDS_OPERATOR_REPAIR");
    assert.equal(f.rows[0].stacksize, 60);
  } finally { f.cleanup(); }
});
test("reported native grant success without actual stock change never completes", () => {
  const f = fixture();
  try {
    f.inventory.grantItemToOwnerLocation = () => ({success: true, data: {quantity: 50}});
    assert.equal(f.create().settle(777, 60000111).status, "NEEDS_OPERATOR_REPAIR");
    assert.equal(f.create().snapshot().entries["777"].phase, "GRANT_OUTCOME_UNKNOWN");
    assert.equal(f.rows[0].stacksize, 10);
  } finally { f.cleanup(); }
});
test("no double-grant if concurrent invocation finds an existing durable lock", () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.file + ".lock", "operator must reconcile stale lock");
    assert.equal(f.create().settle(777, 60000111).status, "SETTLEMENT_LOCKED_NEEDS_REVIEW");
    assert.equal(f.grants(), 0);
  } finally { f.cleanup(); }
});
test("changed provenance cannot reuse previously settled cargoID", () => {
  const f = fixture();
  try {
    assert.equal(f.create().settle(777, 60000111).status, "STATION_STOCK_SETTLED");
    f.receipt.quantity = 51;
    assert.equal(f.create().settle(777, 60000111).status, "SETTLEMENT_RECEIPT_CONFLICT");
    assert.equal(f.rows[0].stacksize, 60);
    assert.equal(f.grants(), 1);
  } finally { f.cleanup(); }
});


test("strict native station grant persists one actual ore itemID and cargo marker",()=>{
 const prev=process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF;
 process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF="1";
 const f=fixture();
 try{
  let call=0;
  f.inventory.grantItemToOwnerLocation=(_owner,_station,_flag,type,qty,opt)=>{
   call++;
   assert.equal(opt.customInfo,"coop-warehouse:v1:cargo:777");
   assert.equal(opt.singleton,0);
   f.rows.push({itemID:1900000777,ownerID:1000001,locationID:60000111,
    flagID:4,quantity:qty,stacksize:qty,typeID:type.typeID,
    singleton:0,customInfo:opt.customInfo});
   return {success:true,data:{quantity:qty,items:[f.rows.at(-1)]}};
  };
  const result=f.create().settle(777,60000111);
  assert.equal(result.status,"STATION_STOCK_SETTLED");
  assert.equal(result.oreItemID,1900000777);
  assert.equal(result.sourceCustomInfo,"coop-warehouse:v1:cargo:777");
  const saved=f.create().snapshot().entries["777"];
  assert.equal(saved.phase,"COMPLETED");
  assert.equal(saved.oreItemID,1900000777);
  assert.equal(f.create().settle(777,60000111).status,"ALREADY_SETTLED");
  assert.equal(call,1);
 }finally{
  f.cleanup();
  if(prev===undefined)delete process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF;
  else process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF=prev;
 }
});
test("native grant that silently merges or ignores item provenance stays ambiguous after restart",()=>{
 const prev=process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF;
 process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF="1";
 const f=fixture();
 try{
  let calls=0;
  f.inventory.grantItemToOwnerLocation=(_a,_b,_c,_d,q,opts)=>{
   calls++;
   assert.equal(opts.customInfo,"coop-warehouse:v1:cargo:777");
   f.rows[0].stacksize+=q; // native merge: no unique itemID
   return {success:true,data:{quantity:q}};
  };
  assert.equal(f.create().settle(777,60000111).status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(f.create().snapshot().entries["777"].phase,"GRANT_OUTCOME_UNKNOWN");
  assert.equal(f.create().settle(777,60000111).status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(calls,1);
 }finally{
  f.cleanup();
  if(prev===undefined)delete process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF;
  else process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF=prev;
 }
});
test("strict original station grant refuses cargo marker already present before mutation",()=>{
 const prev=process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF;
 process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF="1";
 const f=fixture();
 try{
  f.rows.push({itemID:1900000777,ownerID:1000001,locationID:60000111,
   typeID:34,flagID:4,singleton:0,quantity:50,stacksize:50,
   customInfo:"coop-warehouse:v1:cargo:777"});
  assert.equal(f.create().settle(777,60000111).status,
   "WAREHOUSE_ORIGINAL_SOURCE_ALREADY_PRESENT");
  assert.equal(f.grants(),0);
 }finally{
  f.cleanup();
  if(prev===undefined)delete process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF;
  else process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ORE_SOURCE_PROOF=prev;
 }
});
