import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createFactionWarAgent}=require("../integration/coopFactionWarAgent.cjs");
function fixture({enlisted=true}={}){
 const env={EVEJS_COOP_FACTION_WAR:"1",
  EVEJS_COOP_FACTION_MILITIA_AGENT:"1",
  EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
  EVEJS_COOP_MILITIA_FACTION_IDS:"11"};
 const session={characterID:9001,stationid:4001,
  socket:{destroyed:false}};
 const faction={factionID:11,name:"Test Militia",militiaCorporationID:32};
 const agent={agentID:3001,corporationID:31,
  stationID:4001,solarSystemID:202};
 const existing=enlisted?{status:"ACTIVE",factionID:11,
  characterID:9001,enlistedAt:15}:null;
 let seen=null;
 const api=createFactionWarAgent({
  env,getAgent:id=>id===3001?agent:null,
  getMission:()=>null,getSessions:()=>[session],
  getFactionForCorporation:id=>id===31?faction:null,
  getFaction:id=>id===11?faction:null,
  getCharacter:id=>id===9001?{characterID:id}:null,
  getDockedLocationID:s=>s.stationid,
  getDockedLocationKind:s=>s.stationid?"station":"space",
  getEffectiveStanding:()=>({standing:3}),
  getFrontlineStatus:actor=>{
   seen=actor;return {status:"OBSERVED",
    text:"[Militia Front] ATTACK system 202 (ASSAULT): hold 3/4."};
  },
  makeStore:()=>({snapshot:()=>({enlistments:existing?
   {"9001":existing}:{}})}),clock:()=>10000
 });
 return {api,env,session,agent,
  seen:()=>seen,doAction:()=>api.doAction({session,agentID:3001}),
  briefing:()=>api.briefing({session,agentID:3001})};
}
test("stock militia agent displays native war front in normal in-game dialogue",()=>{
 const f=fixture();
 assert.match(f.doAction().data.agentSays[0],/ATTACK system 202/);
 assert.match(f.briefing()["Mission Briefing ID"],/hold 3\/4/);
 assert.deepEqual(f.seen(),{characterID:9001,factionID:11});
});
test("non-member never gets fighter-only front line details from agent",()=>{
 const f=fixture({enlisted:false});
 assert.doesNotMatch(f.doAction().data.agentSays[0],/system 202/);
 assert.doesNotMatch(f.briefing()["Mission Briefing ID"],/ATTACK system/);
});
test("default-off player presence gate hides all war front line UI",()=>{
 const f=fixture();
 f.env.EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE="0";
 assert.doesNotMatch(f.doAction().data.agentSays[0],/ATTACK system/);
 assert.doesNotMatch(f.briefing()["Mission Briefing ID"],/ATTACK system/);
});
test("disconnected agent player cannot query current front line",()=>{
 const f=fixture();f.session.socket.destroyed=true;
 assert.equal(f.doAction(),null);
 assert.equal(f.briefing(),null);
 assert.equal(f.seen(),null);
});
