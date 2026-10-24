import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {observe}=require("../integration/coopNativeIndustry.cjs");
const {transferCargo,unloadCargo}=require("../integration/coopNativeHaulCargo.cjs");
const {createRaids}=require("../integration/coopNativeRaids.cjs");
function fakeCargo(){
 const saved=new Map([[701,{cargoID:701,entityID:101,moduleID:0,typeID:34,quantity:120,ownerID:1}]]);
 return {
  listNativeCargoForEntity:id=>[...saved.values()].filter(x=>x.entityID===id),
  buildNativeCargoItems:id=>[...saved.values()].filter(x=>x.entityID===id).map(x=>({itemID:x.cargoID,...x})),
  upsertNativeCargo:x=>{saved.set(x.cargoID,x);return {success:true}},
  removeNativeCargo:id=>{saved.delete(id);return {success:true}}
 };
}
test("native mining ship and actual cargo are reused for a named durable pilot",()=>{
 const scene={getEntityByID:id=>id===101?{itemID:id,kind:"ship",nativeNpc:true}:id===201?{itemID:id,kind:"ship",nativeNpc:true}:null};
 const linked=[];
 const state=observe({
  systemID:30000142,scene,pilots:[{id:"coop-pilot-001",role:"miner"},{id:"coop-pilot-002",role:"hauler"}],
  registry:{get:()=>null,link:(p,systemID,id)=>{linked.push([p.id,id]);return {entityID:id}}},
  getFleets:()=>[{fleetID:9,systemID:30000142,state:"mining",minerEntityIDs:[101],haulerEntityIDs:[201]}],
  getCargo:id=>id===101?[{cargoID:701,moduleID:0,typeID:34,quantity:120}]:[],
  present:()=>({status:"UPDATED"})
 });
 assert.equal(state.status,"ACTIVE");
 assert.deepEqual(linked,[["coop-pilot-001",101],["coop-pilot-002",201]]);
 assert.equal(state.fleets[0].oreQuantity,120);
 assert.equal(state.assignments.length,2);
});
test("miner native ore physically moves into hauler, can drop on kill and unload on return",()=>{
 const store=fakeCargo(),events=[];
 const miner={itemID:101,kind:"ship",nativeCargoItems:[{itemID:701,quantity:120,volume:0.01}]};
 const hauler={itemID:201,kind:"ship",ownerID:2,transient:true,nativeCargoItems:[]};
 const scene={getEntityByID:id=>id===101?miner:id===201?hauler:null};
 const fleet={fleetID:9,systemID:30000142,haulerEntityIDs:[201]};
 const dependencies={store,probe:{observe:(event)=>events.push(event)}};
 assert.equal(transferCargo(scene,fleet,miner,dependencies),1.2);
 assert.equal(store.listNativeCargoForEntity(101).length,0);
 assert.equal(store.listNativeCargoForEntity(201)[0].quantity,120);
 assert.equal(hauler.nativeCargoItems[0].typeID,34);
 // EveJS's wreck builder reads buildNativeCargoItems(201) at destruction.
 assert.equal(store.buildNativeCargoItems(201)[0].quantity,120);
 unloadCargo(scene,fleet,dependencies);
 assert.equal(store.listNativeCargoForEntity(201).length,0);
 assert.deepEqual(events,["living-hauler-loaded","living-hauler-delivered"]);
});
test("organic pirate chooses ore-bearing real native miner, never spawns an enemy",()=>{
 let now=1_000_000;const actions=[];
 const ships=new Map([
  [501,{itemID:501,position:{x:0,y:0,z:0},mode:"STOP"}],
  [101,{itemID:101,position:{x:50000,y:0,z:0},mode:"STOP"}]
 ]);
 const raids=createRaids({clock:()=>now,attack:(a,b)=>{actions.push(["attack",a,b]);return {success:true}},warp:()=>{throw Error("warp unexpected")}});
 const scene={getEntityByID:id=>ships.get(id)};
 const params={systemID:30000142,scene,pirates:[501],fleetShips:[{id:101,role:"miner"}],
  getCargo:id=>id===101?[{typeID:34,moduleID:0,quantity:500}]:[],getController:()=>({})};
 assert.equal(raids.tick(params).actions[0].action,"attack");
 assert.equal(raids.tick(params).actions.length,0);
 assert.deepEqual(actions,[["attack",501,101]]);
 now+=480000;
 assert.equal(raids.tick(params).actions.length,1);
});

test("pirate resumes after real warp arrival and attacks instead of waiting eight minutes",()=>{
 let now=1000000;const ships=new Map([
  [901,{itemID:901,position:{x:0,y:0,z:0},mode:"STOP"}],
  [202,{itemID:202,position:{x:1000000,y:0,z:0},mode:"STOP"}]
 ]);const orders=[];
 const director=createRaids({clock:()=>now,warp:(id,target)=>{orders.push(["warp",id,target]);return {success:true}},
  attack:(id,target)=>{orders.push(["attack",id,target]);return {success:true}}});
 const params={systemID:30000142,scene:{getEntityByID:id=>ships.get(id)},pirates:[901],
  fleetShips:[{id:202,role:"hauler"}],getCargo:()=>[{typeID:34,moduleID:0,quantity:55}],getController:()=>null};
 assert.equal(director.tick(params).actions[0].action,"warp-to-hauler");
 now+=30000;ships.get(901).position.x=999000;
 assert.equal(director.tick(params).actions[0].action,"attack");
 assert.deepEqual(orders,[["warp",901,202],["attack",901,202]]);
});
test("real NPC raid informs only local ready pilots using existing server chat",()=>{
 const {notifyRaid}=require("../integration/coopWorldSignals.cjs");
 const ready={characterID:1,_space:{initialStateSent:true}},notReady={characterID:2,_space:{initialStateSent:false}};
 const seen=[];
 const result=notifyRaid({sessions:new Map([[1,ready],[2,notReady]])},
  [{action:"attack",targetRole:"hauler",targetID:202}],
  (session,msg)=>seen.push([session.characterID,msg]));
 assert.equal(result.sent,1);
 assert.equal(seen[0][0],1);
 assert.match(seen[0][1],/ore transport/);
});

test("native mining identity never binds to static entity or another player ship",()=>{
 const actual={itemID:101,kind:"ship",nativeNpc:true};
 const scene={getEntityByID:id=>id===101?actual:
  id===102?{itemID:102,kind:"ship",nativeNpc:false}:
  id===103?{itemID:103,kind:"asteroidBelt",nativeNpc:true}:null};
 const links=[];
 const outcome=observe({systemID:30000144,scene,pilots:[
  {id:"coop-pilot-001",role:"miner"},
  {id:"coop-pilot-002",role:"hauler"}
 ],registry:{get:()=>null,link:(p,systemID,id)=>{
  links.push(id);return {entityID:id};
 }},getFleets:()=>[{systemID:30000144,fleetID:99,
  minerEntityIDs:[101,102],haulerEntityIDs:[103]}],
 getCargo:()=>[],present:()=>({status:"UPDATED"})});
 assert.deepEqual(links,[101]);
 assert.deepEqual(outcome.fleets[0].minerIDs,[101]);
 assert.deepEqual(outcome.fleets[0].haulerIDs,[]);
 assert.equal(outcome.assignments.length,1);
});
