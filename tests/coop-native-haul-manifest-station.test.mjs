import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const compiled={exports:{}};
const source=readFileSync(new URL("../integration/coopNativeStationArrival.cjs",import.meta.url),"utf8");
new Function("require","module","exports",source)(id=>{
 if(id==="./coopNativeWarehouse")return {createWarehouse:()=>{throw Error("Unexpected native warehouse constructor")}};
 return require(id);
},compiled,compiled.exports);
const {createStationArrival}=compiled.exports;
function env({manifestStatus="MANIFEST_DURABLY_PREPARED",verifyStatus="FULL_NATIVE_CARGO_DELIVERY_VERIFIED",
 enabled=true,failDeposit=false,wrongProofKey=false}={}){
 const original=process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST;
 if(enabled)process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST="1";
 else delete process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST;
 let now=100000,warps=0,deposits=0,prepared=0,verified=0;
 const notices=[];
 const station={stationID:60000011,corporationID:1000035,solarSystemID:30000144};
 const point={itemID:station.stationID,kind:"station",position:{x:10000,y:0,z:0},radius:100};
 const ship={itemID:901,kind:"ship",nativeNpc:true,transient:false,mode:"STOP",
  position:{x:0,y:0,z:0},radius:100};
 const scene={systemID:30000144,staticEntities:[point],getEntityByID:id=>id===901?ship:null};
 const fleet={fleetID:77,systemID:30000144,haulerEntityIDs:[901]};
 const cargo=new Map([[501,{cargoID:501,entityID:901,coopHaulFleetID:77,
  coopHaulFromMinerID:333,typeID:34,quantity:12,moduleID:0,transient:false}]]);
 const manifest={
  prepare:()=>{prepared++;return {status:manifestStatus,key:"30000144-77-100000",cargoIDs:[501]}},
  verify:()=>{verified++;return {status:verifyStatus,cargoIDs:[501],stacks:1,quantity:12,
   key:wrongProofKey?"30000144-77-UNKNOWN":"30000144-77-100000",
   stationID:station.stationID,haulerIDs:[901],
   convoySaved:false,paidReward:false}}
 };
 const warehouse={deposit:()=>{deposits++;if(!failDeposit)cargo.delete(501);
  return {status:failDeposit?"SOURCE_DEBIT_UNCERTAIN":"COMMITTED"}}};
 let dir;
 try{
  dir=createStationArrival({
   getStations:()=>[station],getStation:id=>id===station.stationID?station:null,
   getCorporation:id=>id===1000035?{corporationID:id}:null,
   isNpcCorporation:id=>id===1000035,
   getNativeEntity:id=>id===901?{entityID:id,systemID:30000144,transient:false}:null,
   getScene:()=>scene,store:{listNativeCargoForEntity:()=>[...cargo.values()],
    buildNativeCargoItems:()=>[...cargo.values()]},
   items:{},flush:()=>({success:true}),warpToPoint:()=>{warps++;return {success:true}},
   root:"/tmp/native-manifest-tests",warehouse,manifest,clock:()=>now,
   probe:{observe:(event,_session,_ship,details)=>notices.push({event,details})}});
 }finally{
  if(original===undefined)delete process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST;
  else process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST=original;
 }
 function arrive(){
  ship.position={...point.position};ship.mode="STOP";
  now=103000;dir.tick(scene,fleet,now);
  now=106000;
 }
 return {dir,scene,fleet,cargo,ship,manifest,arrive,notices,
  get warps(){return warps},get deposits(){return deposits},
  get prepared(){return prepared},get verified(){return verified}};
}
test("manifest is durably prepared BEFORE first warp in opt-in native station route",()=>{
 const f=env();assert.equal(f.dir.start(f.scene,f.fleet,100000).status,"EN_ROUTE");
 assert.equal(f.prepared,1);assert.equal(f.warps,1);
 assert.equal(f.fleet.coopStationArrival.manifestID,"30000144-77-100000");
});
test("no durable native manifest => zero real NPC warps, no fabricated cargo removal",()=>{
 const f=env({manifestStatus:"MANIFEST_WRITE_UNCERTAIN"});
 assert.equal(f.dir.start(f.scene,f.fleet,100000).status,"MANIFEST_WRITE_UNCERTAIN");
 assert.equal(f.warps,0);assert.equal(f.deposits,0);assert.equal(f.cargo.size,1);
});
test("even after physical dwell and warehouse debit, incomplete manifest cannot return DELIVERED",()=>{
 const f=env({verifyStatus:"MANIFEST_WAREHOUSE_RECEIPT_MISSING"});
 f.dir.start(f.scene,f.fleet,100000);f.arrive();
 assert.equal(f.dir.tick(f.scene,f.fleet,106000).status,
  "MANIFEST_WAREHOUSE_RECEIPT_MISSING");
 assert.equal(f.deposits,1);assert.ok(f.fleet.coopStationArrival);
});
test("native physical dwell + exact all cargo receipt yields completed manifest proof and normal delivery",()=>{
 const f=env();f.dir.start(f.scene,f.fleet,100000);f.arrive();
 const output=f.dir.tick(f.scene,f.fleet,106000);
 assert.equal(output.status,"DELIVERED");assert.equal(output.terminal,true);
 assert.equal(output.nativeFullManifestProof.status,"FULL_NATIVE_CARGO_DELIVERY_VERIFIED");
 assert.equal(output.nativeFullManifestProof.convoySaved,false);
 assert.equal(f.fleet.coopStationArrival,undefined);assert.equal(f.verified,1);
});
test("new cargo loaded after immutable manifest is never silently delivered or counted",()=>{
 const f=env();f.dir.start(f.scene,f.fleet,100000);f.arrive();
 f.cargo.set(999,{cargoID:999,entityID:901,coopHaulFleetID:77,coopHaulFromMinerID:555,
  typeID:35,quantity:8,moduleID:0,transient:false});
 assert.equal(f.dir.tick(f.scene,f.fleet,106000).status,"MANIFEST_NEW_UNDECLARED_CARGO");
 assert.equal(f.deposits,0);
});
test("flag OFF retains original native station delivery behavior without creating a manifest",()=>{
 const f=env({enabled:false});f.dir.start(f.scene,f.fleet,100000);f.arrive();
 const output=f.dir.tick(f.scene,f.fleet,106000);
 assert.equal(output.status,"DELIVERED");assert.equal(output.nativeFullManifestProof,undefined);
 assert.equal(f.prepared,0);assert.equal(f.verified,0);
});

