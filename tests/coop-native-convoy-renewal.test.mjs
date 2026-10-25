import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRenewal}=require("../integration/coopNativeConvoyRenewal.cjs");
function fixture(){
 let now=1000000;const id=30000144;
 const ships=new Map([[201,{itemID:201,kind:"ship",nativeNpc:true}],
  [202,{itemID:202,kind:"ship",nativeNpc:true}]]);
 const scene={systemID:id,staticEntities:[
  {itemID:91,kind:"asteroidBelt",position:{x:0,y:0,z:0}}
 ],getEntityByID:id=>ships.get(id)||null};
 const fleet=(ship,slot=1)=>({source:"startup",systemID:id,
  startupKey:id+":"+slot,minerEntityIDs:[ship],haulerEntityIDs:[]});
 const director=createRenewal({clock:()=>now,cooldownMs:1800000,
  retryMs:600000,dailyCap:2});
 const check=(fleets=[],seeded=true)=>director.inspect({scene,systemID:id,
  slotCount:1,seeded,fleets});
 return {director,ships,scene,fleet,check,now:()=>now,
  advance:ms=>{now+=ms}};
}
test("existing real convoy keeps its original hull; no respawn while miners survive",()=>{
 const f=fixture();
 assert.equal(f.check([f.fleet(201)]).status,"ACTIVE_NATIVE_CONVOY");
 f.ships.delete(202);
 assert.equal(f.check([f.fleet(201)]).allowed,false);
 assert.equal(f.ships.size,1);
});
test("destroyed whole convoy waits thirty minutes before native startup can replace it",()=>{
 const f=fixture();f.check([f.fleet(201)]);
 f.ships.delete(201);
 assert.equal(f.check([]).status,"CONVOY_LOST_COOLDOWN");
 f.advance(1799999);
 assert.equal(f.check([]).allowed,false);
 f.advance(1);
 const accepted=f.check([]);
 assert.equal(accepted.status,"NATIVE_CONVOY_RENEWAL_AUTHORIZED");
 assert.equal(accepted.renewal,true);
 assert.deepEqual(accepted.missing,[1]);
 assert.equal(f.ships.size,1); // untouched unrelated ship, helper never spawns
});
test("failed replacement does not flood EveJS startup on next background ticks",()=>{
 const f=fixture();f.check([f.fleet(201)]);f.ships.delete(201);f.check([]);
 f.advance(1800000);assert.equal(f.check([]).allowed,true);
 f.advance(120000);assert.equal(f.check([],false).allowed,false);
 f.advance(480000);assert.equal(f.check([],false).allowed,true);
});
test("daily cap prevents unlimited renewable fleets even when all were destroyed",()=>{
 const f=fixture();f.check([f.fleet(201)]);f.ships.delete(201);f.check([]);
 f.advance(1800000);assert.equal(f.check([]).allowed,true);
 f.advance(600000);assert.equal(f.check([]).allowed,true);
 f.advance(600000);
 assert.equal(f.check([]).status,"CONVOY_RENEWAL_DAILY_CAP");
});
test("initial partial EveJS startup is not delayed by renewal cooldown",()=>{
 const f=fixture();
 const result=f.check([],false);
 assert.equal(result.status,"INITIAL_NATIVE_BOOT");
 assert.equal(result.allowed,true);
 assert.equal(result.renewal,false);
});
test("GM fleet cannot impersonate native stock startup while renewal is pending",()=>{
 const f=fixture();
 const gm={...f.fleet(201),source:"gm"};
 assert.equal(f.check([gm],true).status,"CONVOY_LOST_COOLDOWN");
});
test("beltless Jita and invalid native scenes never spawn a fake convoy",()=>{
 const f=fixture();f.scene.staticEntities=[];
 assert.equal(f.check([],false).status,"NO_REAL_ASTEROID_BELT");
 assert.equal(f.check([],false).allowed,false);
 const x=f.director.inspect({scene:{...f.scene,systemID:30000142},
  systemID:30000144,slotCount:1,fleets:[]});
 assert.equal(x.status,"INVALID_NATIVE_CONVOY_SCENE");
});
test("live recovered startup fleet cancels loss cooldown without duplicating ships",()=>{
 const f=fixture();f.check([f.fleet(201)]);f.ships.delete(201);f.check([]);
 f.advance(600000);
 f.ships.set(201,{itemID:201,kind:"ship",nativeNpc:true});
 assert.equal(f.check([f.fleet(201)]).status,"ACTIVE_NATIVE_CONVOY");
 f.ships.delete(201);
 assert.equal(f.check([]).retryAfterMs,1800000);
});
