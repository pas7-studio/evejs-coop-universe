import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createManifest}=require("../integration/coopNativeHaulManifest.cjs");
const SYSTEM=30000144,FLEET=77,STATION=60003334,STATION_CORP=1000031,ORE_OWNER=1000129,
 SHIP=980000016171,CARGO=980200009523,STARTED_AT=1793085392444;
const MARKER=id=>"coop-warehouse:v1:cargo:"+id;
function fixture({rowOwner=ORE_OWNER}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-haul-owner-"));
 const ships=new Map([[SHIP,{entityID:SHIP,systemID:SYSTEM,transient:false}]]);
 const cargo=new Map([[CARGO,{cargoID:CARGO,entityID:SHIP,ownerID:ORE_OWNER,typeID:17463,
  quantity:840,moduleID:0,transient:false,coopHaulFleetID:FLEET,coopHaulFromMinerID:980000015943}]]);
 const stock=new Map();
 const store={listNativeCargoForEntity:id=>[...cargo.values()].filter(x=>x.entityID===id)};
 const items={findWarehouseItem:({ownerID,stationID,cargoID})=>{
  const row=stock.get(Number(cargoID));
  return row&&Number(row.ownerID)===Number(ownerID)&&Number(row.locationID)===Number(stationID)?row:null}};
 const manifest=createManifest({root,store,items,getNativeEntity:id=>ships.get(id),clock:()=>STARTED_AT+1,
  // Directory fsync is unsupported on Windows; the durability contract itself is
  // covered by the fake-io suite. Only the record shape matters here.
  io:{...fs,openSync:(name,mode,...rest)=>{try{return fs.openSync(name,mode,...rest)}
   catch(error){if(mode==="r")return 0;throw error}},
   fsyncSync:fd=>{try{fs.fsyncSync(fd)}catch(_error){}},
   closeSync:fd=>{try{fs.closeSync(fd)}catch(_error){}}}});
 const args={systemID:SYSTEM,fleetID:FLEET,stationID:STATION,corporationID:STATION_CORP,
  startedAt:STARTED_AT,haulerIDs:[SHIP]};
 const key=[SYSTEM,FLEET,STARTED_AT].join("-");
 // The real live shape: the deposit receipt names the ORE OWNER, the manifest names
 // the station operator the fleet trades with.
 function deposit({receiptCorporation=ORE_OWNER,stockOwner=ORE_OWNER,quantity=840,rowOwnerID=rowOwner}={}){
  const itemID=9988400103589;
  stock.set(CARGO,{itemID,typeID:17463,quantity,ownerID:stockOwner,locationID:STATION,
   customInfo:MARKER(CARGO)});
  const record={version:1,phase:"COMMITTED",cargoID:CARGO,haulerID:SHIP,typeID:17463,
   quantity,systemID:SYSTEM,fleetID:FLEET,stationID:STATION,corporationID:receiptCorporation,
   itemID};
  fs.mkdirSync(path.join(root,"receipts"),{recursive:true});
  fs.writeFileSync(path.join(root,"receipts",CARGO+".json"),JSON.stringify(record));
  if(rowOwnerID)rewriteRowOwner(rowOwnerID);
  cargo.delete(CARGO);
 }
 function rewriteRowOwner(ownerID){
  const file=path.join(root,"trip-manifests",key+".json");
  const record=JSON.parse(fs.readFileSync(file,"utf8"));
  record.cargo=record.cargo.map(row=>row.cargoID===CARGO?{...row,ownerID}:row);
  fs.writeFileSync(file,JSON.stringify(record));
 }
 const prepare=()=>manifest.prepare(args);
 const verify=()=>manifest.verify({key,...args});
 return {root,manifest,prepare,verify,deposit,rewriteRowOwner,key,args,cargo,stock};
}
test("the manifest records the row's own pre-warp ore owner",()=>{
 const f=fixture();
 assert.equal(f.prepare().status,"MANIFEST_DURABLY_PREPARED");
 const record=JSON.parse(fs.readFileSync(path.join(f.root,"trip-manifests",f.key+".json"),"utf8"));
 assert.equal(record.corporationID,STATION_CORP);
 assert.equal(record.cargo[0].ownerID,ORE_OWNER);
});
test("a deposit receipt naming the ore owner verifies against the station-corporation manifest",()=>{
 const f=fixture();f.prepare();f.deposit();
 const result=f.verify();
 assert.equal(result.status,"FULL_NATIVE_CARGO_DELIVERY_VERIFIED");
 assert.deepEqual(result.cargoIDs,[CARGO]);assert.equal(result.quantity,840);
});
test("a legacy manifest row without a recorded owner is proven by the physical stack",()=>{
 const f=fixture();f.prepare();f.deposit({rowOwnerID:0});
 assert.equal(f.verify().status,"FULL_NATIVE_CARGO_DELIVERY_VERIFIED");
});
test("a receipt whose corporation does not hold the physical stack still fails",()=>{
 const f=fixture();f.prepare();f.deposit({stockOwner:1000999});
 assert.equal(f.verify().status,"MANIFEST_NATIVE_ITEMSTORE_STOCK_CONFLICT");
});
test("a receipt naming a corporation other than the recorded owner is refused",()=>{
 const f=fixture();f.prepare();f.deposit({receiptCorporation:1000999,stockOwner:1000999});
 assert.equal(f.verify().status,"MANIFEST_WAREHOUSE_RECEIPT_CONFLICT");
});
test("the exact delivered quantity is still required",()=>{
 const f=fixture();f.prepare();f.deposit({quantity:839,stockOwner:ORE_OWNER});
 assert.equal(f.verify().status,"MANIFEST_WAREHOUSE_RECEIPT_CONFLICT");
});