test("full COMMITTED warehouse manifest recovers lost terminal in-memory count after last cargo debit",()=>{
 const f=env();f.dir.start(f.scene,f.fleet,100000);f.arrive();
 // Simulate a previously COMMITTED warehouse debit with lost local result;
 // the real manifest verifier still checks every durable native receipt.
 f.cargo.delete(501);
 const result=f.dir.tick(f.scene,f.fleet,106000);
 assert.equal(result.status,"DELIVERED");
 assert.equal(result.stacks,1);
 assert.equal(result.quantity,12);
 assert.equal(result.nativeFullManifestProof.status,"FULL_NATIVE_CARGO_DELIVERY_VERIFIED");
 assert.equal(f.deposits,0,"never debits an already-removed cargo stack");
 const events=f.notices.filter(n=>n.event==="alife-native-delivery-settled");
 assert.equal(events.length,1);
 assert.equal(events[0].details.manifestID,"30000144-77-100000");
 assert.equal(events[0].details.proof,"WAREHOUSE_COMMITTED_AND_NATIVE_ITEMSTORE_VERIFIED");
 assert.equal(events[0].details.nativeMutation,false);
 assert.equal(events[0].details.iskCredited,false);
});
test("full manifest delivery telemetry preserves exact IDs and total quantity, not just tick-local stacks",()=>{
 const f=env();f.dir.start(f.scene,f.fleet,100000);f.arrive();
 const result=f.dir.tick(f.scene,f.fleet,106000);
 assert.equal(result.status,"DELIVERED");
 const [event]=f.notices.filter(n=>n.event==="alife-native-delivery-settled");
 assert.ok(event);
 assert.deepEqual(event.details.cargoIDs,[501]);
 assert.deepEqual(event.details.haulerIDs,[901]);
 assert.equal(event.details.quantity,12);
 assert.equal(event.details.eventID,"alife-native-delivery:30000144-77-100000");
});
test("forged full manifest identity cannot complete a native warehouse delivery",()=>{
 const f=env({wrongProofKey:true});f.dir.start(f.scene,f.fleet,100000);f.arrive();
 const result=f.dir.tick(f.scene,f.fleet,106000);
 assert.equal(result.status,"NATIVE_DELIVERY_MANIFEST_PROOF_CONFLICT");
 assert.ok(f.fleet.coopStationArrival,"retain native route for repair");
 assert.equal(f.notices.filter(x=>x.event==="alife-native-delivery-settled").length,0);
});
test("without a verified full manifest an empty physical hauler remains fail closed",()=>{
 const f=env({verifyStatus:"MANIFEST_WAREHOUSE_RECEIPT_MISSING"});
 f.dir.start(f.scene,f.fleet,100000);f.arrive();f.cargo.delete(501);
 const result=f.dir.tick(f.scene,f.fleet,106000);
 assert.equal(result.status,"MANIFEST_WAREHOUSE_RECEIPT_MISSING");
 assert.equal(f.notices.filter(x=>x.event==="alife-native-delivery-settled").length,0);
});
