import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarDoctrine,DOCTRINES,MODULES,ROLES,doctrineIDFor,parseDoctrineID}=
 require("../integration/coopWarDoctrine.cjs");

// Real shapes only: npcProfiles rows carry profileID/shipTypeID, npcLoadouts rows
// carry modules [{typeID,quantity}] and charges [{typeID,quantityPerModule}], the
// item registry resolves categoryID 6 (hull) / 7 (module) / 8 (charge), and the
// fitting service reports a slot family per module type.
const UTILITY=new Set([MODULES.warpDisruptor2,MODULES.warpScrambler2,MODULES.stasisWeb2,
 MODULES.sensorDampener2,MODULES.trackingDisruptor2,MODULES.remoteShield2,
 MODULES.remoteShieldSmall2,MODULES.remoteArmor1,MODULES.remoteArmorSmall1,
 MODULES.damageControl2]);
const MED=new Set([MODULES.warpDisruptor2,MODULES.warpScrambler2,MODULES.stasisWeb2,
 MODULES.sensorDampener2,MODULES.trackingDisruptor2]);
const LOW=new Set([MODULES.damageControl2]);
const CHARGES=[
 {typeID:222,name:"Antimatter Charge S"},{typeID:230,name:"Antimatter Charge M"},
 {typeID:238,name:"Antimatter Charge L"},{typeID:235,name:"Thorium Charge L"},
 {typeID:185,name:"EMP S"},{typeID:183,name:"EMP M"},
 {typeID:210,name:"Scourge Light Missile"},{typeID:209,name:"Scourge Heavy Missile"},
 {typeID:203,name:"Scourge Cruise Missile"},
];
const CHARGE_GROUP={222:"S",230:"M",238:"L",235:"L",185:"S",183:"M",210:"light",209:"heavy",203:"cruise"};
const MODULE_CHARGE=new Map([
 [MODULES.lightNeutronBlaster1,"S"],[MODULES.lightElectronBlaster1,"S"],
 [MODULES.heavyNeutronBlaster1,"M"],[MODULES.heavyElectronBlaster1,"M"],
 [MODULES.neutronBlasterCannon1,"L"],[MODULES.rail425,"L"],[MODULES.rail250,"M"],
 [MODULES.rail75,"S"],[MODULES.gatling125,"S"],[MODULES.autoCannon200,"M"],
 [MODULES.lightMissile2,"light"],[MODULES.heavyMissile2,"heavy"],
 [MODULES.cruiseLauncher1,"cruise"],
]);

function fixture(options={}){
 const profiles=new Map(),items=new Map(),hulls=new Map();
 const addHull=(typeID,row)=>hulls.set(typeID,{high:0,med:0,low:0,...row});
 const addProfile=(profileID,shipTypeID)=>{
  profiles.set(profileID,{profileID,shipTypeID});
  if(!items.has(shipTypeID))items.set(shipTypeID,{typeID:shipTypeID,categoryID:11,
   name:"Hull "+shipTypeID,groupName:"Mission Caldari State Cruiser"});
 };
 for(const [factionID,table] of Object.entries(DOCTRINES)){
  for(const spec of Object.values(table)) addProfile(spec.profileID,900000+Number(spec.profileID.length));
 }
 for(const id of Object.values(MODULES)){
  items.set(id,{typeID:id,categoryID:7,name:"Module "+id});
 }
 const broken=new Set(options.brokenModules||[]);
 const chargeOverride=options.chargeOverride||null;
 const api=createWarDoctrine({
  getProfile:id=>profiles.get(String(id))||null,
  resolveItemByTypeID:id=>broken.has(Number(id))?null:(items.get(Number(id))||null),
  resolveWeaponFamily:item=>UTILITY.has(Number(item&&item.typeID))?"":"hybridTurret",
  isCompatibleCharge:(module,chargeTypeID)=>{
   if(chargeOverride) return chargeOverride(module,chargeTypeID);
   const wanted=MODULE_CHARGE.get(Number(module&&module.typeID));
   return !!wanted&&CHARGE_GROUP[chargeTypeID]===wanted;
  },
  listCharges:()=>CHARGES,
  slotFamilyFor:id=>LOW.has(Number(id))?"low":MED.has(Number(id))?"med":"high",
  hullSlotsFor:id=>hulls.get(Number(id))||{high:0,med:0,low:0},
  dogmaAttributeCountFor:id=>(options.noDogma||[]).includes(Number(id))?0:70,
 });
 return {api,addHull,addProfile,items,profiles,hulls};
}

test("every native authority is required and resolved lazily",()=>{
 // Lazy on purpose: the same module is loaded from the static-table resolver
 // inside npcData, where the SDE services may not be reachable yet.
 const api=createWarDoctrine({});
 assert.equal(typeof api.resolve,"function");
 assert.equal(api.resolve({factionID:0,role:"tackle"}).reason,"FACTION_REQUIRED");
 assert.throws(()=>createWarDoctrine({
  getProfile:()=>null,resolveItemByTypeID:()=>null,resolveWeaponFamily:()=>"",
  isCompatibleCharge:()=>false,listCharges:()=>[],slotFamilyFor:()=>"",
  dogmaAttributeCountFor:()=>0,
  hullSlotsFor:"not-a-function",
 }).resolve({factionID:500001,role:"tackle"}),/WAR_DOCTRINE_AUTHORITIES_REQUIRED/);
});

