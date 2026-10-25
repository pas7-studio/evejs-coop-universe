import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {fileURLToPath} from "node:url";
const source=readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
 "../integration/coopNativeConsequences.cjs"),"utf8");
const SYS=30000144,CHAR=70001,SHIP=90001,NPC=70123,WRECK=80123;
function fixture(){
 const dir=mkdtempSync(path.join(os.tmpdir(),"coop-crime-13-"));
 const linkFile=path.join(dir,"links.json"),ledgerFile=path.join(dir,"ledger.json");
 writeFileSync(linkFile,JSON.stringify({links:{"coop-pilot-001":{
  pilotID:"coop-pilot-001",entityID:NPC,systemID:SYS,role:"pirate"}}}));
 const session={characterID:CHAR,userid:60001,
  _space:{systemID:SYS,shipID:SHIP,initialStateSent:true},socket:{destroyed:false}};
 const ship={itemID:SHIP,kind:"ship",pilotCharacterID:CHAR,session};
 const npc={itemID:NPC,kind:"ship",nativeNpc:true,factionID:50001};
 const wreckEntity={itemID:WRECK,nativeNpcWreck:true,launcherID:NPC};
 const scene={systemID:SYS,sessions:new Map([[1,session]]),
  entities:new Map([[SHIP,ship],[WRECK,wreckEntity]]),
  getEntityByID(id){return this.entities.get(id)}};
 const wreck={wreckID:WRECK,systemID:SYS,sourceEntityID:NPC,launcherID:NPC};
 let grants=0;
 const mocks={
  "node:fs":fs,"node:path":path,
  "./coopSessionPresence":{
   nativeAuthority:()=>({}),
   admission:(s,p)=>({status:s===session&&p===ship&&
    [...scene.sessions.values()].filter(other=>other.characterID===s.characterID).length===1?
    "ADMITTED_NATIVE_SESSION":"UNAUTHORIZED"})
  },
  "./runtime":{ensureScene:()=>scene},
  "./npc/nativeNpcStore":{getNativeWreck:()=>wreck},
  "../services/character/standingRuntime":{
   EVENT_STANDING_COMBAT_AGGRESSION:42,
   applyStandingChanges:()=>{grants++;return {success:true}}
  },
  "./coopNpcMemory":{noteVerified:()=>{}},
  "./coopRuntimeProbe":{observe:()=>true},
  "../services/chat/chatHub":{sendSystemMessage:()=>{}},
  "../services/mining/miningNpcStandings":{resolveEntityOwnerIDs:()=>[50001]}
 };
 function load(){
  const module={exports:{}};
  const env={EVEJS_COOP_PLAYER_CONSEQUENCES:"1",
   EVEJS_COOP_IDENTITY_FILE:linkFile,EVEJS_COOP_STANDINGS_FILE:ledgerFile};
  new Function("require","module","process",source)(
   name=>{if(!(name in mocks))throw Error("unmocked "+name);return mocks[name];},
   module,{env});
  return module.exports;
 }
 const kill=(api,options={},victim=npc)=>api.noteNativeWreck(
  SYS,NPC,WRECK,victim,options,{currentTargetID:SHIP});
 return {load,scene,session,ship,npc,wreck,wreckEntity,ledgerFile,
  kill,grants:()=>grants,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test("one physical player kill gets exactly one native standing effect across restart",()=>{
 const x=fixture();try{
  let api=x.load(),options={attackerEntity:x.ship,killerCharacterID:CHAR};
  assert.equal(x.kill(api,options).status,"APPLIED");
  assert.equal(x.kill(api,options).status,"DUPLICATE");
  api=x.load();
  assert.equal(x.kill(api,options).status,"DUPLICATE");
  assert.equal(x.grants(),1);
 }finally{x.close()}
});
test("killer hint without explicit attacker and mismatched hint cannot grant credit",()=>{
 const x=fixture();try{
  const api=x.load();
  assert.equal(x.kill(api,{killerCharacterID:CHAR}).status,"IGNORED_UNATTRIBUTED");
  assert.equal(x.kill(api,{attackerEntity:x.ship,killerCharacterID:CHAR+1}).status,
   "IGNORED_ATTACKER_IDENTITY_MISMATCH");
  assert.equal(x.grants(),0);
 }finally{x.close()}
});
test("stale, duplicate, other-system, and replaced physical pilot are denied",()=>{
 const x=fixture();try{
  const api=x.load();
  assert.equal(api.resolveVerifiedPlayerID(x.scene,x.ship),CHAR);
  x.session.socket.destroyed=true;
  assert.equal(api.resolveVerifiedPlayerID(x.scene,x.ship),null);
  x.session.socket.destroyed=false;
  x.session._space.systemID=SYS+1;
  assert.equal(api.resolveVerifiedPlayerID(x.scene,x.ship),null);
  x.session._space.systemID=SYS;
  x.scene.sessions.set(2,{...x.session});
  assert.equal(api.resolveVerifiedPlayerID(x.scene,x.ship),null);
  x.scene.sessions.delete(2);
  x.scene.entities.set(SHIP,{...x.ship});
  assert.equal(api.resolveVerifiedPlayerID(x.scene,x.ship),null);
 }finally{x.close()}
});
test("owned drone requires physical identity, owner and native launch ship",()=>{
 const x=fixture();try{
  const api=x.load(),drone={itemID:91001,kind:"drone",ownerID:CHAR,controllerID:SHIP};
  x.scene.entities.set(drone.itemID,drone);
  assert.equal(api.resolveVerifiedPlayerID(x.scene,drone),CHAR);
  assert.equal(api.resolveVerifiedPlayerID(x.scene,{...drone}),null);
  drone.ownerID=CHAR+1;
  assert.equal(api.resolveVerifiedPlayerID(x.scene,drone),null);
  drone.ownerID=CHAR;drone.controllerID=SHIP+1;
  assert.equal(api.resolveVerifiedPlayerID(x.scene,drone),null);
 }finally{x.close()}
});
test("fake physical wreck, non-native victim and disconnect reject standing",()=>{
 const x=fixture();try{
  const api=x.load(),opts={attackerEntity:x.ship};
  x.wreckEntity.nativeNpcWreck=false;
  assert.equal(x.kill(api,opts).status,"IGNORED_UNVERIFIED_NATIVE_WRECK");
  x.wreckEntity.nativeNpcWreck=true;
  assert.equal(x.kill(api,opts,{...x.npc,nativeNpc:false}).status,
   "IGNORED_UNVERIFIED_NATIVE_WRECK");
  x.session.socket.destroyed=true;
  assert.equal(x.kill(api,opts).status,"IGNORED_UNATTRIBUTED");
  assert.equal(x.grants(),0);
 }finally{x.close()}
});
test("old controller target is not evidence to pay miner defense reward",()=>{
 const x=fixture();try{
  const api=x.load();
  assert.equal(x.kill(api,{attackerEntity:x.ship}).status,"APPLIED");
  assert.equal(x.grants(),1);
  assert.equal(JSON.parse(readFileSync(x.ledgerFile,"utf8")).totals.defense,0);
 }finally{x.close()}
});
