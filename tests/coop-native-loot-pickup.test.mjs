import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verify}=require("../integration/coopNativeLootPickupEvidence.cjs");
const {summarize}=require("../scripts/coop-world-report.cjs");
const systemID=30000144,characterID=51001,wreckItemID=82001;
const wreck={wreckID:91001,sourceEntityID:12001,systemID};
const nativeWreck={itemID:wreck.wreckID,nativeNpcWreck:true,launcherID:12001};
const pilotShip={itemID:77001,kind:"ship"};
const session={characterID,clientID:44001,_space:{shipID:77001,systemID}};
const scene={systemID,sessions:new Map([[1,session]]),
 getEntityByID:id=>id===wreck.wreckID?nativeWreck:id===77001?pilotShip:null};
const sourceBefore={wreckID:wreck.wreckID,wreckItemID,typeID:34,quantity:6};
const base=()=>({scene,wreck,characterID,wreckItemID,
 destinationLocationID:77001,sourceBefore,
 sourceAfter:null,availableQuantity:6,requestedQuantity:6,
 grantResult:{success:true,data:{quantity:6,
  changes:[{item:{itemID:99001,ownerID:characterID,locationID:77001,
   typeID:34,quantity:6}}]}}});
test("native complete pickup requires authenticated physical player and depleted source",()=>{
 const r=verify(base());
 assert.equal(r.status,"VERIFIED_NATIVE_LOOT_PICKUP");
 assert.equal(r.characterID,characterID);
 assert.equal(r.shipID,77001);
 assert.equal(r.remainingQuantity,0);
 assert.equal(r.wreckID,wreck.wreckID);
});
test("partial native pickup requires exact remaining source quantity",()=>{
 const b={...base(),requestedQuantity:2,
  sourceAfter:{...sourceBefore,quantity:4},
  grantResult:{...base().grantResult,data:{...base().grantResult.data,quantity:2}}};
 const v=verify(b);
 assert.equal(v.status,"VERIFIED_NATIVE_LOOT_PICKUP");
 assert.equal(v.remainingQuantity,4);
 assert.equal(verify({...b,sourceAfter:{...sourceBefore,quantity:5}}).status,
  "NATIVE_LOOT_SOURCE_NOT_DECREMENTED");
});
test("no false pickup proof when upstream granted but wreck source still exists",()=>{
 const b=base();
 assert.equal(verify({...b,sourceAfter:sourceBefore}).status,
  "NATIVE_LOOT_SOURCE_NOT_REMOVED");
 assert.equal(verify({...b,grantResult:{success:false,errorMsg:"OUT_OF_SPACE"}}).status,
  "NATIVE_GRANT_NOT_CONFIRMED");
 assert.equal(verify({...b,grantResult:{success:true,data:{quantity:6,changes:[]}}}).status,
  "NATIVE_GRANT_DESTINATION_UNVERIFIED");
 assert.equal(verify({...b,destinationLocationID:77002}).status,
  "NATIVE_GRANT_DESTINATION_UNVERIFIED");
});
test("reject fake wrecks, fabricated sessions and wrong source records",()=>{
 const b=base();
 assert.equal(verify({...b,scene:{...scene,getEntityByID:()=>null}}).status,
  "NO_PHYSICAL_NATIVE_WRECK");
 assert.equal(verify({...b,scene:{...scene,sessions:new Map()}}).status,
  "NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 // An upstream source-debit failure must be quarantined even if the
 // character disconnected between item grant and evidence observation.
 assert.equal(verify({...b,scene:{...scene,sessions:new Map()},
  sourceAfter:sourceBefore}).status,"NATIVE_LOOT_SOURCE_NOT_REMOVED");
 assert.equal(verify({...b,scene:{...scene,sessions:new Map([[1,session],[2,{...session}]])}}).status,
  "NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 assert.equal(verify({...b,sourceBefore:{...sourceBefore,wreckItemID:555}}).status,
  "INVALID_LOOT_WITNESS");
 assert.equal(verify({...b,requestedQuantity:7}).status,"INVALID_LOOT_WITNESS");
});

test("LootPickup gate requires same wreck, real source debit, and authenticated looter",()=>{
 const now=Date.parse("2026-10-25T09:00:00Z");
 const ev=(event,t,extra={})=>JSON.stringify({
  at:new Date(now+t*1000).toISOString(),event,systemID,...extra
 });
 const topology=ev("living-world-topology",1,{realWaypoints:5,realAsteroidBelts:3});
 const weapon=ev("living-native-weapon-event",3,{
  status:"VERIFIED_NATIVE_STOCK_FLEET_WEAPON_EVENT",
  attackerEntityID:10,attackerPilotID:"coop-pilot-010",
  victimEntityID:20,victimRole:"miner",kind:"module-activation",moduleID:888
 });
 const damage=ev("living-native-stock-fleet-combat",7,{
  status:"SAMPLED",events:[{victimEntityID:20,healthLossHP:40,
   attackerPilotIDs:["coop-pilot-010"],attackerEntityIDs:[10]}]
 });
 const wreckEvent=ev("living-native-stock-fleet-wreck-evidence",10,{
  status:"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED",wreckID:91001,
  victimEntityID:20,victimRole:"miner",lootStatus:"ITEMS_STORED",
  storedItemCount:2,storedQuantity:6
 });
 const pickup=ev("living-native-loot-pickup",13,{
  status:"VERIFIED_NATIVE_LOOT_PICKUP",wreckID:91001,
  wreckItemID:82001,characterID:51001,shipID:77001,quantity:2,remainingQuantity:4
 });
 const opts={now:now+20000,systemID,requireStockRaid:true,
  requireStockWreckLoot:true,requireNativeLootPickup:true};
 const base=[topology,weapon,damage,wreckEvent];
 assert.equal(summarize([...base,pickup].join("\n"),opts).status,
  "READY_FOR_CLIENT_PLAYTEST");
 assert.equal(summarize(base.join("\n"),opts).status,
  "AWAITING_AUTHENTICATED_NATIVE_LOOT_PICKUP");
 const other=pickup.replace('"wreckID":91001','"wreckID":91002');
 assert.equal(summarize([...base,other].join("\n"),opts).status,
  "AWAITING_AUTHENTICATED_NATIVE_LOOT_PICKUP");
 const failed=pickup.replace("VERIFIED_NATIVE_LOOT_PICKUP","NATIVE_LOOT_SOURCE_NOT_REMOVED");
 assert.equal(summarize([...base,failed].join("\n"),opts).status,
  "BLOCKED_NATIVE_LOOT_SOURCE_MUTATION");
 assert.equal(summarize([...base,pickup,failed].join("\n"),opts).status,
  "BLOCKED_NATIVE_LOOT_SOURCE_MUTATION");
 const partial=pickup.replace("VERIFIED_NATIVE_LOOT_PICKUP","NATIVE_LOOT_SOURCE_NOT_DECREMENTED");
 assert.equal(summarize([...base,pickup,partial].join("\n"),opts).status,
  "BLOCKED_NATIVE_LOOT_SOURCE_MUTATION");
});
