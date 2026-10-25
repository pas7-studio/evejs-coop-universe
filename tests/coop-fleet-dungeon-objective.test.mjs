import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {observe}=require("../integration/coopFleetDungeonCredit.cjs");
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const prefix=process.env.EVEJS_COOP_CODE_PATH;
function loadNative(){
 if(!prefix)return null;
 const load=file=>{
  const spec=specs.find(s=>s.file===file);
  assert.ok(spec);
  const src=fs.readFileSync(path.join(prefix,file),"utf8");
  const pristine=transform(src,spec,true);
  const patched=transform(pristine,spec,false);
  assert.ok(src===pristine||src===patched,"Pinned checkout has unknown patch");
  assert.equal(transform(patched,spec,false),patched);
  assert.equal(transform(patched,spec,true),pristine);
  new vm.Script(patched);
  return patched;
 };
 return {mission:load("server/src/services/agent/agentMissionRuntime.js"),
  dungeon:load("server/src/services/dungeon/dungeonUniverseSiteService.js")};
}
function makeFixture(native=null){
 const captain={characterID:101,activeShipID:9001,
  socket:{destroyed:false},_space:{systemID:30000144,shipID:9001,initialStateSent:true}};
 const wing={characterID:102,activeShipID:9002,
  socket:{destroyed:false},_space:{systemID:30000144,shipID:9002,initialStateSent:true}};
 const ships=new Map([[9001,{itemID:9001,kind:"ship",position:{x:0,y:0,z:0}}],
 [9002,{itemID:9002,kind:"ship",position:{x:1000,y:0,z:0}}]]);
 const scene={systemID:30000144,sessions:new Map([[101,captain],[102,wing]]),
  getShipEntityForSession:s=>ships.get(s._space.shipID),
  getEntityByID:id=>ships.get(id)};
 const fleet={fleetID:99,members:new Map([[101,{}],[102,{}]])};
 const fleetRuntime={getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(f,id)=>f.members.get(id)||null};
 const spaceRuntime={getSceneForSession:s=>scene.sessions.get(s.characterID)===s?scene:null};
 const instance={instanceID:700,ownership:{missionOwnerCharacterID:101},
  metadata:{missionAgentID:55,missionCharacterID:101,missionRuntime:true},
  objectiveState:{state:"completed",completedAtMs:50000}};
 const base={agentID:55,contentID:440,missionTemplateID:"battle",
  missionSystemID:30000144,objectiveMode:"dungeon",
  runtimeStatus:"accepted",gmCompleted:false,missionPosition:{x:0,y:0,z:0}};
 const records=new Map([[101,{...base,missionSequence:11,dungeonInstanceID:700,objectiveCompleted:true}],
  [102,{...base,missionSequence:12,dungeonInstanceID:701,objectiveCompleted:false}]]);
 const notices=[];
 let share;
 if(native){
  const start=native.mission.indexOf("function shareCoopDungeonObjective(");
  const stop=native.mission.indexOf("function setMissionObjectiveCompleted(",start);
  assert.ok(start>=0&&stop>start);
  const extracted=native.mission.slice(start,stop);
  const getMissionRecord=(id,agent)=>agent===55?structuredClone(records.get(id)||null):null;
  const mutateCharacterState=(id,cb)=>{
   const entry=records.get(id);
   const state={missionsByAgentID:{55:entry}};
   const result=cb(state);
   if(entry)records.set(id,state.missionsByAgentID[55]);
   return {success:true,data:result};
  };
  share=new Function("normalizePositiveInteger","dungeonRuntime",
   "getMissionRecord","mutateCharacterState","notifyMissionTrackerUpdate",
   "notifyMissionChange","OBJECTIVE_TYPE_DUNGEON","AGENT_MISSION_MODIFIED",
   extracted+";return shareCoopDungeonObjective")(
   v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):0,
   {getInstance:id=>id===700?instance:null},
   getMissionRecord,mutateCharacterState,
   (id,agent)=>notices.push(["tracker",id,agent]),
   (id,type,agent)=>notices.push(["journal",id,type,agent]),
   "dungeon","modified");
 }else{
  share=(peer,agent,owner,source)=>{
   const m=records.get(peer);
   if(!m||source!==700||agent!==55||owner!==101)return {success:false};
   m.objectiveCompleted=true;
   return {success:true};
  };
 }
 const missionRuntime={
  getMissionRecord:(id,agent)=>agent===55?structuredClone(records.get(id)||null):null,
  shareCoopDungeonObjective:share,
  isSessionInActiveMissionDungeon:(session,record)=>
   session?.socket?.destroyed!==true&&scene.sessions.get(session.characterID)===session&&
   Math.hypot(ships.get(session.activeShipID).position.x-record.missionPosition.x,
    ships.get(session.activeShipID).position.y-record.missionPosition.y)<100000
 };
 const options={instance,missionRuntime,fleetRuntime,spaceRuntime,
  sessions:[captain,wing]};
 return {options,records,notices,scene,ships,fleet,captain,wing,instance};
}
test("native source: pinned agent and dungeon overlays parse and restore exactly",t=>{
 if(!prefix){t.skip("Requires EVEJS_COOP_CODE_PATH pointing to pinned Code");return;}
 const v=loadNative();assert.match(v.mission,/function shareCoopDungeonObjective/);
 assert.match(v.dungeon,/coopFleetDungeonCredit/);
});
test("two physical fleet ships share an authentic completed dungeon into wingman's OWN journal",t=>{
 if(!prefix){t.skip("Requires pinned EveJS checkout");return;}
 const f=makeFixture(loadNative());
 const result=observe(f.options);
 assert.equal(result.status,"TWO_PLAYER_NATIVE_DUNGEON_OBJECTIVE_CREDITED");
 assert.equal(f.records.get(102).objectiveCompleted,true);
 assert.equal(f.records.get(102).gmCompleted,false);
 assert.equal(f.records.get(102).coopSharedDungeon.sourceInstanceID,700);
 assert.deepEqual(f.notices,[["tracker",102,55],["journal",102,"modified",55]]);
 assert.equal(observe(f.options).status,"PEER_ALREADY_NATIVE_COMPLETED");
 assert.equal(f.notices.length,2);
});
test("absent native member, fake hull and player outside mission deny sharing",()=>{
 for(const kind of ["notInFleet","fakeShip","outside","disconnected","unaccepted"]){
  const f=makeFixture();
  if(kind==="notInFleet")f.fleet.members.delete(102);
  if(kind==="fakeShip")f.ships.get(9002).kind="asteroid";
  if(kind==="outside")f.ships.get(9002).position.x=300000;
  if(kind==="disconnected")f.wing.socket.destroyed=true;
  if(kind==="unaccepted")f.records.get(102).runtimeStatus="offered";
  assert.notEqual(observe(f.options).status,"TWO_PLAYER_NATIVE_DUNGEON_OBJECTIVE_CREDITED",kind);
  assert.equal(f.records.get(102).objectiveCompleted,false);
 }
});
test("wrong instance, wrong mission, wrong system and duplicate login never count",()=>{
 for(const kind of ["wrongInstance","wrongMission","wrongSystem","duplicateLogin"]){
  const f=makeFixture();
  if(kind==="wrongInstance")f.records.get(101).dungeonInstanceID=801;
  if(kind==="wrongMission")f.records.get(102).contentID=770;
  if(kind==="wrongSystem")f.wing._space.systemID=30000142;
  if(kind==="duplicateLogin")f.scene.sessions.set(103,{...f.wing});
  assert.notEqual(observe(f.options).status,"TWO_PLAYER_NATIVE_DUNGEON_OBJECTIVE_CREDITED",kind);
 }
});

