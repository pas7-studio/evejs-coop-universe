import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const modulePath=new URL("../integration/coopEscortNativeMount.cjs",import.meta.url);
const code=fs.readFileSync(modulePath,"utf8");
const manifestKey="30000144-77-123";
const systemID=30000144,haulerID=901,playerFleetID=44;
const manifestRecord=()=>({key:manifestKey,systemID,fleetID:77,
 stationID:60000001,corporationID:1000152,
 haulerIDs:[haulerID],cargo:[{cargoID:123}]});
const offer=()=>({status:"AUTHORIZED_NATIVE_ESCORT_BOOKING",
 contractID:"escort-30000144-77-123",manifestKey,systemID,
 fleetID:77,stationID:60000001,corporationID:1000152,haulerID,
 playerFleetID,amountISK:600000,characters:[701,702]});
function createHarness({manifest=manifestRecord(),authorization=offer(),
 consenting=true,duplicate=false,npcValid=true,sceneValid=true}={}){
 const leader={characterID:701,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID,shipID:9001}};
 const peer={characterID:702,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID,shipID:9002}};
 const scene={systemID,getEntityByID:id=>id===haulerID&&npcValid?
  {nativeNpc:true,kind:"ship",itemID:haulerID,transient:false}:null};
 let runtimeParams,readAuthorizedCalls=0;
 const load=x=>{
  if(x==="./coopEscortRuntime")return {createEscortRuntime:params=>{
   runtimeParams=params;return {status:"RUNTIME_INSTALLED"}}};
  if(x==="./coopNativeHaulManifest")return {createManifest:()=>({
   read:()=>({status:"READY",record:manifest}),verify:()=>({status:"READY"})})};
  if(x==="./coopConvoyOperations")return {createOperations:()=>({snapshot:()=>({status:"READY",incidents:[]})})};
  if(x==="./coopConvoyOutcomeProof")return {createOutcomes:()=>({snapshot:()=>({status:"READY",outcomes:[]})})};
  if(x==="./coopNativeFleetParty")return {inSpaceParty:()=>({ok:true,
   fleetID:playerFleetID,systemID,leaderShipID:9001,peerShipID:9002})};
  if(x==="node:path")return path;
  throw new Error("UNEXPECTED_IMPORT "+x);
 };
 const box={exports:{}};
 vm.runInNewContext(code,{require:load,module:box,process}, {filename:"coopEscortNativeMount.cjs"});
 const inst=box.exports.createNativeMount({
  root:"/tmp/test-escrow",
  gameStore:{coopAtomicNativeRows:{mode:"SERVER_INTERNAL_FLAGGED",
   isPoisoned:()=>false,transact:()=>{}}},
  corporations:{isNpcCorporationID:()=>true},
  npcStore:{getNativeEntity:()=>({}),listNativeCargoForEntity:()=>[]},
  items:{findWarehouseItem:()=>null},
  sessions:{getSessions:()=>duplicate?[leader,leader,peer]:[leader,peer]},
  spaceRuntime:{getSceneForSession:()=>sceneValid?scene:null},
  fleetRuntime:{getFleetForCharacter:()=>({}),getMemberRecord:()=>({})},
  readAuthorizedOffer:()=>{
   readAuthorizedCalls++;return authorization},
  readPilotConsent:()=>consenting?{status:"DURABLE_TWO_PILOT_CONSENT",
   manifestKey,contractID:offer().contractID,haulerID,systemID,
   fleetID:playerFleetID,characters:[701,702]}:{status:"NO_CONSENT"},
  readNativeFailure:()=>({status:"UNAVAILABLE"}),
  verifyNativeParty:()=>({ok:true,fleetID:playerFleetID,systemID,
   leaderShipID:9001,peerShipID:9002}),
  clock:()=>200000
 });
 assert.equal(inst.runtime.status,"RUNTIME_INSTALLED");
 const verify=(args={})=>runtimeParams.verifyNativeDuo({
  systemID,stationID:60000001,corporationID:1000152,
  manifestKey,contractID:offer().contractID,haulerID,
  fleetID:playerFleetID,characters:[701,702],...args
 });
 return {verify,readAuthorizedCalls:()=>readAuthorizedCalls};
}
test("post-restart empty ephemeral offer cache must recover ONLY from native durable manifest+quote",()=>{
 const x=createHarness();
 assert.equal(x.verify().status,"VERIFIED_NATIVE_DUO_FLEET");
 assert.equal(x.readAuthorizedCalls(),1);
});
test("missing or altered real manifest prevents recovering any fleet",()=>{
 const m=manifestRecord();m.corporationID=999;
 const x=createHarness({manifest:m});
 assert.equal(x.verify().status,"NATIVE_DUO_DURABLE_ACCEPTANCE_MISMATCH");
});
test("changed persisted quote amount/contract identity blocks native recovery",()=>{
 const a=offer();a.contractID="escort-30000144-77-999";
 const x=createHarness({authorization:a});
 assert.equal(x.verify().status,"NATIVE_DUO_OFFER_UNAVAILABLE");
});
test("forged other player recipients never receive payment authority",()=>{
 const x=createHarness();
 assert.equal(x.verify({characters:[701,999]}).status,"NATIVE_DUO_OFFER_UNAVAILABLE");
});
test("no durable two-player consent is still a hard gate after restart",()=>{
 const x=createHarness({consenting:false});
 assert.equal(x.verify().status,"NATIVE_DUO_CONSENT_NOT_VERIFIED");
});
test("duplicate active sessions for one recipient block recovered paid fleet",()=>{
 const x=createHarness({duplicate:true});
 assert.equal(x.verify().status,"NATIVE_DUO_ACTIVE_SESSIONS_UNVERIFIED");
});
test("native physical ship must exist during recovery",()=>{
 const x=createHarness({npcValid:false});
 assert.equal(x.verify().status,"NATIVE_DUO_TARGET_HAULER_MISSING");
});
test("source scene absence blocks recovered participant proof",()=>{
 const x=createHarness({sceneValid:false});
 assert.equal(x.verify().status,"NATIVE_DUO_TARGET_HAULER_MISSING");
});
test("different system/player fleet identities are never accepted",()=>{
 const x=createHarness();
 assert.equal(x.verify({fleetID:100}).status,"NATIVE_DUO_OFFER_UNAVAILABLE");
});
