import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarPatrolLoadout,RETAIL_EMPTY_LOADOUT_ID}=
 require("../integration/coopWarPatrolLoadout.cjs");

// Real shapes only: npcProfiles rows carry loadoutID, npcLoadouts rows carry
// modules [{typeID,quantity}] and charges [{typeID,quantityPerModule}], and the
// item registry resolves categoryID 7 (module) / 8 (charge).
const TURRET=13773,CHARGE=20767,MINER=482,OFF_GROUP_CHARGE=21270;
const ITEMS=new Map([
 [TURRET,{typeID:TURRET,groupID:55,categoryID:7,name:"Domination 125mm Autocannon"}],
 [CHARGE,{typeID:CHARGE,groupID:83,categoryID:8,name:"Domination EMP S"}],
 [MINER,{typeID:MINER,groupID:54,categoryID:7,name:"Miner II"}],
 [OFF_GROUP_CHARGE,{typeID:OFF_GROUP_CHARGE,groupID:83,categoryID:8,name:"Radio S"}],
]);
function fixture(){
 const profiles=new Map(),loadouts=new Map();
 const add=(loadoutID,row)=>loadouts.set(loadoutID,{loadoutID,name:loadoutID,
  modules:[],charges:[],...(row||{})});
 const addProfile=(profileID,loadoutID)=>profiles.set(profileID,{profileID,loadoutID});
 let compatible=(module,chargeTypeID)=>chargeTypeID===CHARGE;
 const api=createWarPatrolLoadout({
  getProfile:id=>profiles.get(String(id))||null,
  getLoadout:id=>loadouts.get(String(id))||null,
  resolveItemByTypeID:id=>ITEMS.get(Number(id))||null,
  resolveWeaponFamily:item=>Number(item&&item.typeID)===MINER?"mining":
   Number(item&&item.typeID)===TURRET?"projectileTurret":"",
  isCompatibleCharge:(module,chargeTypeID)=>compatible(module,chargeTypeID),
 });
 return {api,add,addProfile,compatible:v=>compatible=v,profiles,loadouts};
}
const armed={modules:[{typeID:TURRET,quantity:3}],
 charges:[{typeID:CHARGE,quantityPerModule:1,singleton:true}]};

test("every native authority is required",()=>{
 assert.throws(()=>createWarPatrolLoadout({}),/WAR_PATROL_LOADOUT_AUTHORITIES_REQUIRED/);
 assert.throws(()=>createWarPatrolLoadout({
  getProfile:()=>null,getLoadout:()=>null,resolveItemByTypeID:()=>null,
  resolveWeaponFamily:()=>""}),/WAR_PATROL_LOADOUT_AUTHORITIES_REQUIRED/);
});
test("a pirate profile on the retail empty row resolves its own authored row",()=>{
 const f=fixture();
 f.addProfile("parity_angel_autocannon_frigate",RETAIL_EMPTY_LOADOUT_ID);
 f.add("parity_angel_autocannon_frigate_loadout",armed);
 const x=f.api.resolve({profileID:"parity_angel_autocannon_frigate"});
 assert.equal(x.status,"RESOLVED");
 assert.equal(x.override,true);
 assert.equal(x.loadoutID,"parity_angel_autocannon_frigate_loadout");
 assert.equal(x.moduleTypeID,TURRET);
 assert.equal(x.chargeTypeID,CHARGE);
 assert.equal(x.moduleFamily,"projectileTurret");
});
test("an already armed authored loadout is never overridden",()=>{
 const f=fixture();
 f.addProfile("concord_police_cruiser","concord_medium_beam_laser_cruiser_mwd");
 f.add("concord_medium_beam_laser_cruiser_mwd",armed);
 f.add("concord_police_cruiser_loadout",armed);
 const x=f.api.resolve({profileID:"concord_police_cruiser"});
 assert.equal(x.status,"ALREADY_ARMED");
 assert.equal(x.override,false);
 assert.equal(x.loadoutID,"concord_medium_beam_laser_cruiser_mwd");
});
test("no authored row, a mining-only row and the retail row all refuse",()=>{
 const f=fixture();
 f.addProfile("angel_raider",RETAIL_EMPTY_LOADOUT_ID);
 assert.equal(f.api.resolve({profileID:"angel_raider"}).reason,"LOADOUT_ROW_MISSING");
 f.add("angel_raider_loadout",{modules:[{typeID:MINER,quantity:1}]});
 assert.equal(f.api.resolve({profileID:"angel_raider"}).reason,"NO_REAL_WEAPON_MODULE");
 const retail=f.api.resolve({profileID:"angel_raider",loadoutID:RETAIL_EMPTY_LOADOUT_ID});
 assert.equal(retail.status,"REFUSED");
 assert.equal(retail.reason,"RETAIL_EMPTY_LOADOUT");
});
test("an incompatible or unknown charge is not accepted as ammo",()=>{
 const f=fixture();
 f.addProfile("parity_angel_autocannon_frigate",RETAIL_EMPTY_LOADOUT_ID);
 f.add("parity_angel_autocannon_frigate_loadout",
  {modules:[{typeID:TURRET,quantity:1}],
   charges:[{typeID:OFF_GROUP_CHARGE,quantityPerModule:1}]});
 assert.equal(f.api.resolve({profileID:"parity_angel_autocannon_frigate"}).reason,
  "NO_COMPATIBLE_CHARGE");
 f.loadouts.set("parity_angel_autocannon_frigate_loadout",
  {loadoutID:"parity_angel_autocannon_frigate_loadout",
   modules:[{typeID:TURRET,quantity:1}],
   charges:[{typeID:999999,quantityPerModule:1}]});
 assert.equal(f.api.resolve({profileID:"parity_angel_autocannon_frigate"}).reason,
  "NO_COMPATIBLE_CHARGE");
 f.loadouts.set("parity_angel_autocannon_frigate_loadout",
  {loadoutID:"parity_angel_autocannon_frigate_loadout",
   modules:[{typeID:999999,quantity:1}],charges:[{typeID:CHARGE}]});
 assert.equal(f.api.resolve({profileID:"parity_angel_autocannon_frigate"}).reason,
  "LOADOUT_MODULE_UNVERIFIED");
});
test("an explicit loadout row wins and a missing profile is explicit",()=>{
 const f=fixture();
 f.addProfile("parity_serpentis_blaster_cruiser",RETAIL_EMPTY_LOADOUT_ID);
 f.add("coop_war_patrol_cruiser",armed);
 const x=f.api.resolve({profileID:"parity_serpentis_blaster_cruiser",
  loadoutID:"coop_war_patrol_cruiser"});
 assert.equal(x.status,"RESOLVED");
 assert.equal(x.loadoutID,"coop_war_patrol_cruiser");
 assert.equal(f.api.resolve({}).reason,"PROFILE_REQUIRED");
 assert.equal(f.api.resolve({profileID:"nobody"}).reason,"PROFILE_NOT_FOUND");
});
test("an oversized row is refused instead of fitted",()=>{
 const f=fixture();
 f.addProfile("parity_angel_autocannon_frigate",RETAIL_EMPTY_LOADOUT_ID);
 f.add("parity_angel_autocannon_frigate_loadout",
  {modules:Array.from({length:33},()=>({typeID:TURRET,quantity:1}))});
 assert.equal(f.api.resolve({profileID:"parity_angel_autocannon_frigate"}).reason,
  "LOADOUT_TOO_LARGE");
});

