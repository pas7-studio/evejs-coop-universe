import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {inspect}=require("../integration/coopNativeMiningReadiness.cjs");
const systemID=30000144;
function fixture(){
 const ships=new Map([[101,{itemID:101,kind:"ship",nativeNpc:true}],
  [102,{itemID:102,kind:"ship",nativeNpc:true}],
  [103,{itemID:103,kind:"ship",nativeNpc:true}]]);
 const scene={systemID,getEntityByID:id=>ships.get(id)||null};
 const startup=(slot,id)=>({source:"startup",startupKey:systemID+":"+slot,
  systemID,minerEntityIDs:[id],haulerEntityIDs:[]});
 return {scene,ships,startup};
}
test("all actual native startup slots are required before suppressing retry",()=>{
 const f=fixture();
 const r=inspect({scene:f.scene,systemID,
  fleets:[f.startup(1,101)],expectedCount:2});
 assert.equal(r.ready,false);
 assert.deepEqual(r.missingSlots,[2]);
 const completed=inspect({scene:f.scene,systemID,
  fleets:[f.startup(1,101),f.startup(2,102)],expectedCount:2});
 assert.equal(completed.ready,true);
 assert.equal(completed.status,"READY");
});
test("GM fleet and unrelated startup key cannot masquerade as native startup slot",()=>{
 const f=fixture();
 const fake={...f.startup(1,101),source:"gm"};
 assert.equal(inspect({scene:f.scene,systemID,fleets:[fake],expectedCount:1}).ready,false);
 assert.equal(inspect({scene:f.scene,systemID,
  fleets:[{...fake,source:"startup",startupKey:systemID+":2"}],
  expectedCount:1}).ready,false);
});
test("only an authentic physical native mining hull can prove slot startup",()=>{
 const f=fixture();
 f.ships.set(101,{itemID:101,kind:"ship",nativeNpc:false});
 assert.deepEqual(inspect({scene:f.scene,systemID,
  fleets:[f.startup(1,101)],expectedCount:1}).missingSlots,[1]);
 f.ships.set(101,{itemID:101,kind:"structure",nativeNpc:true});
 assert.equal(inspect({scene:f.scene,systemID,
  fleets:[f.startup(1,101)],expectedCount:1}).ready,false);
 f.ships.set(101,{itemID:999,kind:"ship",nativeNpc:true});
 assert.equal(inspect({scene:f.scene,systemID,
  fleets:[f.startup(1,101)],expectedCount:1}).ready,false);
});
test("different system fleet never proves readiness of Perimeter",()=>{
 const f=fixture();
 const foreign={...f.startup(1,101),systemID:30000142};
 assert.equal(inspect({scene:f.scene,systemID,
  fleets:[foreign],expectedCount:1}).ready,false);
 assert.equal(inspect({scene:{...f.scene,systemID:30000142},systemID,
  fleets:[f.startup(1,101)],expectedCount:1}).ready,false);
});
test("zero explicitly configured slots do not require spawning dummy NPCs",()=>{
 const f=fixture();
 const r=inspect({scene:f.scene,systemID,fleets:[],expectedCount:0});
 assert.equal(r.ready,true);
 assert.equal(r.status,"STARTUP_DISABLED");
});
