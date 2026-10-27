import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRaids}=require("../integration/coopNativeRaids.cjs");
function fixture(){
 let now=1000000;
 const pirate={itemID:501,kind:"ship",nativeNpc:true,mode:"STOP",
  position:{x:0,y:0,z:0}};
 const miner={itemID:201,kind:"ship",nativeNpc:true,mode:"STOP",
  position:{x:300000,y:0,z:0}};
 const ships=new Map([[501,pirate],[201,miner]]);
 const fleetShips=[{id:201,role:"miner"}];
 const controller={currentTargetID:0,manualOrder:null,lastAggressedAtMs:0};
 const nativeOrders=[];
 const releases=[];
 const scene={systemID:30000144,sessions:new Map(),getEntityByID:id=>ships.get(id)||null};
 const tick=()=>raids.tick({systemID:30000144,scene,pirates:[501],
  fleetShips,
  getCargo:id=>[201,202].includes(id)?[{moduleID:0,typeID:34,quantity:40}]:[],
  getController:()=>controller,canAttack:()=>true});
 const raids=createRaids({clock:()=>now,
  warp:(id,targetID)=>{
   nativeOrders.push(["warp",id,targetID]);controller.currentTargetID=targetID;
   pirate.mode="WARP";return {success:true};
  },
  attack:(id,targetID)=>{
   nativeOrders.push(["attack",id,targetID]);
   controller.currentTargetID=targetID;
   controller.manualOrder={type:"attack",targetID};
   return {success:true};
  },
  release:(id,reason)=>{
   releases.push([id,reason]);
   controller.manualOrder={type:"resumeBehavior"};
   return {success:true};
  }});
 return {tick,ships,fleetShips,scene,pirate,miner,controller,nativeOrders,
  releases,advance:ms=>{now+=ms;}};
}
test("real pirate approaches loaded miner and issues a native attack after landing",()=>{
 const f=fixture();
 const first=f.tick();
 assert.deepEqual(first.actions.map(x=>x.action),["warp-to-hauler"]);
 assert.deepEqual(f.nativeOrders,[["warp",501,201]]);
 f.advance(15000);f.pirate.mode="STOP";f.pirate.position.x=290000;
 const second=f.tick();
 assert.deepEqual(second.actions.map(x=>x.action),["attack"]);
 assert.deepEqual(f.nativeOrders,[["warp",501,201],["attack",501,201]]);
 f.advance(480000);assert.equal(f.tick().actions.length,0);
 assert.equal(f.nativeOrders.length,2);
});
test("pirate never steals an ongoing native player engagement",()=>{
 const f=fixture();const player={itemID:90001,kind:"ship",position:{x:100,y:0,z:0}};
 f.ships.set(90001,player);
 f.scene.sessions.set(1,{characterID:9001,_space:{systemID:30000144,shipID:90001}});
 f.controller.currentTargetID=90001;
 assert.equal(f.tick().actions.length,0);
 assert.equal(f.nativeOrders.length,0);
});
test("a native pirate already targeting another real NPC is never hijacked",()=>{
 const f=fixture();
 const enemy={itemID:333,kind:"ship",nativeNpc:true,
  position:{x:50000,y:0,z:0},mode:"STOP"};
 f.ships.set(333,enemy);
 f.controller.currentTargetID=333;
 assert.equal(f.tick().actions.length,0);
 assert.equal(f.nativeOrders.length,0);
});
test("manual NPC orders, recent retaliation and warp state prevent forced raids",()=>{
 const f=fixture();
 f.controller.manualOrder={type:"holdFire"};
 assert.equal(f.tick().actions.length,0);
 f.controller.manualOrder=null;
 f.controller.currentTargetID=201;
 f.controller.lastAggressedAtMs=1000000;
 assert.equal(f.tick().actions.length,0);
 f.controller.lastAggressedAtMs=0;
 f.pirate.mode="WARP";
 assert.equal(f.tick().actions.length,0);
});
test("approach keeps same valid target without switching to a nearer competing miner",()=>{
 const f=fixture();
 assert.equal(f.tick().actions[0].targetID,201);
 const near={itemID:202,kind:"ship",nativeNpc:true,mode:"STOP",position:{x:299999,y:0,z:0}};
 f.ships.set(202,near);
 f.fleetShips.push({id:202,role:"miner"});
 f.advance(15000);f.pirate.mode="STOP";f.pirate.position.x=299998;
 assert.equal(f.tick().actions[0].targetID,201);
});
test("no ore, no live miner and rejected native command never produce fake raid",()=>{
 const f=fixture();
 f.ships.delete(201);
 assert.equal(f.tick().actions.length,0);
 assert.equal(f.nativeOrders.length,0);
});

