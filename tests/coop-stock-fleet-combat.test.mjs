import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStockFleetCombatEvidence}=require("../integration/coopStockFleetCombatEvidence.cjs");
const {verify}=require("../integration/coopNpcWeaponEvidence.cjs");
const {summarize}=require("../scripts/coop-world-report.cjs");
const systemID=30000144;
const pirate={itemID:10,kind:"ship",nativeNpc:true};
const miner={itemID:20,kind:"ship",nativeNpc:true};
const scene={systemID,sessions:new Map(),getEntityByID:id=>id===10?pirate:id===20?miner:null};
const pirateLink={pilotID:"coop-pilot-010",entityID:10,systemID,role:"pirate"};
const namedMiner={pilotID:"coop-pilot-011",entityID:20,systemID,role:"miner"};
const fleetShips=[{id:20,role:"miner"}];
const pilots=[{id:"coop-pilot-010",faction:"independent"},{id:"coop-pilot-011",faction:"frontier"}];
function sampleInputs(layers,links=[pirateLink],controller={manualOrder:{type:"attack",targetID:20}}){
 return {systemID,scene,links,pilots,fleetShips,
  getHealth:()=>layers,
  getController:id=>id===10?controller:null};
}
test("real stock miner native HP drop is observed only after a previous sample",()=>{
 let now=1000000;
 const director=createStockFleetCombatEvidence({clock:()=>now});
 assert.equal(director.sample(sampleInputs({shield:100,armor:100,structure:100})).damageEvents,0);
 now+=5000;
 const r=director.sample(sampleInputs({shield:71,armor:100,structure:100}));
 assert.equal(r.damageEvents,1);
 assert.equal(r.events[0].healthLossHP,29);
 assert.deepEqual(r.events[0].attackerPilotIDs,["coop-pilot-010"]);
 assert.equal(r.events[0].victimEntityID,20);
 assert.match(r.events[0].attribution,/NOT_HIT_CREDIT/);
});
test("no fake native damage on absent attack order, nonfleet hull or player ship",()=>{
 let now=1000000;
 const director=createStockFleetCombatEvidence({clock:()=>now});
 director.sample(sampleInputs({shield:100,armor:100,structure:100}));
 now+=5000;
 assert.equal(director.sample(sampleInputs({shield:80,armor:100,structure:100},[pirateLink],
  {manualOrder:null})).damageEvents,0);
 const invalid=sampleInputs({shield:40,armor:100,structure:100});
 invalid.fleetShips=[];
 assert.equal(director.sample(invalid).damageEvents,0);
 const invalidPlayer=sampleInputs({shield:20,armor:100,structure:100});
 invalidPlayer.scene={...scene,sessions:new Map([[1,{_space:{shipID:20}}]])};
 assert.equal(director.sample(invalidPlayer).damageEvents,0);
});
test("named miner stays on named combat witness, no duplicate stock damage report",()=>{
 let now=1000000;const director=createStockFleetCombatEvidence({clock:()=>now});
 const links=[pirateLink,namedMiner];
 director.sample(sampleInputs({shield:100,armor:100,structure:100},links));
 now+=5000;
 assert.equal(director.sample(sampleInputs({shield:10,armor:100,structure:100},links)).damageEvents,0);
});
test("actual native module activation on stock miner is a witness, never a hit",()=>{
 const data={scene,attacker:pirate,target:miner,kind:"module-activation",
  moduleID:3000,links:[pirateLink],pilots,fleetShips};
 const proof=verify(data);
 assert.equal(proof.status,"VERIFIED_NATIVE_STOCK_FLEET_WEAPON_EVENT");
 assert.equal(proof.victimRole,"miner");
 assert.equal(proof.victimPilotID,undefined);
 assert.equal(proof.healthLossHP,undefined);
 assert.equal(verify({...data,fleetShips:[]}).status,"UNLINKED_NPC");
 assert.equal(verify({...data,links:[{...pirateLink,role:"trader"}]}).status,"UNLINKED_NPC");
 assert.equal(verify({...data,kind:"missile-launch",chargeTypeID:0}).status,"MISSILE_TYPE_MISSING");
 const playerScene={...scene,sessions:new Map([[1,{_space:{shipID:20}}]])};
 assert.equal(verify({...data,scene:playerScene}).status,"PLAYER_SHIP");
});
test("StockRaid report pairs genuine weapon and physical HP drop but not a wreck",()=>{
 const now=Date.parse("2026-10-25T09:00:00Z");
 const ev=(name,offset,extra={})=>JSON.stringify({
  at:new Date(now+offset*1000).toISOString(),event:name,
  systemID,...extra
 });
 const topology=ev("living-world-topology",1,{realWaypoints:5,realAsteroidBelts:3});
 const weapon=ev("living-native-weapon-event",10,{
  status:"VERIFIED_NATIVE_STOCK_FLEET_WEAPON_EVENT",
  attackerEntityID:10,attackerPilotID:"coop-pilot-010",
  victimEntityID:20,victimRole:"miner",kind:"module-activation",moduleID:3000
 });
 const damage=ev("living-native-stock-fleet-combat",15,{
  status:"SAMPLED",damageEvents:1,
  events:[{systemID,victimEntityID:20,victimRole:"miner",
   healthLossHP:29,attackerPilotIDs:["coop-pilot-010"],attackerEntityIDs:[10]}]
 });
 const opts={now:now+20000,systemID,requireStockRaid:true};
 const paired=summarize([topology,weapon,damage].join("\n"),opts);
 assert.equal(paired.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(paired.stockRaid.status,"CORRELATED_STOCK_FLEET_WEAPON_AND_HP_LOSS");
 assert.equal(paired.stockRaid.correlatedVictimEntityID,20);
 assert.equal(paired.combat.physicalWrecks,0);
 assert.equal(summarize([topology,weapon].join("\n"),opts).status,
  "AWAITING_STOCK_FLEET_WEAPON_HP_CHAIN");
 const elsewhere=damage.replace('"victimEntityID":20','"victimEntityID":21');
 assert.equal(summarize([topology,weapon,elsewhere].join("\n"),opts).status,
  "AWAITING_STOCK_FLEET_WEAPON_HP_CHAIN");
});