test("a real doctrine resolves into a real fitting with a real charge",()=>{
 const f=fixture();
 const x=f.api.resolve({factionID:500001,role:"tackle"});
 assert.equal(x.status,"RESOLVED");
 assert.equal(x.loadoutID,"coop_war_doctrine_500001_tackle");
 assert.equal(x.profileID,DOCTRINES[500001].tackle.profileID);
 assert.equal(x.modules.length,2);
 assert.equal(x.modules[0].typeID,MODULES.lightNeutronBlaster1);
 assert.equal(x.charges.length,1);
 assert.equal(x.charges[0].typeID,222);
 assert.equal(x.charges[0].quantityPerModule,60);
 assert.equal(x.hull.slotMode,"NATIVE_AUTOFIT_FALLBACK");
 assert.equal(x.hull.kind,"ENTITY_HULL");
 assert.equal(x.hull.dogmaAttributes,70);
 assert.equal(x.row.coopAuthored,true);
 assert.deepEqual(x.row.charges,[{typeID:222,quantityPerModule:60}]);
});

test("a hull without a real dogma record is refused, never fitted",()=>{
 const f=fixture({noDogma:[900000+DOCTRINES[500001].tackle.profileID.length]});
 const x=f.api.resolve({factionID:500001,role:"tackle"});
 assert.equal(x.status,"REFUSED");
 assert.equal(x.reason,"HULL_DOGMA_MISSING");
});

test("a hull that really declares slots must have enough of them",()=>{
 const f=fixture();
 const spec=DOCTRINES[500001].brawler;
 f.addProfile(spec.profileID,777001);
 f.addHull(777001,{high:2,med:2,low:1});
 const short=f.api.resolve({factionID:500001,role:"brawler"});
 assert.equal(short.status,"REFUSED");
 assert.equal(short.reason,"HULL_SLOT_SHORT");
 assert.equal(short.slot,"high");
 assert.equal(short.needed,4);
 f.addHull(777001,{high:6,med:4,low:2});
 const ok=f.api.resolve({factionID:500001,role:"brawler"});
 assert.equal(ok.status,"RESOLVED");
 assert.equal(ok.hull.slotMode,"HULL_SLOTS");
});

test("unknown faction, unknown role and an unsupported doctrine refuse",()=>{
 const f=fixture();
 assert.equal(f.api.resolve({factionID:0,role:"tackle"}).reason,"FACTION_REQUIRED");
 assert.equal(f.api.resolve({factionID:500002,role:"tackle"}).reason,"FACTION_UNSUPPORTED");
 assert.equal(f.api.resolve({factionID:500001,role:"capital"}).reason,"ROLE_UNKNOWN");
 assert.equal(f.api.resolve({factionID:500004,role:"sniper"}).status,"RESOLVED");
});

test("a missing profile, an unverified module and a missing charge refuse",()=>{
 const f=fixture();
 f.profiles.delete(DOCTRINES[500001].tackle.profileID);
 assert.equal(f.api.resolve({factionID:500001,role:"tackle"}).reason,"PROFILE_MISSING");
 const g=fixture({brokenModules:[MODULES.rail425]});
 const sniper=g.api.resolve({factionID:500004,role:"sniper"});
 assert.equal(sniper.reason,"MODULE_UNVERIFIED");
 const h=fixture({chargeOverride:()=>false});
 assert.equal(h.api.resolve({factionID:500001,role:"tackle"}).reason,"NO_COMPATIBLE_CHARGE");
});

test("a doctrine whose ammo pattern matches no compatible charge refuses",()=>{
 const f=fixture({chargeOverride:(module,charge)=>Number(charge)!==222&&Number(charge)!==230});
 const x=f.api.resolve({factionID:500001,role:"tackle"});
 assert.equal(x.status,"REFUSED");
 assert.equal(x.reason,"CHARGE_NOT_FOUND");
});

test("a utility module that is a weapon is refused, not silently fitted",()=>{
 const f=fixture();
 const table=DOCTRINES[500001];
 const original=table.tackle.utility;
 try{
  table.tackle.utility=[{typeID:MODULES.heavyMissile2,quantity:1}];
  const x=f.api.resolve({factionID:500001,role:"tackle"});
  assert.equal(x.reason,"UTILITY_IS_WEAPON");
 }finally{ table.tackle.utility=original; }
});

test("the authored row is served through the one native loadout hook id",()=>{
 const f=fixture();
 const id=doctrineIDFor(500004,"logistics");
 assert.deepEqual(parseDoctrineID(id),{factionID:500004,role:"logistics"});
 assert.equal(parseDoctrineID("coop_war_doctrine_500004_nonsense"),null);
 assert.equal(parseDoctrineID("coop_war_patrol_ammo60_x"),null);
 const row=f.api.resolveRow(id);
 assert.equal(row.loadoutID,id);
 assert.equal(row.factionID,500004);
 assert.equal(row.role,"logistics");
 assert.ok(row.modules.some(entry=>entry.typeID===MODULES.remoteArmorSmall1));
 assert.equal(f.api.resolveRow("coop_war_doctrine_999999_tackle"),null);
});

test("the catalog reports every doctrine of a faction and refuses another",()=>{
 const f=fixture();
 const catalog=f.api.catalog({factionID:500001});
 assert.equal(catalog.status,"OK");
 assert.equal(catalog.doctrines.length,ROLES.length);
 assert.deepEqual(catalog.doctrines.map(entry=>entry.role).sort(),ROLES.slice().sort());
 const unsupported=f.api.catalog({factionID:123});
 assert.equal(unsupported.status,"REFUSED");
 assert.equal(unsupported.reason,"FACTION_UNSUPPORTED");
});