test("native mission normalization retains coop dungeon receipt after every read/reconnect",t=>{
 if(!prefix){t.skip("Requires pinned EveJS Code");return;}
 const file="server/src/services/agent/missionRuntimeState.js";
 const spec=specs.find(x=>x.file===file);
 assert.ok(spec);
 const original=fs.readFileSync(path.join(prefix,file),"utf8");
 const clean=transform(original,spec,true);
 const patched=transform(clean,spec,false);
 new vm.Script(patched);
 assert.equal(transform(patched,spec,false),patched);
 assert.equal(transform(patched,spec,true),clean);
 const start=patched.indexOf("function normalizeMissionRecord(");
 const end=patched.indexOf("function normalizeHistoryEntry(",start);
 assert.ok(start>=0&&end>start);
 const nativeNormalize=new Function("isRetiredActiveMissionRuntimeRecord",
  "toPositiveInteger","normalizeMissionContentID","normalizeText",
  "toBoolean","toFiniteNumber","currentFileTimeString",
  "futureFileTimeString","OFFER_EXPIRY_MS","cloneValue",
  "normalizeMissionRewards",
  patched.slice(start,end)+";return normalizeMissionRecord")(
  ()=>false,(v,fb=0)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):fb,
  v=>v,(v,fb="")=>v===null||v===undefined?fb:String(v),
  (v,fb=false)=>v===null||v===undefined?fb:Boolean(v),
  (v,fb=0)=>Number.isFinite(Number(v))?Number(v):fb,
  ()=> "133700000000000000",()=> "133800000000000000",86400000,
  x=>JSON.parse(JSON.stringify(x)),()=>({}));
 const f=makeFixture(loadNative());
 const source={...f.records.get(102),coopSharedDungeon:{
  sourceInstanceID:700,agentID:55,ownerID:101,
  contentID:440,missionTemplateID:"battle"}};
 const saved=nativeNormalize(source,55,12);
 assert.equal(saved.coopSharedDungeon.sourceInstanceID,700);
 assert.equal(saved.coopSharedDungeon.ownerID,101);
 assert.equal(saved.coopSharedDungeon.agentID,55);
 assert.equal(saved.coopSharedDungeon.contentID,440);
 assert.equal(saved.coopSharedDungeon.missionTemplateID,"battle");
 assert.equal(nativeNormalize(saved,55,12).coopSharedDungeon.sourceInstanceID,700);
 assert.equal(nativeNormalize({...source,contentID:1234},55,12).coopSharedDungeon,null);
 assert.equal(nativeNormalize({...source,coopSharedDungeon:{...source.coopSharedDungeon,
  ownerID:-1}},55,12).coopSharedDungeon,null);
});
