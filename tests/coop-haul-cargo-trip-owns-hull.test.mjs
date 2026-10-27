import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {transferCargo}=require("../integration/coopNativeHaulCargo.cjs");
const SYSTEM=30000144,MINER=980000016144,HAULER=980000016257,CARGO=980200001900;
function fixture(){
 const miner={kind:"ship",itemID:MINER,ownerID:1000129,nativeNpc:true,transient:false,
  position:{x:0,y:0,z:0},mode:"STOP",nativeCargoItems:[{itemID:CARGO,typeID:17463,quantity:420,volume:0.1}]};
 const hauler={kind:"ship",itemID:HAULER,ownerID:1000129,nativeNpc:true,transient:false,
  position:{x:300,y:0,z:0},mode:"STOP",nativeCargoItems:[]};
 const scene={systemID:SYSTEM,getEntityByID:id=>id===MINER?miner:id===HAULER?hauler:null};
 const rows=new Map([[CARGO,{cargoID:CARGO,entityID:MINER,ownerID:1000129,typeID:17463,
  quantity:420,moduleID:0,transient:false}]]);
 const events=[];
 const store={listNativeCargoForEntity:id=>[...rows.values()].filter(row=>row.entityID===id),
  listNativeCargo:()=>[...rows.values()],
  upsertNativeCargo:row=>{rows.set(row.cargoID,{...row});return {success:true}},
  buildNativeCargoItems:id=>[...rows.values()].filter(row=>row.entityID===id)};
 const fleet={fleetID:960004609,systemID:SYSTEM,minerEntityIDs:[MINER],haulerEntityIDs:[HAULER]};
 return {miner,hauler,scene,fleet,store,rows,events,
  transfer:()=>transferCargo(scene,fleet,miner,{store,probe:{observe:(event,ref,ctx,payload)=>events.push({event,payload})}})};
}
test("the delivery trip owns its hulls: no ore is loaded while a manifest is flying",()=>{
 const f=fixture();
 f.fleet.coopStationArrival={stationID:60000358,corporationID:1000004,manifestID:"m1",
  haulers:{[HAULER]:{arrivedAt:123}}};
 assert.equal(f.transfer(),0);
 assert.equal(f.rows.get(CARGO).entityID,MINER);
 assert.equal(f.events.length,0);
});
test("once the trip is closed the same hauler loads again",()=>{
 const f=fixture();
 f.fleet.coopStationArrival={stationID:60000358,haulers:{[HAULER]:{arrivedAt:123}}};
 assert.equal(f.transfer(),0);
 delete f.fleet.coopStationArrival;
 assert.ok(f.transfer()>0);
 assert.equal(f.rows.get(CARGO).entityID,HAULER);
 assert.equal(f.events.filter(x=>x.event==="living-hauler-loaded").length,1);
});
test("a trip that owns only one hull does not block the others",()=>{
 const f=fixture();
 const spare={kind:"ship",itemID:980000016258,ownerID:1000129,nativeNpc:true,transient:false,
  position:{x:300,y:0,z:0},mode:"STOP",nativeCargoItems:[]};
 f.scene.getEntityByID=id=>id===MINER?f.miner:id===HAULER?f.hauler:id===spare.itemID?spare:null;
 f.fleet.haulerEntityIDs=[HAULER,spare.itemID];
 f.fleet.coopStationArrival={stationID:60000358,haulers:{[HAULER]:{arrivedAt:123}}};
 assert.ok(f.transfer()>0);
 assert.equal(f.rows.get(CARGO).entityID,spare.itemID);
});
