import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createManifest}=require("../integration/coopNativeHaulManifest.cjs");
const ROOT="/tmp/native-manifest-acceptance";
function fixture(){
 const files=new Map(),handles=new Map(),missing=new Set(),calls={flush:0};
 let fd=1,failWrite=false,failSync=false;
 const io={
  mkdirSync(){},
  openSync:(name,mode)=>{if(mode==="wx"&&files.has(name)){const e=Error("EEXIST");e.code="EEXIST";throw e}
   if(failWrite)throw Error("EIO");
   const n=++fd;handles.set(n,name);
   if(mode==="wx")files.set(name,"");return n},
  writeFileSync:(n,txt)=>{if(failWrite)throw Error("EIO");files.set(handles.get(n),String(txt))},
  fsyncSync:()=>{calls.flush++;if(failSync)throw Error("EIO")},
  closeSync:n=>handles.delete(n),
  readFileSync:(name)=>{if(!files.has(name)||missing.has(name)){const e=Error("ENOENT");e.code="ENOENT";throw e}
   return files.get(name)}
 };
 const ships=new Map([[901,{entityID:901,systemID:30000144,transient:false}]]);
 const cargo=new Map([
  [501,{cargoID:501,entityID:901,coopHaulFleetID:77,coopHaulFromMinerID:333,
   typeID:34,quantity:12,moduleID:0,transient:false}],
  [502,{cargoID:502,entityID:901,coopHaulFleetID:77,coopHaulFromMinerID:334,
   typeID:35,quantity:8,moduleID:0,transient:false}]
 ]);
 const stock=new Map();
 const store={listNativeCargoForEntity:id=>[...cargo.values()].filter(x=>x.entityID===id)};
 const items={findWarehouseItem:({cargoID})=>stock.get(cargoID)||null};
 const director=()=>createManifest({root:ROOT,store,items,io,
  getNativeEntity:id=>ships.get(id),clock:()=>100001});
 const args={systemID:30000144,fleetID:77,stationID:60000011,
  corporationID:1000035,startedAt:100001,haulerIDs:[901]};
 function deliver(cargoID){
  const row=cargo.get(cargoID);
  const itemID=70000+cargoID;
  stock.set(cargoID,{itemID,typeID:row.typeID,quantity:row.quantity,
   ownerID:args.corporationID,locationID:args.stationID,
   customInfo:"coop-warehouse:v1:cargo:"+cargoID});
  files.set(ROOT+"/receipts/"+cargoID+".json",JSON.stringify({
   version:1,phase:"COMMITTED",cargoID,
   haulerID:row.entityID,systemID:args.systemID,fleetID:args.fleetID,
   stationID:args.stationID,corporationID:args.corporationID,
   typeID:row.typeID,quantity:row.quantity,itemID}));
  cargo.delete(cargoID);
 }
 return {files,ships,cargo,stock,io,director,args,deliver,calls,
  failWrite:()=>failWrite=true,failSync:()=>failSync=true,
  verify:()=>director().verify({key:"30000144-77-100001",...args})};
}
test("durable full pre-warp manifest captures ALL distinct physical cargo IDs and exact quantities",()=>{
 const f=fixture(),p=f.director().prepare(f.args);
 assert.equal(p.status,"MANIFEST_DURABLY_PREPARED");
 assert.deepEqual(p.cargoIDs,[501,502]);assert.equal(p.expectedQuantity,20);
 assert.ok(f.calls.flush>=2);
 assert.equal(f.director().read(p.key).record.cargo.length,2);
});
test("an unchanged source cargo row never counts as a delivered load",()=>{
 const f=fixture(),p=f.director().prepare(f.args);
 assert.equal(f.verify().status,"MANIFEST_SOURCE_CARGO_STILL_PRESENT");
 assert.equal(p.status,"MANIFEST_DURABLY_PREPARED");
});
test("one COMMITTED warehouse stack alone does NOT make full manifest completion",()=>{
 const f=fixture();f.director().prepare(f.args);f.deliver(501);
 assert.equal(f.verify().status,"MANIFEST_SOURCE_CARGO_STILL_PRESENT");
 f.cargo.delete(502);
 assert.equal(f.verify().status,"MANIFEST_WAREHOUSE_RECEIPT_MISSING");
});
test("every warehouse COMMITTED record and exact native stock must be present before full proof",()=>{
 const f=fixture(),a=f.director();a.prepare(f.args);
 f.deliver(501);f.deliver(502);
 const result=f.verify();
 assert.equal(result.status,"FULL_NATIVE_CARGO_DELIVERY_VERIFIED");
 assert.deepEqual(result.cargoIDs,[501,502]);assert.equal(result.quantity,20);
 assert.equal(result.convoySaved,false);assert.equal(result.paidReward,false);
 assert.equal(f.director().verify({key:result.key,...f.args}).status,result.status);
});
test("native stock tampering, wrong owner, marker or quantity blocks full proof",()=>{
 for(const change of [
  s=>s.ownerID=90000,s=>s.customInfo="untagged",
  s=>s.quantity=999,s=>s.itemID=42,s=>s.locationID=99
 ]){
  const f=fixture();f.director().prepare(f.args);f.deliver(501);f.deliver(502);
  change(f.stock.get(501));
  assert.equal(f.verify().status,"MANIFEST_NATIVE_ITEMSTORE_STOCK_CONFLICT");
 }
});
test("a mismatched warehouse receipt cannot satisfy exact physical cargo manifest",()=>{
 const f=fixture();f.director().prepare(f.args);f.deliver(501);f.deliver(502);
 const p=ROOT+"/receipts/501.json",r=JSON.parse(f.files.get(p));
 f.files.set(p,JSON.stringify({...r,haulerID:999}));
 assert.equal(f.verify().status,"MANIFEST_WAREHOUSE_RECEIPT_CONFLICT");
});
test("same native trip identity cannot be overwritten by a new manifest",()=>{
 const f=fixture(),first=f.director().prepare(f.args);
 f.cargo.get(501).quantity=999;
 assert.equal(f.director().prepare(f.args).status,"MANIFEST_ALREADY_EXISTS_OR_UNAVAILABLE");
 assert.equal(f.director().read(first.key).record.cargo.find(x=>x.cargoID===501).quantity,12);
});
test("duplicate cargo identity, transient cargo, wrong fleet and destroyed hauler all block pre-warp manifest",()=>{
 for(const change of [
  f=>{f.cargo.set(503,{...f.cargo.get(501)})},
  f=>{f.cargo.get(501).transient=true},
  f=>{f.cargo.get(501).coopHaulFleetID=100},
  f=>{f.ships.get(901).transient=true}
 ]){
  const f=fixture();change(f);
  assert.notEqual(f.director().prepare(f.args).status,"MANIFEST_DURABLY_PREPARED");
  assert.equal(f.files.size,0);
 }
});
test("write/fsync uncertainty never permits warp-ready native delivery manifest",()=>{
 for(const method of ["failWrite","failSync"]){
  const f=fixture();f[method]();
  assert.notEqual(f.director().prepare(f.args).status,"MANIFEST_DURABLY_PREPARED");
 }
});
test("a torn or corrupt immutable manifest cannot be read as valid proof",()=>{
 const f=fixture(),a=f.director(),p=a.prepare(f.args);
 f.files.set(ROOT+"/trip-manifests/"+p.key+".json",'{"v":1');
 assert.equal(f.verify().status,"MANIFEST_CORRUPT");
});
test("native station, corporation, fleet, hauler identities cannot be swapped after preparation",()=>{
 const f=fixture(),p=f.director().prepare(f.args);
 f.deliver(501);f.deliver(502);
 for(const change of [{stationID:1},{corporationID:5},{fleetID:90},{haulerIDs:[999]}])
  assert.equal(f.director().verify({key:p.key,...f.args,...change}).status,
   "MANIFEST_ROUTE_IDENTITY_CONFLICT");
});
test("missing source ship after an accepted warp never creates false completed manifest",()=>{
 const f=fixture(),p=f.director().prepare(f.args);
 f.deliver(501);f.deliver(502);
 f.ships.delete(901);
 assert.equal(f.verify().status,"MANIFEST_HAULER_NO_LONGER_DURABLE");
});
