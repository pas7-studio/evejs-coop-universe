import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFactionWarAgent}=require('../integration/coopFactionWarAgent.cjs');
const {createFactionWarStore}=require('../integration/coopFactionWarStore.cjs');
function fixture(){
 const env={EVEJS_COOP_FACTION_WAR:'1',EVEJS_COOP_FACTION_MILITIA_AGENT:'1',
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1',EVEJS_COOP_MILITIA_FACTION_IDS:'11'};
 const rows=new Map(),tx={get:(t,k)=>rows.get(t+':'+k),put:(t,k,v)=>rows.set(t+':'+k,v)};
 const db={coopAtomicNativeRows:{transact:(_tables,fn)=>fn(tx)}};
 const session={characterID:41,stationid:61,socket:{destroyed:false}};
 const agent={agentID:71,corporationID:21,stationID:61,solarSystemID:31};
 const faction={factionID:11,name:'Example Faction',militiaCorporationID:22};
 let standing=0,mission=null;
 const makeStore=proofs=>createFactionWarStore({gameStore:db,proofs,clock:()=>1000000});
 const warAgent=createFactionWarAgent({
  getAgent:id=>id===71?agent:null,getMission:()=>mission,getSessions:()=>[session],
  getFactionForCorporation:id=>id===21?faction:null,
  getFaction:id=>id===11?faction:null,getCharacter:()=>({characterID:41}),
  getDockedLocationID:s=>s.stationid,getDockedLocationKind:s=>s.stationid?'station':'space',
  getEffectiveStanding:()=>({standing}),makeStore,clock:()=>1000000,env});
 const action=id=>warAgent.doAction({session,agentID:71,actionID:id});
 return {env,session,agent,faction,action,warAgent,peek:()=>makeStore({}).snapshot(),
  setStanding:v=>standing=v,setMission:v=>mission=v};
}
function withFlags(fn){
 const a=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS,b=process.env.EVEJS_COOP_FACTION_WAR;
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS='1';process.env.EVEJS_COOP_FACTION_WAR='1';
 try{return fn()}finally{
  if(a===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=a;
  if(b===undefined)delete process.env.EVEJS_COOP_FACTION_WAR;else process.env.EVEJS_COOP_FACTION_WAR=b;
 }
}
test('authentic native agent Accept enlists exactly once without mission or corp mutation',()=>withFlags(()=>{
 const f=fixture();assert.deepEqual(f.action(null).data.actions[0],[3,3]);
 assert.match(f.action(3).data.agentSays[0],/Enlistment recorded/);
 assert.equal(f.peek().enlistments['41'].factionID,11);
 assert.equal(f.peek().history.length,1);
 assert.deepEqual(f.action(null).data.actions[0],[9,9]);
 assert.equal(f.warAgent.briefing({session:f.session,agentID:71})['Mission ID'],null);
}));
test('stock Decline explicitly leaves militia with cooldown',()=>withFlags(()=>{
 const f=fixture();f.action(3);
 assert.match(f.action(9).data.agentSays[0],/Service ended/);
 assert.equal(f.peek().enlistments['41'].status,'LEFT');
 assert.match(f.action(null).data.agentSays[0],/cooldown/);
 assert.equal(f.peek().history.length,2);
}));
test('existing native mission never shadowed',()=>withFlags(()=>{
 const f=fixture();f.setMission({missionID:25});
 assert.equal(f.action(null),null);assert.equal(f.action(3),null);
 assert.deepEqual(f.peek().enlistments,{});
}));
test('undocked/disconnected/spoofed agent blocked',()=>withFlags(()=>{
 const f=fixture();f.session.stationid=null;assert.equal(f.action(null),null);
 f.session.stationid=61;f.session.socket.destroyed=true;assert.equal(f.action(3),null);
 f.session.socket.destroyed=false;f.agent.corporationID=999;assert.equal(f.action(3),null);
 assert.deepEqual(f.peek().enlistments,{});
}));
test('negative faction standing and absent operator allowlist deny joining',()=>withFlags(()=>{
 const f=fixture();f.setStanding(-1);
 assert.deepEqual(f.action(null).data.actions[0],[1,1]);
 assert.equal(f.peek().history.length,0);
 f.env.EVEJS_COOP_MILITIA_FACTION_IDS='';assert.equal(f.action(null),null);
}));
test('default-off militia agent does not intercept native missions',()=>withFlags(()=>{
 const f=fixture();f.env.EVEJS_COOP_FACTION_MILITIA_AGENT='0';
 assert.equal(f.action(3),null);
}));
