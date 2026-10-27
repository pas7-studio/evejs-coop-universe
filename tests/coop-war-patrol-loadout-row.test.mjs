import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarPatrolLoadoutRow,authoredIDFor,parseAuthoredID,ID_PREFIX}=
 require("../integration/coopWarPatrolLoadoutRow.cjs");

// Real shapes only: a static npcLoadouts row carries modules [{typeID,quantity}]
// and charges [{typeID,quantityPerModule,singleton}], the item registry resolves
// categoryID 7 (module) / 8 (charge), and the native capability resolver decides
// which charge really fits which turret.
const TURRET=13773,CHARGE=20767,OTHER_CHARGE=21270,MINER=482,UNKNOWN=999999;
const ITEMS=new Map([
 [TURRET,{typeID:TURRET,groupID:55,categoryID:7,name:"Domination 125mm Autocannon"}],
 [CHARGE,{typeID:CHARGE,groupID:83,categoryID:8,name:"Domination EMP S"}],
 [OTHER_CHARGE,{typeID:OTHER_CHARGE,groupID:83,categoryID:8,name:"Radio S"}],
 [MINER,{typeID:MINER,groupID:54,categoryID:7,name:"Miner II"}],
]);
function fixture(rows){
 const table=rows||[
  {loadoutID:"parity_angel_autocannon_frigate_loadout",name:"Angel Autocannon Frigate",
   modules:[{typeID:TURRET,quantity:3}],
   charges:[{typeID:CHARGE,quantityPerModule:1,singleton:true}]},
 ];
 const api=createWarPatrolLoadoutRow({
  readStaticRows:()=>table,
  resolveItemByTypeID:id=>ITEMS.get(Number(id))||null,
  resolveWeaponFamily:item=>Number(item&&item.typeID)===TURRET?"projectileTurret":
   Number(item&&item.typeID)===MINER?"mining":"",
  isCompatibleCharge:(module,chargeTypeID)=>Number(chargeTypeID)===CHARGE,
 });
 return {api,table};
}

test("the authored row is the real row plus a real ammo depth",()=>{
 const {api}=fixture();
 const x=api.author({baseLoadoutID:"parity_angel_autocannon_frigate_loadout",ammoDepth:60});
 assert.equal(x.status,"AUTHORED");
 assert.equal(x.loadoutID,ID_PREFIX+"60_parity_angel_autocannon_frigate_loadout");
 assert.equal(x.ammoDepth,60);
 assert.equal(x.moduleCount,1);
 assert.equal(x.weaponCount,1);
 assert.deepEqual(x.chargeTypeIDs,[CHARGE]);
 assert.deepEqual(x.row.modules,[{typeID:TURRET,quantity:3}],"the real module is copied, never invented");
 assert.deepEqual(x.row.charges,[{typeID:CHARGE,quantityPerModule:60,singleton:true}]);
});

test("a missing base row, a mining-only row and an unverified module are refused",()=>{
 const {api,table}=fixture();
 assert.equal(api.author({baseLoadoutID:"nope",ammoDepth:60}).reason,"BASE_LOADOUT_ROW_MISSING");
 table.push({loadoutID:"miner_row",name:"Miner",modules:[{typeID:MINER,quantity:1}],
  charges:[{typeID:CHARGE,quantityPerModule:1}]});
 assert.equal(api.author({baseLoadoutID:"miner_row",ammoDepth:60}).reason,"NO_REAL_WEAPON_MODULE");
 table.push({loadoutID:"fake_row",name:"Fake",modules:[{typeID:UNKNOWN,quantity:1}],
  charges:[{typeID:CHARGE,quantityPerModule:1}]});
 assert.equal(api.author({baseLoadoutID:"fake_row",ammoDepth:60}).reason,"BASE_MODULE_UNVERIFIED");
 table.push({loadoutID:"no_charge_row",name:"No charge",modules:[{typeID:TURRET,quantity:1}],
  charges:[{typeID:OTHER_CHARGE,quantityPerModule:1}]});
 assert.equal(api.author({baseLoadoutID:"no_charge_row",ammoDepth:60}).reason,"NO_COMPATIBLE_CHARGE");
 table.push({loadoutID:"no_modules_row",name:"Empty",modules:[],charges:[]});
 assert.equal(api.author({baseLoadoutID:"no_modules_row",ammoDepth:60}).reason,
  "BASE_LOADOUT_HAS_NO_MODULES");
});

test("an ammo depth below two or above the cap is refused, never clamped silently",()=>{
 const {api}=fixture();
 const base="parity_angel_autocannon_frigate_loadout";
 for(const depth of [0,1,-5,1001,1.5])
  assert.equal(api.author({baseLoadoutID:base,ammoDepth:depth}).reason,
   "AMMO_DEPTH_OUT_OF_RANGE",String(depth));
 assert.equal(api.author({}).reason,"BASE_LOADOUT_REQUIRED");
});

test("the authored loadout ID round-trips and rejects foreign forms",()=>{
 const base="parity_angel_autocannon_frigate_loadout";
 assert.equal(authoredIDFor(base,60),ID_PREFIX+"60_"+base);
 assert.equal(authoredIDFor(base,1),"");
 assert.equal(authoredIDFor(ID_PREFIX+"60_"+base,60),"");
 assert.deepEqual(parseAuthoredID(ID_PREFIX+"60_"+base),{ammoDepth:60,baseLoadoutID:base});
 assert.equal(parseAuthoredID(base),null);
 assert.equal(parseAuthoredID(ID_PREFIX+"1_"+base),null,"a single charge is not an authored depth");
 assert.equal(parseAuthoredID(ID_PREFIX+"60_"),null);
});

test("resolveRow only answers for an authored ID that really validates",()=>{
 const {api}=fixture();
 const row=api.resolveRow(ID_PREFIX+"60_parity_angel_autocannon_frigate_loadout");
 assert.equal(row.loadoutID,ID_PREFIX+"60_parity_angel_autocannon_frigate_loadout");
 assert.equal(row.charges[0].quantityPerModule,60);
 assert.equal(row.coopAuthored,true);
 assert.equal(api.resolveRow("parity_angel_autocannon_frigate_loadout"),null,
  "a real static row is never served from here");
 assert.equal(api.resolveRow(ID_PREFIX+"60_missing_row"),null);
});

test("the overlay installs the row module and hooks the one static resolver",async()=>{
 const fs=await import("node:fs");
 const path=await import("node:path");
 const root=path.join(import.meta.dirname,"..");
 const spec=fs.readFileSync(path.join(root,"scripts","overlay-spec.cjs"),"utf8");
 assert.match(spec,/"coopWarPatrolLoadoutRow"/,"the module must be in names or it is never deployed");
 const hook=spec.match(/server\/src\/space\/npc\/npcData\.js/);
 assert.ok(hook,"the static loadout resolver must be hooked");
 assert.match(spec,/function findRawByID\(tableName, value\) \{/);
 assert.match(spec,/EVEJS_COOP_WAR_PATROL_LOADOUT_ROW === "1"/,
  "the hook must be opt-in and default OFF");
 assert.match(spec,/require\("\.\.\/coopWarPatrolLoadoutRow"\)\.resolveRow/);
});