test("a loaded hauler far beyond the native leash never outranks a near loaded miner",()=>{
 const f=fixture();
 // The hauler sits at a stuck-fleet position 4.4e11 m away; the miner is 300 km.
 const hauler={itemID:202,kind:"ship",nativeNpc:true,mode:"STOP",
  position:{x:448793573773,y:0,z:0}};
 f.ships.set(202,hauler);
 f.fleetShips.push({id:202,role:"hauler"});
 const result=f.tick();
 assert.equal(result.actions[0].targetID,201);
 assert.equal(result.actions[0].targetRole,"miner");
});

test("a loaded hauler that is really on grid is still the preferred prize",()=>{
 const f=fixture();
 const hauler={itemID:202,kind:"ship",nativeNpc:true,mode:"STOP",
  position:{x:290000,y:0,z:0}};
 f.ships.set(202,hauler);
 f.fleetShips.push({id:202,role:"hauler"});
 const result=f.tick();
 assert.equal(result.actions[0].targetID,202);
 assert.equal(result.actions[0].targetRole,"hauler");
});

test("a convoy hull in an active warp is not chased - it cannot be caught",()=>{
 const f=fixture();
 f.ships.get(201).mode="WARP";
 assert.equal(f.tick().actions.length,0);
 assert.equal(f.nativeOrders.length,0);
 f.ships.get(201).mode="STOP";
 assert.equal(f.tick().actions.length,1);
});

// FW-016: one owner per record. A hull that still carries the raid's own
// previous attack order is released before it is re-tasked, otherwise the
// native behaviour loop keeps flying its own subwarp pursuit (mode GOTO) and
// the issued warp never becomes the command that moves the ship.
test("the raid releases its own previous attack order before a new approach",()=>{
 const f=fixture();
 assert.equal(f.tick().actions[0].action,"warp-to-hauler");
 f.advance(15000);f.pirate.mode="STOP";f.pirate.position.x=290000;
 assert.equal(f.tick().actions[0].action,"attack");
 assert.equal(f.releases.length,0);
 // The attack never acquired a native lock (currentTargetID 0) and the convoy
 // warped away, so the same order is now a stale pin on a hull 1500 km away.
 f.controller.currentTargetID=0;
 f.miner.position.x=1500000;f.pirate.position.x=0;
 f.advance(480000);
 const result=f.tick();
 assert.deepEqual(f.releases,[[501,"FOR_APPROACH"]]);
 const action=result.actions.find(x=>x.action==="warp-to-hauler");
 assert.equal(action.released,true);
 assert.equal(action.reason,"FOR_APPROACH");
 assert.deepEqual(f.nativeOrders.at(-1),["warp",501,201]);
});

test("an attack that never acquired a native lock is released and the hull goes idle",()=>{
 const f=fixture();
 f.tick();f.advance(15000);f.pirate.mode="STOP";f.pirate.position.x=290000;
 assert.equal(f.tick().actions[0].action,"attack");
 const issued=f.nativeOrders.length;
 f.controller.currentTargetID=0;
 f.advance(480000);
 const result=f.tick();
 assert.deepEqual(f.releases,[[501,"ATTACK_NO_NATIVE_LOCK"]]);
 assert.deepEqual(result.actions.map(x=>x.action),["attack-no-lock"]);
 assert.equal(result.actions[0].released,true);
 assert.equal(f.nativeOrders.length,issued);
});

test("an approach that never became a warp is released instead of re-issued",()=>{
 const f=fixture();
 assert.equal(f.tick().actions[0].action,"warp-to-hauler");
 // The warp did not fly: the native controller kept its own GOTO pursuit.
 f.pirate.mode="GOTO";
 f.advance(20000);
 const result=f.tick();
 assert.deepEqual(f.releases,[[501,"APPROACH_NOT_WARPING"]]);
 assert.equal(result.actions[0].action,"approach-unflyable");
 assert.equal(result.actions[0].released,true);
 assert.equal(f.nativeOrders.length,1);
});

test("a warp that really flies is never released",()=>{
 const f=fixture();
 assert.equal(f.tick().actions[0].action,"warp-to-hauler");
 f.advance(20000);
 assert.equal(f.tick().actions.length,0);
 assert.equal(f.releases.length,0);
 assert.equal(f.nativeOrders.length,1);
});

test("a rival manual attack order is never released by the raid",()=>{
 const f=fixture();
 f.controller.manualOrder={type:"attack",targetID:999};
 f.advance(600000);
 assert.equal(f.tick().actions.length,0);
 assert.equal(f.releases.length,0);
 assert.equal(f.nativeOrders.length,0);
});
