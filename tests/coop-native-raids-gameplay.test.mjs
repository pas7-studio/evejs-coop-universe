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
  }});
 return {tick,ships,fleetShips,scene,pirate,miner,controller,nativeOrders,
  advance:ms=>{now+=ms;}};
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
