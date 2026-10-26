import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,FILE}=require("../scripts/coop-npc-probe-loadout-split-patch.cjs");

const pinned=process.env.EVEJS_PINNED_NPC_SERVICE_SOURCE;
function original(){
 if(pinned&&fs.existsSync(pinned))return fs.readFileSync(pinned,"utf8");
 // A matching minimal segment for pure source idempotency without local
 // native checkout. Real pinned source is REQUIRED in the Actions gate.
 return `
function buildNativeCargoRecords(entityRecord, moduleRecords, definition, options = {}) {
  const transient = options.transient === true;
  const cargoRecords = [];
  for (const chargeEntry of definition.loadout.charges) {
    const chargeType = resolveItemByTypeID(chargeEntry.typeID);
    const quantityPerModule = Math.max(
      1,
      toPositiveInt(chargeEntry && chargeEntry.quantityPerModule, 1),
    );
    for (const moduleRecord of moduleRecords) {
      if (!isNpcChargeCompatibleWithModule(moduleRecord, chargeType.typeID)) {
        continue;
      }
      const cargoIDResult = nativeNpcStore.allocateCargoID({ transient });
      if (!cargoIDResult.success || !cargoIDResult.data) return cargoIDResult;
      const singleton = resolveNativeCargoSingleton(chargeType,chargeEntry.singleton === true);
      const cargoRecord = {cargoID:cargoIDResult.data,ownerID:entityRecord.ownerID,
        entityID:entityRecord.entityID,moduleID:moduleRecord.moduleID,typeID:chargeType.typeID,
        quantity: quantityPerModule,
        singleton};
      const upsertResult = nativeNpcStore.upsertNativeCargo(cargoRecord,{transient});
      if (!upsertResult.success) return upsertResult;
      cargoRecords.push(cargoRecord);
    }
  }

  const authoredCargo = Array.isArray(
`;
}
function evaluator(code, env={},opts={}){
 const from=code.indexOf("function buildNativeCargoRecords(");
 const to=code.indexOf("  const authoredCargo = Array.isArray(",from);
 if(from<0||to<from)throw Error("Pinned NPC cargo source not found");
 const segment=code.slice(from,to)+
  "  return {success:true,data:cargoRecords};\n}\n";
 let next=980200000000,records=[];
 const store={allocateCargoID:()=>({success:true,data:++next}),
  upsertNativeCargo:(row)=>{records.push({...row});return {success:true}}};
 const toPositiveInt=(x,d=0)=>Number.isSafeInteger(x)&&x>0?x:d;
 const type=t=>({typeID:t,groupID:opts.chargeGroup??479,
    categoryID:8,name:"Scanner Probe"});
 const fn=new Function("nativeNpcStore","resolveItemByTypeID","toPositiveInt",
  "isNpcChargeCompatibleWithModule","resolveNativeCargoSingleton","normalizeModuleState",
  "process",segment+"return buildNativeCargoRecords;")(
  store,type,toPositiveInt,()=>true,()=>false,()=>({}),process);
 const oldLaunch=process.env.EVEJS_COOP_NPC_PROBE_LAUNCH,
  oldSplit=process.env.EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT;
 try{
  if(env.launch===true)process.env.EVEJS_COOP_NPC_PROBE_LAUNCH="1";
  else delete process.env.EVEJS_COOP_NPC_PROBE_LAUNCH;
  if(env.split===true)process.env.EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT="1";
  else delete process.env.EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT;
  const result=fn({entityID:980000000011,ownerID:901},
   [{moduleID:980100000011,groupID:opts.launcherGroup??481,categoryID:7}],
   {loadout:{charges:[{typeID:3001,quantityPerModule:opts.quantity??4,singleton:false}]}},
   {transient:opts.transient===true});
  return {result,records};
 }finally{
  if(oldLaunch===undefined)delete process.env.EVEJS_COOP_NPC_PROBE_LAUNCH;
  else process.env.EVEJS_COOP_NPC_PROBE_LAUNCH=oldLaunch;
  if(oldSplit===undefined)delete process.env.EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT;
  else process.env.EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT=oldSplit;
 }
}
test("EX-03B3 native source patch is pinned-safe, idempotent and exactly reversible",()=>{
 const raw=original(),modified=patch(raw,FILE,false);
 assert.notEqual(raw,modified);
 assert.equal(patch(modified,FILE,false),modified);
 assert.equal(patch(modified,FILE,true),raw);
 assert.equal(patch(raw,FILE,true),raw);
});
test("EX-03B3 authoring-time charge allocation preserves 4 original unit identities",()=>{
 const r=evaluator(patch(original(),FILE),{launch:true,split:true});
 assert.equal(r.records.length,4);
 assert.deepEqual(r.records.map(x=>x.quantity),[1,1,1,1]);
 assert.equal(new Set(r.records.map(x=>x.cargoID)).size,4);
 assert.ok(r.records.every(x=>x.moduleID===980100000011));
});
test("default OFF preserves original stacked charge behavior",()=>{
 const r=evaluator(patch(original(),FILE),{launch:false,split:false});
 assert.equal(r.records.length,1);assert.equal(r.records[0].quantity,4);
});
test("only one opt-in flag cannot silently split NPC inventory",()=>{
 for(const env of [{launch:true,split:false},{launch:false,split:true}]){
  const r=evaluator(patch(original(),FILE),env);
  assert.equal(r.records.length,1);assert.equal(r.records[0].quantity,4);
 }
});
test("non-scanner groups and transient ships do not materialize new cargo IDs",()=>{
 for(const opts of [{launcherGroup:20},{chargeGroup:20},{transient:true}]){
  const r=evaluator(patch(original(),FILE),{launch:true,split:true},opts);
  assert.equal(r.records.length,1);assert.equal(r.records[0].quantity,4);
 }
});
test("oversized authored charge stack requires a separate native split mechanism",()=>{
 const r=evaluator(patch(original(),FILE),{launch:true,split:true},{quantity:20});
 assert.equal(r.records.length,1);assert.equal(r.records[0].quantity,20);
});
