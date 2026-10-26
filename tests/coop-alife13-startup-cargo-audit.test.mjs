import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStartupCargoAuditor}=require("../integration/coopAlifeStartupCargoAudit.cjs");
const {createManifest}=require("../integration/coopNativeHaulManifest.cjs");
const {createJournal}=require("../integration/coopNativeStationTripJournal.cjs");
const SYSTEM=30000142,FLEET=SYSTEM*32+1,MINER=70001,HAULER=70002;
const STATION=60010001,CORP=1000035,START=100000;
const hash=v=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
function fixture(t,{two=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-alife13-"));
 t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 fs.mkdirSync(path.join(root,"trip-manifests"));
 fs.mkdirSync(path.join(root,"receipts"));
 const c1=980200111,c2=980200112,ids=two?[c1,c2]:[c1];
 const cargo={},transfers={},stock=new Map();
 const observed=new Map();
 for(const [i,id] of ids.entries()){
  const row={cargoID:id,entityID:HAULER,ownerID:CORP,typeID:34+i,quantity:13+i,
   moduleID:0,transient:false,coopHaulFleetID:FLEET,coopHaulFromMinerID:MINER};
  cargo[String(id)]=row;observed.set(id,row);
  transfers["coopNativeHaulTransfer:"+id]={version:1,status:"COMMITTED",
   cargoID:id,systemID:SYSTEM,fleetID:FLEET,minerID:MINER,haulerID:HAULER,
   sourceOwnerID:CORP,haulerOwnerID:CORP,typeID:row.typeID,quantity:row.quantity,
   beforeHash:"0".repeat(64),afterHash:hash(row),loadedAt:START};
 }
 const db={read(table,key){assert.equal(table,"npcCargo");assert.equal(key,"/");
  return {success:true,data:{cargo,...transfers}}}};
 const store={listNativeCargoForEntity:id=>id===HAULER?[...observed.values()]:[]};
 const actors=new Map([[MINER,{entityID:MINER,ownerID:CORP,systemID:SYSTEM,transient:false}],
  [HAULER,{entityID:HAULER,ownerID:CORP,systemID:SYSTEM,transient:false}]]);
 const getNativeEntity=id=>actors.get(id)||null;
 const items={findWarehouseItem:({cargoID})=>stock.get(cargoID)||null};
 const manifest=createManifest({root,store,items,getNativeEntity,clock:()=>START});
 const trip=createJournal({root,manifest,store,items,getNativeEntity,clock:()=>START+1000});
 const m={v:1,key:SYSTEM+"-"+FLEET+"-"+START,systemID:SYSTEM,fleetID:FLEET,
  startedAt:START,stationID:STATION,corporationID:CORP,haulerIDs:[HAULER],
  cargo:ids.map(id=>({cargoID:id,haulerID:HAULER,typeID:cargo[id].typeID,
   quantity:cargo[id].quantity,fromMinerID:MINER}))};
 const audit=createStartupCargoAuditor({root,gameStore:db,store,items,getNativeEntity});
 const run=()=>audit.audit({systemID:SYSTEM,fleetID:FLEET,
  minerIDs:[MINER],haulerIDs:[HAULER]});
 function prepare(){
  fs.writeFileSync(path.join(root,"trip-manifests",m.key+".json"),JSON.stringify(m));
 }
 function ack(){
  return trip.confirm({manifestKey:m.key,systemID:SYSTEM,fleetID:FLEET,
   stationID:STATION,corporationID:CORP,haulerIDs:[HAULER],
   cargoIDs:ids,startedAt:START});
 }
 function deliver(id,phase="COMMITTED"){
  const row=cargo[id];delete cargo[id];observed.delete(id);
  const itemID=id+7000;
  stock.set(id,{itemID,typeID:row.typeID,quantity:row.quantity,ownerID:CORP,
   locationID:STATION,customInfo:"coop-warehouse:v1:cargo:"+id});
  fs.writeFileSync(path.join(root,"receipts",id+".json"),JSON.stringify({
   version:1,phase,cargoID:id,itemID,haulerID:HAULER,fleetID:FLEET,
   systemID:SYSTEM,stationID:STATION,corporationID:CORP,
   typeID:row.typeID,quantity:row.quantity}));
 }
 return {root,ids,cargo,transfers,stock,observed,actors,db,m,run,prepare,ack,deliver};
}
test("read-only newly transferred cargo before manifest is still in original hauler",t=>{
 const f=fixture(t),result=f.run();
 assert.equal(result.status,"OK");
 assert.equal(result.pending,1);
 assert.equal(result.warehouse,0);
 assert.equal(f.observed.size,1);
});
test("fsynced original warp and native hauler cargo resume same physical trip",t=>{
 const f=fixture(t);f.prepare();
 assert.equal(f.ack().status,"DURABLE_DEPARTURE_CONFIRMED");
 assert.equal(f.run().status,"OK");
});
test("EMPTY restored hauler with all original cargo safely COMMITTED is accepted",t=>{
 const f=fixture(t);f.prepare();f.ack();f.deliver(f.ids[0]);
 const result=f.run();
 assert.equal(result.status,"OK");
 assert.equal(result.warehouse,1);
 assert.equal(result.pending,0);
});
test("EMPTY restored hauler but PREPARED receipt blocks original fleet startup",t=>{
 const f=fixture(t);f.prepare();f.ack();f.deliver(f.ids[0],"PREPARED");
 const result=f.run();
 assert.equal(result.status,"NEEDS_OPERATOR_REPAIR");
 assert.match(result.reason,/WAREHOUSE/);
});
test("EMPTY restored hauler and NO warehouse receipt never restarts mining",t=>{
 const f=fixture(t);f.prepare();f.ack();f.deliver(f.ids[0]);
 fs.unlinkSync(path.join(f.root,"receipts",f.ids[0]+".json"));
 assert.equal(f.run().status,"NEEDS_OPERATOR_REPAIR");
});
test("mixed completed and pending original stack: no second credit and no new cargo",t=>{
 const f=fixture(t,{two:true});f.prepare();f.ack();f.deliver(f.ids[0]);
 const result=f.run();
 assert.equal(result.status,"OK");
 assert.equal(result.warehouse,1);
 assert.equal(result.pending,1);
 assert.equal(f.observed.has(f.ids[1]),true);
});
test("unacknowledged real warp cannot be inferred from a prepared manifest",t=>{
 const f=fixture(t);f.prepare();
 assert.equal(f.run().status,"NEEDS_OPERATOR_REPAIR");
});
test("original GameStore receipt tampering cannot turn lost source into delivery",t=>{
 const f=fixture(t);f.prepare();f.ack();f.deliver(f.ids[0]);
 f.transfers["coopNativeHaulTransfer:"+f.ids[0]].quantity++;
 assert.equal(f.run().status,"NEEDS_OPERATOR_REPAIR");
});
test("changed original cargo compared with atomic transfer hash is quarantined",t=>{
 const f=fixture(t);f.observed.get(f.ids[0]).quantity++;
 assert.equal(f.run().status,"NEEDS_OPERATOR_REPAIR");
});
test("native cache missing a committed original GameStore cargo blocks startup",t=>{
 const f=fixture(t);f.observed.clear();
 assert.equal(f.run().reason,"ALIFE13_SQLITE_CACHE_MISMATCH");
});
test("manifest without original ALIFE-10 SQLite transfer receipt blocks",t=>{
 const f=fixture(t);f.prepare();f.ack();
 delete f.transfers["coopNativeHaulTransfer:"+f.ids[0]];
 assert.equal(f.run().reason,"ALIFE13_MANIFEST_WITHOUT_ORIGINAL_TRANSFER");
});
test("original ItemStore owner/quantity mismatch prevents completed delivery proof",t=>{
 const f=fixture(t);f.prepare();f.ack();f.deliver(f.ids[0]);
 f.stock.get(f.ids[0]).quantity++;
 assert.equal(f.run().reason,"ALIFE13_ITEMSTORE_CREDIT_INVALID");
});
test("read failure or foreign hull owner never silently means clean native stock",t=>{
 const f=fixture(t);
 f.db.read=()=>({success:false});
 assert.equal(f.run().status,"NEEDS_OPERATOR_REPAIR");
 f.actors.get(MINER).transient=true;
 assert.equal(f.run().reason,"ALIFE13_DURABLE_ACTOR_UNVERIFIED");
});
test("runtime calls ALIFE-13 before physical materialization and never adds a timer",()=>{
 const source=fs.readFileSync(new URL("../integration/coopNativeMiningFleetDurable.cjs",import.meta.url),"utf8");
 assert.ok(source.indexOf("auditStartupCargo({systemID")<
  source.indexOf("nativeService.materializeStoredNativeController(scene,id"));
 assert.match(source,/ALIFE13_STARTUP_ORIGINAL_CARGO_UNRECONCILED/);
 assert.match(source,/EVEJS_COOP_ALIFE_STARTUP_CARGO_AUDIT/);
 assert.doesNotMatch(source,/setInterval\s*\(/);
});

test("orphan warehouse receipt without original transfer is quarantined",t=>{
 const f=fixture(t);
 const id=980211911;
 fs.writeFileSync(path.join(f.root,"receipts",id+".json"),JSON.stringify({
  version:1,phase:"COMMITTED",cargoID:id,haulerID:HAULER,
  fleetID:FLEET,systemID:SYSTEM,stationID:STATION,corporationID:CORP,
  typeID:34,quantity:5,itemID:123456}));
 assert.equal(f.run().reason,"ALIFE13_ORPHAN_WAREHOUSE_RECEIPT");
});
test("original transfer receipt cannot claim a foreign durable owner",t=>{
 const f=fixture(t);
 f.actors.get(HAULER).ownerID++;
 assert.equal(f.run().reason,"ALIFE13_TRANSFER_ACTOR_OWNER_CONFLICT");
});

test("historical COMMITTED cargo without original fsynced warp ACK still blocks startup",t=>{
 const f=fixture(t);f.prepare();f.deliver(f.ids[0]);
 assert.equal(f.run().reason,"ALIFE13_ORIGINAL_WARP_ACK_MISSING");
});
test("historical native ACK identity changed after COMMIT still quarantines",t=>{
 const f=fixture(t);f.prepare();f.ack();f.deliver(f.ids[0]);
 const file=path.join(f.root,"trip-departure-acks",f.m.key+".json");
 const ack=JSON.parse(fs.readFileSync(file,"utf8"));ack.stationID++;
 fs.writeFileSync(file,JSON.stringify(ack));
 assert.equal(f.run().reason,"ALIFE13_ORIGINAL_WARP_ACK_CHANGED");
});


test("two fleets in the same system have independent original transfer receipts",t=>{
 const f=fixture(t);
 const other=980299901;
 f.transfers["coopNativeHaulTransfer:"+other]={
  version:1,status:"COMMITTED",cargoID:other,systemID:SYSTEM,
  fleetID:FLEET+1,minerID:MINER+100,haulerID:HAULER+100,
  sourceOwnerID:CORP,haulerOwnerID:CORP,typeID:35,quantity:50,
  beforeHash:"0".repeat(64),afterHash:"1".repeat(64)
 };
 assert.equal(f.run().status,"OK","another fleet transfer must not quarantine this one");
});
test("unrelated warehouse receipts for another fleet in same system are ignored",t=>{
 const f=fixture(t);
 const other=980299902;
 fs.writeFileSync(path.join(f.root,"receipts",other+".json"),JSON.stringify({
  version:1,phase:"COMMITTED",cargoID:other,haulerID:HAULER+100,
  fleetID:FLEET+1,systemID:SYSTEM,stationID:STATION,
  corporationID:CORP,typeID:35,quantity:50,itemID:1200234
 }));
 assert.equal(f.run().status,"OK","another fleet warehouse receipt is independent");
});
test("foreign manifest history in same system cannot contaminate own route recovery",t=>{
 const f=fixture(t);const otherKey=SYSTEM+"-"+(FLEET+1)+"-"+START;
 fs.writeFileSync(path.join(f.root,"trip-manifests",otherKey+".json"),
  JSON.stringify({v:1,key:otherKey,systemID:SYSTEM,fleetID:FLEET+1,
   startedAt:START,stationID:STATION,corporationID:CORP,
   haulerIDs:[HAULER+100],cargo:[{cargoID:980299903,
    haulerID:HAULER+100,fromMinerID:MINER+100,typeID:35,quantity:50}]}));
 assert.equal(f.run().status,"OK");
});
test("relabeling our original transfer with a foreign fleetID is quarantined",t=>{
 const f=fixture(t);
 f.transfers["coopNativeHaulTransfer:"+f.ids[0]].fleetID=FLEET+1;
 assert.equal(f.run().reason,"ALIFE13_TRANSFER_RECEIPT_INVALID");
});
test("relabeling our own orphan warehouse receipt with another fleetID is still quarantined",t=>{
 const f=fixture(t),id=980299904;
 fs.writeFileSync(path.join(f.root,"receipts",id+".json"),JSON.stringify({
  version:1,phase:"COMMITTED",cargoID:id,haulerID:HAULER,
  fleetID:FLEET+1,systemID:SYSTEM,stationID:STATION,
  corporationID:CORP,typeID:35,quantity:50,itemID:1200234
 }));
 assert.equal(f.run().reason,"ALIFE13_ORPHAN_WAREHOUSE_RECEIPT");
});