// FW-003C ammo depth: one fitted charge is one volley (the native ammo bank
// debits exactly one unit per cycle), so a real multi-charge row is preferred
// and a single-charge row is refused when depth is required.
const {authoredIDFor}=require("../integration/coopWarPatrolLoadoutRow.cjs");
function deepFixture(){
 const f=fixture();
 // The authored row is the real row with a real ammo depth; the resolver sees it
 // exactly as the deployed static-table hook would.
 f.api=createWarPatrolLoadout({
  getProfile:id=>f.profiles.get(String(id))||null,
  getLoadout:id=>f.loadouts.get(String(id))||null,
  resolveItemByTypeID:id=>ITEMS.get(Number(id))||null,
  resolveWeaponFamily:item=>Number(item&&item.typeID)===TURRET?"projectileTurret":"",
  isCompatibleCharge:(module,chargeTypeID)=>Number(chargeTypeID)===CHARGE,
  getAuthoredRow:(baseID,depth)=>authoredIDFor(baseID,depth),
  ammoDepth:60,
 });
 f.authorDepth=(baseID,depth)=>{
  const id=authoredIDFor(baseID,depth);
  f.loadouts.set(id,{loadoutID:id,name:baseID+" deep",
   modules:[{typeID:TURRET,quantity:3}],
   charges:[{typeID:CHARGE,quantityPerModule:depth,singleton:true}]});
  return id;
 };
 return f;
}
test("a single-charge row is deepened to the real multi-charge row",()=>{
 const f=deepFixture();
 f.addProfile("parity_angel_autocannon_frigate",RETAIL_EMPTY_LOADOUT_ID);
 f.add("parity_angel_autocannon_frigate_loadout",armed);
 f.authorDepth("parity_angel_autocannon_frigate_loadout",60);
 const x=f.api.resolve({profileID:"parity_angel_autocannon_frigate",requireAmmoDepth:true});
 assert.equal(x.status,"RESOLVED");
 assert.equal(x.reason,"AUTHORED_MULTI_CHARGE_ROW");
 assert.equal(x.loadoutID,authoredIDFor("parity_angel_autocannon_frigate_loadout",60));
 assert.equal(x.chargeDepth,60);
 assert.equal(x.chargeTypeID,CHARGE,"the real charge type is unchanged");
});
test("without a real multi-charge row a one-volley patrol is refused",()=>{
 const f=deepFixture();
 f.addProfile("parity_angel_autocannon_frigate",RETAIL_EMPTY_LOADOUT_ID);
 f.add("parity_angel_autocannon_frigate_loadout",armed);
 const x=f.api.resolve({profileID:"parity_angel_autocannon_frigate",requireAmmoDepth:true});
 assert.equal(x.status,"REFUSED");
 assert.equal(x.reason,"NO_MULTI_CHARGE_ROW");
 assert.equal(x.chargeDepth,1);
 const loose=f.api.resolve({profileID:"parity_angel_autocannon_frigate"});
 assert.equal(loose.status,"RESOLVED","an explicit caller may still ask for the real row");
 assert.equal(loose.chargeDepth,1);
});
test("an already armed row is deepened instead of left at one volley",()=>{
 const f=deepFixture();
 f.addProfile("concord_police_cruiser","concord_medium_beam_laser_cruiser_mwd");
 f.add("concord_medium_beam_laser_cruiser_mwd",armed);
 f.authorDepth("concord_medium_beam_laser_cruiser_mwd",60);
 const x=f.api.resolve({profileID:"concord_police_cruiser",requireAmmoDepth:true});
 assert.equal(x.status,"ALREADY_ARMED");
 assert.equal(x.reason,"PROFILE_LOADOUT_ALREADY_ARMED_DEEPENED");
 assert.equal(x.chargeDepth,60);
});
