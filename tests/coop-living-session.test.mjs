import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {build,createAnnouncer}=require("../integration/coopSystemIntel.cjs");
const {createRaids}=require("../integration/coopNativeRaids.cjs");
const {createCivilianOrders}=require("../integration/coopCivilianOrders.cjs");
const {transferCargo,unloadCargo,haulFlag}=require("../integration/coopNativeHaulCargo.cjs");
const scene={
 staticEntities:[
  {itemID:44,kind:"asteroidBelt",itemName:"Broken Comet Belt",position:{x:300000,y:0,z:0}},
  {itemID:55,kind:"stargate",itemName:"North Gate",position:{x:700000,y:0,z:0}}
 ],
 sessions:new Map(),
 getEntityByID(id){
  return ({
   101:{itemID:101,kind:"ship",position:{x:305000,y:0,z:0},mode:"STOP"},
   201:{itemID:201,kind:"ship",position:{x:306000,y:0,z:0},mode:"STOP"},
   901:{itemID:901,kind:"ship",position:{x:290000,y:0,z:0},mode:"STOP"}
  })[id]||null;
 }
};
test("two players get actionable native NPC mining, loaded cargo and pirate locations with controlled cooldown",()=>{
 const fleets=[{fleetID:1,minerIDs:[101],haulerIDs:[201],loadedHaulerOreQuantity:300,responseIDs:[]}];
 const built=build(scene,{fleets,pirateIDs:[901]});
 assert.equal(built.status,"ACTIVE");
 assert.equal(built.activity[0].waypointID,44);
 assert.match(built.messages[0],/Broken Comet Belt/);
 assert.match(built.messages[0],/300 ore units/);
 assert.match(built.messages[1],/pirate/i);
 const sent=[];let clock=0;
 const announcer=createAnnouncer({clock:()=>clock,cooldownMs:90000,send:(s,text)=>sent.push({id:s.characterID,text})});
 const pilot={characterID:70001,_space:{systemID:30000142,initialStateSent:true}};
 assert.equal(announcer.announce(pilot,scene,{fleets,pirateIDs:[901]}).status,"DELIVERED");
 assert.equal(announcer.announce(pilot,scene,{fleets,pirateIDs:[901]}).status,"COOLDOWN");
 clock+=91000;
 assert.equal(announcer.announce(pilot,scene,{fleets,pirateIDs:[901]}).status,"DELIVERED");
 assert.equal(sent.length,4);
});
test("hauler delivery never removes unrelated native cargo; moved ore retains exact cargo ID",()=>{
 const cargo=new Map([
  [777,{cargoID:777,entityID:101,moduleID:0,typeID:34,quantity:100}],
  [888,{cargoID:888,entityID:201,moduleID:0,typeID:99,quantity:2}]
 ]);
 const store={
  listNativeCargoForEntity:id=>[...cargo.values()].filter(x=>x.entityID===id),
  buildNativeCargoItems:id=>[...cargo.values()].filter(x=>x.entityID===id).map(x=>({...x,itemID:x.cargoID})),
  upsertNativeCargo:x=>{cargo.set(x.cargoID,x);return {success:true}},
  removeNativeCargo:id=>{cargo.delete(id);return {success:true}}
 };
 const miner={itemID:101,kind:"ship",nativeCargoItems:[{itemID:777,volume:0.01}]};
 const hauler={itemID:201,kind:"ship",ownerID:5001,nativeCargoItems:[{itemID:888,volume:3}]};
 const physicalScene={getEntityByID:id=>id===101?miner:id===201?hauler:null};
 const fleet={fleetID:9,systemID:30000142,haulerEntityIDs:[201]};
 const options={store,probe:{observe:()=>{}}};
 assert.equal(transferCargo(physicalScene,fleet,miner,options),1);
 assert.equal(store.listNativeCargoForEntity(201).length,2);
 assert.equal(cargo.get(777)[haulFlag],9);
 const unloaded=unloadCargo(physicalScene,fleet,options);
 assert.equal(unloaded.stacks,1);
 assert.equal(cargo.has(777),false);
 assert.equal(cargo.get(888).quantity,2);
});
test("physical raid movement owns pirate, so civilian roaming does not issue a conflicting warp",()=>{
 const ships=new Map([
  [901,{itemID:901,kind:"ship",position:{x:0,y:0,z:0},mode:"STOP"}],
  [101,{itemID:101,kind:"ship",position:{x:400000,y:0,z:0},mode:"STOP"}]
 ]);
 const sim={staticEntities:scene.staticEntities,getEntityByID:id=>ships.get(id)};
 const moves=[];
 const raids=createRaids({clock:()=>1_000_000,warp:(id,target)=>{moves.push(["raid-warp",id,target]);return {success:true}},attack:()=>({success:true})});
 const r=raids.tick({systemID:30000142,scene:sim,pirates:[901],fleetShips:[{id:101,role:"miner"}],
  getCargo:()=>[{moduleID:0,quantity:10}],getController:()=>null});
 assert.equal(r.actions[0].action,"warp-to-hauler");
 const blockedIDs=raids.activePirateIDs(()=>sim);
 assert.equal(blockedIDs.has(901),true);
 const orders=createCivilianOrders({sceneForSystem:()=>sim,warp:()=>{moves.push(["roam"]);return {success:true}},orbit:()=>({success:true})});
 assert.deepEqual(orders.tick([{pilotID:"coop-pilot-005",entityID:901,systemID:30000142}],
  {"coop-pilot-005":{role:"pirate"}},{blockedIDs}),[]);
 assert.equal(moves.length,1);
});
