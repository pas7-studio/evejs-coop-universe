import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcSalvageDispatch}=require("../integration/coopSalvageNpcDispatch.cjs");
const old=process.env.EVEJS_COOP_SALVAGE_NPC_DISPATCH;
process.env.EVEJS_COOP_SALVAGE_NPC_DISPATCH="1";
const args={manifestKey:"30000144-77-1000000",systemID:30000144,salvagerID:921,wreckID:811};
function game(fn){
 let distance=300000,wreckID=811,combat=false,proven=true,warps=0,orbits=0,now=1000000;
 const scene={systemID:30000144,getEntityByID:id=>
  id===921?{kind:"ship",nativeNpc:true,itemID:921,mode:"STOP",position:{x:distance,y:0,z:0}}:
  id===811?{itemID:811,nativeNpcWreck:true,position:{x:0,y:0,z:0}}:null};
 const ctrl={entityID:921,systemID:30000144,get currentTargetID(){return combat?999:0},manualOrder:null};
 const svc=createNpcSalvageDispatch({clock:()=>now,
  readSalvageProof:()=>proven?{status:"SALVAGE_ORIGIN_VERIFIED",wreckID,
   rows:[{cargoID:55,wreckItemID:66}]}:{status:"SALVAGE_ORIGINAL_ITEM_MISMATCH"},
  getScene:()=>scene,getController:()=>ctrl,
  warpNative:()=>{warps++;return {success:true}},
  orbitNative:()=>{orbits++;return {success:true}}});
 fn({svc,near:()=>distance=30000,combat:()=>combat=true,
  wrong:()=>wreckID=999,unverified:()=>proven=false,
  calls:()=>({warps,orbits}),later:()=>now+=61000});
}
test("native salvage NPC physically warps to proven wreck",()=>game(g=>{
 assert.equal(g.svc.dispatch(args).status,"SALVAGE_NPC_WARP_ORDERED");
 assert.deepEqual(g.calls(),{warps:1,orbits:0});
}));
test("native NPC physically orbits nearby original wreck",()=>game(g=>{
 g.near();assert.equal(g.svc.dispatch(args).status,"SALVAGE_NPC_ORBIT_ORDERED");
 assert.deepEqual(g.calls(),{warps:0,orbits:1});
}));
test("combat-active NPC cannot abandon its real fight",()=>game(g=>{
 g.combat();assert.equal(g.svc.dispatch(args).status,"SALVAGE_NPC_NOT_SAFE_FOR_DISPATCH");
 assert.deepEqual(g.calls(),{warps:0,orbits:0});
}));
test("unproven or relabeled wreck cannot move salvage NPC",()=>game(g=>{
 g.wrong();assert.equal(g.svc.dispatch(args).status,"SALVAGE_NPC_UNVERIFIED_WRECK");
 assert.deepEqual(g.calls(),{warps:0,orbits:0});
}));
test("NPC movement cooldown refuses duplicate warp",()=>game(g=>{
 g.svc.dispatch(args);assert.equal(g.svc.dispatch(args).status,"SALVAGE_NPC_COOLDOWN");
 assert.equal(g.calls().warps,1);
}));
test("native dispatch default-off never orders movement",()=>game(g=>{
 process.env.EVEJS_COOP_SALVAGE_NPC_DISPATCH="0";
 try{assert.equal(g.svc.dispatch(args).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_SALVAGE_NPC_DISPATCH="1"}
 assert.equal(g.calls().warps,0);
}));
process.on("exit",()=>{if(old===undefined)delete process.env.EVEJS_COOP_SALVAGE_NPC_DISPATCH;
 else process.env.EVEJS_COOP_SALVAGE_NPC_DISPATCH=old});
