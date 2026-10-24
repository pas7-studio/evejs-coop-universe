import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStockFleetCombatEvidence}=require("../integration/coopStockFleetCombatEvidence.cjs");
const {verify}=require("../integration/coopNpcWeaponEvidence.cjs");
const {summarize}=require("../scripts/coop-world-report.cjs");
const {verifyStockFleetWreck}=require("../integration/coopStockFleetWreckEvidence.cjs");
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

test("native mining wreck requires actual fleet membership, physical entity and stored items",()=>{
 const wreckID=901;
 const wreck={wreckID,systemID,sourceEntityID:20,launcherID:20};
 const nativeWreck={itemID:901,nativeNpcWreck:true,launcherID:20};
 const wreckScene={systemID,getEntityByID:id=>id===901?nativeWreck:null};
 const items=[{wreckItemID:5001,wreckID,typeID:34,quantity:120}];
 const params={systemID,ship:miner,wreckID,scene:wreckScene,
  fleets:[{systemID,minerEntityIDs:[20]}],
  getWreck:()=>wreck,getWreckItems:()=>items};
 const result=verifyStockFleetWreck(params);
 assert.equal(result.status,"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED");
 assert.equal(result.storedItemCount,1);
 assert.equal(result.storedQuantity,120);
 assert.equal(verifyStockFleetWreck({...params,fleets:[]}).status,
  "NOT_ACTIVE_NATIVE_STOCK_FLEET");
 assert.equal(verifyStockFleetWreck({...params,scene:{...wreckScene,getEntityByID:()=>null}}).status,
  "STOCK_WRECK_NOT_PHYSICAL");
 assert.equal(verifyStockFleetWreck({...params,ship:{...miner,nativeNpc:false}}).status,
  "INVALID_STOCK_WRECK");
 assert.equal(verifyStockFleetWreck({...params,getWreckItems:()=>[{...items[0],quantity:0}]}).status,
  "INVALID_STOCK_WRECK_ITEMS");
 const empty=verifyStockFleetWreck({...params,getWreckItems:()=>[]});
 assert.equal(empty.status,"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED");
 assert.equal(empty.lootStatus,"NATIVE_WRECK_EMPTY");
});
test("StockRaidLoot requires the same native victim weapon -> HP -> physical loot wreck",()=>{
 const now=Date.parse("2026-10-25T09:00:00Z");
 const row=(event,t,extra={})=>JSON.stringify({
  at:new Date(now+t*1000).toISOString(),event,systemID,...extra
 });
 const topology=row("living-world-topology",1,{realWaypoints:3,realAsteroidBelts:3});
 const weapon=row("living-native-weapon-event",4,{
  status:"VERIFIED_NATIVE_STOCK_FLEET_WEAPON_EVENT",
  attackerEntityID:10,attackerPilotID:"coop-pilot-010",
  victimEntityID:20,victimRole:"miner",kind:"module-activation",moduleID:3000
 });
 const damage=row("living-native-stock-fleet-combat",9,{
  status:"SAMPLED",events:[{victimEntityID:20,healthLossHP:40,
   attackerPilotIDs:["coop-pilot-010"],attackerEntityIDs:[10]}]
 });
 const wreck=row("living-native-stock-fleet-wreck-evidence",12,{
  status:"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED",wreckID:901,
  victimEntityID:20,victimRole:"miner",lootStatus:"ITEMS_STORED",
  storedItemCount:1,storedQuantity:120
 });
 const opts={now:now+20000,systemID,requireStockWreckLoot:true,requireStockRaid:true};
 const good=summarize([topology,weapon,damage,wreck].join("\n"),opts);
 assert.equal(good.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(good.stockRaid.correlatedWreckWithStoredLootID,901);
 assert.equal(good.stockRaid.status,"CORRELATED_STOCK_WEAPON_HP_WRECK_AND_STORED_LOOT");
 const empty=wreck.replace('"storedItemCount":1','"storedItemCount":0');
 assert.equal(summarize([topology,weapon,damage,empty].join("\n"),opts).status,
  "AWAITING_STOCK_FLEET_WRECK_LOOT_CHAIN");
 const wrong=wreck.replace('"victimEntityID":20','"victimEntityID":21');
 assert.equal(summarize([topology,weapon,damage,wrong].join("\n"),opts).status,
  "AWAITING_STOCK_FLEET_WRECK_LOOT_CHAIN");
 const early=row("living-native-stock-fleet-wreck-evidence",7,{
  status:"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED",wreckID:901,
  victimEntityID:20,lootStatus:"ITEMS_STORED",storedItemCount:1
 });
 assert.equal(summarize([topology,weapon,damage,early].join("\n"),opts).status,
  "AWAITING_STOCK_FLEET_WRECK_LOOT_CHAIN");
});

test("native stock miner death between samples records only actual fresh terminal HP loss",()=>{
 let now=1000000;
 const director=createStockFleetCombatEvidence({clock:()=>now});
 const baseline={shield:100,armor:50,structure:20};
 const old=director.sample(sampleInputs(baseline));
 assert.equal(old.damageEvents,0);
 now+=3000;
 const terminal=director.terminalDamage({
  systemID,entityID:20,ship:miner,wreckID:901,
  getHealth:()=>({shield:70,armor:40,structure:10})
 });
 assert.equal(terminal.status,"NATIVE_STOCK_TERMINAL_HP_DROP");
 assert.equal(terminal.event.healthLossHP,50);
 assert.equal(terminal.event.nativeWreckID,901);
 assert.deepEqual(terminal.event.attackerPilotIDs,["coop-pilot-010"]);
 assert.match(terminal.event.attribution,/NOT_KILL_CREDIT/);
 assert.equal(director.terminalDamage({
  systemID,entityID:20,ship:miner,wreckID:901,getHealth:()=>({shield:0,armor:0,structure:0})
 }).status,"NO_PRIOR_PHYSICAL_STOCK_SAMPLE");
});
test("native terminal HP refuses stale, copied ships, missing orders and unobserved loss",()=>{
 let now=1000000;
 const stale=createStockFleetCombatEvidence({clock:()=>now});
 stale.sample(sampleInputs({shield:100,armor:50,structure:20}));
 now+=30001;
 assert.equal(stale.terminalDamage({systemID,entityID:20,ship:miner,wreckID:901,
  getHealth:()=>({shield:0,armor:0,structure:0})}).status,"STALE_STOCK_TERMINAL_HP");
 let now2=1000000;
 const fresh=createStockFleetCombatEvidence({clock:()=>now2});
 fresh.sample(sampleInputs({shield:100,armor:50,structure:20}));
 now2+=1000;
 assert.equal(fresh.terminalDamage({systemID,entityID:20,ship:{...miner},wreckID:901,
  getHealth:()=>({shield:0,armor:0,structure:0})}).status,
  "NO_PRIOR_PHYSICAL_STOCK_SAMPLE");
 assert.equal(fresh.terminalDamage({systemID,entityID:20,ship:miner,wreckID:901,
  getHealth:()=>({shield:100,armor:50,structure:20})}).status,
  "NO_OBSERVED_STOCK_TERMINAL_LOSS");
 const unordered=createStockFleetCombatEvidence({clock:()=>now2});
 unordered.sample(sampleInputs({shield:100,armor:50,structure:20},[pirateLink],
  {manualOrder:null}));
 now2+=1000;
 assert.equal(unordered.terminalDamage({systemID,entityID:20,ship:miner,wreckID:901,
  getHealth:()=>({shield:0,armor:0,structure:0})}).status,
  "NO_PRIOR_VERIFIED_PIRATE_ATTACK_ORDER");
});
