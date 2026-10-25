import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAlifeNativeAct}=require("../integration/coopAlifeNativeEconomyAct.cjs");
const actor={nativeVerified:true,isNpc:true,ownerID:1000010,pilotID:"coop-pilot-123",
 entityID:99,stationID:60000101,systemID:30000142,role:"trader",
 playerControlled:false,underAttack:false,inWarp:false,activeNativeOrder:false};
const intent={pilotID:actor.pilotID,entityID:actor.entityID,
 systemID:actor.systemID,stationID:actor.stationID,stage:"MANUFACTURE",
 intentID:"30000142:1000:99:MANUFACTURE",provenance:"NATIVE_READ_ONLY",nativeMutation:false};
function fixture({flags=true}={}){
 let ticks=0,actorValue={...actor};
 const env=flags?{EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",EVEJS_COOP_NATIVE_NPC_ECONOMY:"1"}:{};
 let director={mode:"NATIVE_AUTHORITIES_ONLY",tick:()=>{ticks++;return {status:"PREPARED",operationID:"op-1"}}};
 const options={env,resolveActor:async()=>actorValue,
  resolveProductTypes:async()=>[215],resolveDirector:async()=>director};
 return {bridge:createAlifeNativeAct(options),options,
  get ticks(){return ticks},setActor:x=>actorValue=x,setDirector:x=>director=x};
}
test("native A-Life ACT remains disabled without both explicit flags",async()=>{
 const f=fixture({flags:false});
 assert.equal((await f.bridge.dispatch(intent)).status,"DISABLED");
 assert.equal(f.ticks,0);
});
test("only evidence-backed native intents can call the existing director",async()=>{
 const f=fixture();
 assert.equal((await f.bridge.dispatch({...intent,provenance:"VIRTUAL"})).status,"BLOCKED");
 assert.equal((await f.bridge.dispatch({...intent,stage:"BUY_SUPPLIES"})).status,"BLOCKED");
 assert.equal((await f.bridge.dispatch({...intent,nativeMutation:true})).status,"BLOCKED");
 assert.equal(f.ticks,0);
});
test("actor spoofing, owner change and physical danger deny a paid action",async()=>{
 const f=fixture();f.setActor({...actor,playerControlled:true});
 assert.equal((await f.bridge.dispatch(intent)).reason,"ALIFE_NATIVE_ACT_ACTOR_CHANGED");
 f.setActor({...actor,ownerID:0});
 assert.equal((await f.bridge.dispatch(intent)).reason,"ALIFE_NATIVE_ACT_ACTOR_CHANGED");
 f.setActor({...actor,underAttack:true});
 assert.equal((await f.bridge.dispatch(intent)).reason,"ALIFE_NATIVE_ACT_ACTOR_CHANGED");
 assert.equal(f.ticks,0);
});
test("valid A-Life decision calls only the native durable director",async()=>{
 const f=fixture();const r=await f.bridge.dispatch(intent);
 assert.equal(r.status,"NATIVE_DIRECTOR_RESULT");
 assert.equal(r.directorStatus,"PREPARED");
 assert.equal(r.nativeMutation,false);
 assert.equal(r.source,"EXISTING_NATIVE_DIRECTOR");
 assert.equal(f.ticks,1);
});
test("replayed identical intent cannot advance native state twice",async()=>{
 const f=fixture();
 assert.equal((await f.bridge.dispatch(intent)).status,"NATIVE_DIRECTOR_RESULT");
 assert.equal((await f.bridge.dispatch(intent)).reason,"ALIFE_NATIVE_ACT_INTENT_ALREADY_ROUTED");
 assert.equal(f.ticks,1);
});
test("missing canonical product allowlist fails closed before native writer",async()=>{
 const f=fixture();f.options.resolveProductTypes=async()=>[];
 // Create a fresh bridge to use the changed injected callback.
 const bridge=createAlifeNativeAct(f.options);
 assert.equal((await bridge.dispatch(intent)).reason,"ALIFE_NATIVE_ACT_PRODUCT_PROOF_MISSING");
 assert.equal(f.ticks,0);
});
test("native actor revalidated after asynchronous product discovery",async()=>{
 const f=fixture();let calls=0;
 f.options.resolveActor=async()=>++calls===1?actor:{...actor,inWarp:true};
 const bridge=createAlifeNativeAct(f.options);
 assert.equal((await bridge.dispatch(intent)).reason,"ALIFE_NATIVE_ACT_ACTOR_CHANGED");
 assert.equal(f.ticks,0);
});
test("concurrent intent at same corporate station cannot start another director tick",async()=>{
 let release;const f=fixture();
 f.setDirector({mode:"NATIVE_AUTHORITIES_ONLY",
  tick:()=>{return new Promise(resolve=>{release=()=>resolve({status:"PREPARED"})})}});
 const a=f.bridge.dispatch(intent);
 // Let async actor/product/director discovery settle into running tick.
 for(let i=0;i<5&&!release;i++)await Promise.resolve();
 assert.equal(typeof release,"function");
 const b=await f.bridge.dispatch({...intent,intentID:"another-verified-99"});
 assert.equal(b.reason,"ALIFE_NATIVE_ACT_STATION_IN_FLIGHT");
 release();assert.equal((await a).status,"NATIVE_DIRECTOR_RESULT");
});
test("unknown native director implementation is not a valid ACT authority",async()=>{
 const f=fixture();f.setDirector({mode:"VIRTUAL_ONLY",tick:()=>{throw Error("SHOULD_NOT_EXECUTE")}});
 assert.equal((await f.bridge.dispatch(intent)).reason,"ALIFE_NATIVE_ACT_DIRECTOR_NOT_NATIVE");
});
