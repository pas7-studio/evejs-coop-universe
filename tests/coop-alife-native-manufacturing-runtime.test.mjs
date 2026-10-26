import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
const require=createRequire(import.meta.url);
const {createRuntimeAlifeManufacturing}=require("../integration/coopAlifeNativeManufacturingRuntime.cjs");
const OWNER=1000010,STATION=60000101,SYSTEM=30000142,ENTITY=199;
const PILOT="coop-pilot-199";
const FLAGS={EVEJS_COOP_ALIFE:"1",EVEJS_COOP_ALIFE_ECONOMY:"1",
 EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY:"1",EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",
 EVEJS_COOP_NATIVE_NPC_ECONOMY:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"};
function fixture({env=FLAGS,live=true,now=100010}={}){
 const actor={entityID:ENTITY,systemID:SYSTEM,ownerID:OWNER};
 const ship={itemID:ENTITY,kind:"ship",nativeNpc:true,position:{x:0,y:0,z:0},
  radius:10,mode:"IDLE"};
 const control={entityID:ENTITY,systemID:SYSTEM,currentTargetID:0,manualOrder:{type:"idle"}};
 const station={stationID:STATION,solarSystemID:SYSTEM};
 const scene={systemID:SYSTEM,getEntityByID:id=>id===ENTITY?ship:null,
  sessions:new Map(),staticEntities:[{kind:"station",itemID:STATION,
   position:{x:100,y:0,z:0},radius:100}]};
 const pilot={pilotID:PILOT,entityID:ENTITY,systemID:SYSTEM,ownerID:OWNER,
  stationID:STATION,role:"trader",nativeVerified:true,atStation:true,
  playerControlled:false,inWarp:false,underAttack:false,activeNativeOrder:false,
  economy:{authoritativeNative:true,ownerID:OWNER,stationID:STATION,systemID:SYSTEM,
   productTypeID:215,products:[{typeID:215},{typeID:216}]}};
 const snapshot={authoritativeNative:true,systemID:SYSTEM,observedAt:100000,
  pilots:[pilot]};
 const makeIntent=(id=ENTITY,stage="MANUFACTURE")=>({pilotID:PILOT,entityID:id,
  systemID:SYSTEM,stationID:STATION,provenance:"NATIVE_READ_ONLY",
  nativeMutation:false,stage,intentID:SYSTEM+":100000:"+id+":"+stage});
 const decision={status:"OBSERVED",systemID:SYSTEM,observedAt:100000,
  intents:[makeIntent()]};
 const registry={snapshot:()=>({links:{[PILOT]:{pilotID:PILOT,
  entityID:ENTITY,systemID:SYSTEM}}})};
 const calls=[],director={mode:"NATIVE_AUTHORITIES_ONLY",
  supportsLiveRuntime:live,auditBeforeTick:async scope=>({
   status:"READY",ownerID:scope.ownerID,stationID:scope.stationID,
   readOnly:true,nativeMutation:false,
   proof:"ORIGINAL_DIRECTOR_JOURNAL_AND_NATIVE_RECEIPTS_READ_ONLY"
  }),tick:async ctx=>{calls.push(ctx);return {status:"PREPARED",
   operationID:"npc-manufacture:0123456789abcdef0123456789abcdef"}}};
 const onResult=[];
 const runtime=createRuntimeAlifeManufacturing({env,clock:()=>now,
  getNativeEntity:id=>id===ENTITY?actor:null,
  getController:id=>id===ENTITY?control:null,
  sceneForSystem:id=>id===SYSTEM?scene:null,
  getStation:id=>id===STATION?station:null,
  resolveDirector:()=>director,onResult:r=>onResult.push(r)});
 return {runtime,ship,control,station,scene,actor,pilot,snapshot,
  decision,registry,calls,director,onResult,makeIntent};
}
test("ACT admission is disabled unless every explicit native authority flag is present",async()=>{
 for(const flag of Object.keys(FLAGS)){
  const f=fixture({env:{...FLAGS,[flag]:"0"}});
  assert.equal((await f.runtime.tick(f)).status,"DISABLED");
  assert.equal(f.calls.length,0);
 }
});
test("no verified live bindings means zero native transactions even with ACT flags",async()=>{
 const f=fixture();
 const runtime=createRuntimeAlifeManufacturing({env:FLAGS,
  clock:()=>100010,getNativeEntity:()=>f.actor,
  getController:()=>f.control,sceneForSystem:()=>f.scene,
  getStation:()=>f.station});
 const result=await runtime.tick(f);
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.reason,"LIVE_NATIVE_MANUFACTURING_BINDINGS_NOT_AVAILABLE");
 assert.equal(f.calls.length,0);
});
test("reject independent scheduler and market writer before native ACT",async()=>{
 for(const flag of ["EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER",
  "EVEJS_COOP_NATIVE_NPC_MARKET"]){
  const f=fixture({env:{...FLAGS,[flag]:"1"}});
  assert.equal((await f.runtime.tick(f)).reason,
   "PARALLEL_NATIVE_ECONOMY_WRITER_ENABLED");
  assert.equal(f.calls.length,0);
 }
});
test("exact station and source-grounded native actor can call a live native director",async()=>{
 const f=fixture();const result=await f.runtime.tick(f);
 assert.equal(result.status,"ADMISSION_EVALUATED");
 assert.equal(result.results.length,1);
 assert.equal(result.results[0].directorStatus,"PREPARED");
 assert.deepEqual(f.calls,[{ownerID:OWNER,stationID:STATION,productTypeIDs:[215,216]}]);
 assert.equal(f.onResult.length,1);
});
test("shipped manual-only native director is fenced before any original wallet debit",async()=>{
 const f=fixture({live:false});
 const result=await f.runtime.tick(f);
 assert.equal(result.results[0].status,"BLOCKED");
 assert.equal(result.results[0].reason,"ALIFE_NATIVE_ACT_DIRECTOR_NOT_NATIVE");
 assert.equal(f.calls.length,0);
});
test("native hull movement or active combat prevents manufacturing",async()=>{
 for(const mutate of [f=>{f.ship.position.x=50000},
  f=>{f.ship.pendingWarp=true},
  f=>{f.control.currentTargetID=888},
  f=>{f.actor.ownerID=OWNER+1},
  f=>{f.ship.nativeNpc=false},
  f=>{f.pilot.playerControlled=true},
  f=>{f.scene.sessions.set(1,{_space:{shipID:ENTITY}})}]){
  const f=fixture();mutate(f);
  const result=await f.runtime.tick(f);
  assert.equal(result.results[0].status,"BLOCKED");
  assert.equal(f.calls.length,0);
 }
});
test("native source snapshot must match the A-Life decision ID, time and actor",async()=>{
 for(const mutate of [
  f=>{f.decision.observedAt++},
  f=>{f.decision.systemID++},
  f=>{f.decision.intents[0].intentID="spoofed"},
  f=>{f.decision.intents[0].provenance="VIRTUAL"}]){
  const f=fixture();mutate(f);
  const result=await f.runtime.tick(f);
  assert.equal(f.calls.length,0);
  assert.ok(["BLOCKED","NO_NATIVE_MANUFACTURING_INTENTS"].includes(result.status));
 }
});
test("native source observation older than 30 seconds cannot run factory",async()=>{
 const f=fixture({now:131000});const result=await f.runtime.tick(f);
 assert.equal(result.reason,"ALIFE_MANUFACTURING_SOURCE_STALE");
 assert.equal(f.calls.length,0);
});
test("two intentions for one corporate station only dispatch one native director tick",async()=>{
 const f=fixture();
 f.decision.intents.push(f.makeIntent(ENTITY,"LIST_OUTPUT"));
 const result=await f.runtime.tick(f);
 assert.equal(result.count,1);
 assert.equal(f.calls.length,1);
});
test("the same original intention cannot re-execute the native factory twice",async()=>{
 const f=fixture();
 assert.equal((await f.runtime.tick(f)).count,1);
 const second=await f.runtime.tick(f);
 assert.equal(second.results[0].reason,"ALIFE_NATIVE_ACT_INTENT_ALREADY_ROUTED");
 assert.equal(f.calls.length,1);
});
test("source-only adapter has no clock, wallet, original market or inventory mutation",()=>{
 const source=fs.readFileSync(new URL(
  "../integration/coopAlifeNativeManufacturingRuntime.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(source,/marketDaemonClient|grantItem|\.transact\(|createDirector\(/);
 // This PR installs ONLY the source admission module. The A-Life 30s
 // runtime wiring is a separate reviewed integration step; do not pretend
 // a module export implies a verified live financial director.
 assert.match(source,/LIVE_NATIVE_MANUFACTURING_BINDINGS_NOT_AVAILABLE/);
 assert.match(source,/supportsLiveRuntime===true/);
 assert.match(source,/supportsNativeMutation:typeof resolveDirector/);
});


test("A-Life exact world tick isolates manufacturing exception before NPC resupply and buyer",async()=>{
 const src=fs.readFileSync(new URL("../integration/coopVirtualWorldRuntime.cjs",import.meta.url),"utf8");
 const i=src.indexOf("async function observeAlifeEconomy(){");
 const j=src.indexOf("\nfunction lockedTargets(",i);
 assert.ok(i>=0&&j>i);
 const seen=[],events=[];
 const modules={
  "./runtime":{ensureScene:()=>({})},
  "./npc/nativeNpcStore":{getNativeEntity:()=>null,listNativeCargoForEntity:()=>[]},
  "./npc/npcRegistry":{getControllerByEntityID:()=>null},
  "./worldData":{getStationByID:()=>null},
  "./coopRuntimeProbe":{observe:(kind,_a,_b,info)=>events.push({kind,info})},
  "./coopAlifeEconomySensor":{readEconomySnapshot:()=>({authoritativeNative:false,systemID:42,pilots:[]})},
  "./coopAlifeNativeResupplyBridge":{nativeResupplyActEnabled:()=>true}
 };
 const ctx={
  world:{snapshot:()=>({pilots:[]})},identityRegistry:{snapshot:()=>({links:{}})},
  visitedSystems:new Set([42]),backgroundTicks:1,alifeEconomyAuthorityBusy:false,
  alifeEconomyObserver:{tick:()=>({status:"OBSERVED"})},
  alifeManufacturingRuntime:{tick:async()=>{seen.push("manufacture");throw Error("NATIVE_FAIL")}},
  alifeBuyerRuntime:{tick:async()=>{seen.push("buyer");return{status:"NO_BUY",purchases:[]}}},
  alifeStationAuthority:null,nativeMarketTickRunning:false,nativeAmmoSupply:null,
  process:{env:{EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY:"0",
   EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",EVEJS_COOP_ALIFE_NATIVE_BUYER:"1",
   EVEJS_COOP_NATIVE_NPC_MARKET:"0"}},
  safeNpcPhase:(_name,fn)=>{seen.push("resupply");fn()},
  advanceNativeAmmoSupply:()=>seen.push("resupply-done"),
  require:id=>{if(!Object.hasOwn(modules,id))throw Error("UNEXPECTED_IMPORT:"+id);return modules[id]}
 };
 const step=new Function("ctx","with(ctx){"+src.slice(i,j)+";return observeAlifeEconomy;}")(ctx);
 await step();
 assert.deepEqual(seen,["manufacture","resupply","resupply-done","buyer"]);
 assert.equal(ctx.alifeEconomyAuthorityBusy,false);
 assert.deepEqual(events.filter(x=>x.kind==="alife-native-manufacturing-admission")
  .map(x=>x.info),[{status:"BLOCKED",reason:"NATIVE_MANUFACTURING_ADMISSION_EXCEPTION",
   nativeSettlementVerified:false,source:"NATIVE_SOURCE_ADMISSION_NOT_NATIVE_SETTLEMENT"}]);
});
