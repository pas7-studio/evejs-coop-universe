import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarCasualtyLedger,KEY,TABLE}=
 require("../integration/coopWarCasualtyLedger.cjs");
const WAR_KEY="coop-faction-war\u001fstate-v1",
 FLEET_KEY="coop-faction-war\u001ffleet-registry-v1";
const env=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_FACTION_WAR_NATIVE_CASUALTIES:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"});
const command=(x={})=>({systemID:202,entityID:501,
 wreckID:9001,pilotID:"coop-pilot-001",...x});
function fixture({native=true,warActive=true,phase="ASSAULT"}={}){
 const flags=env();let physical=native,corpFaction=11,throws=false,
  witnessCount=0;
 const war={version:1,
  wars:{w1:{warID:"w1",attackerFactionID:11,
   defenderFactionID:22,state:warActive?"ACTIVE":"ENDED"}},
  territories:{},enlistments:{},processed:{},history:[],
  campaigns:{c1:{campaignID:"c1",warID:"w1",targetSystemID:202,
   sourceSystemID:101,state:phase,revision:2,objectiveEvidence:[]}}};
 const fleet={version:1,ships:{
  "501":{entityID:501,systemID:202,pilotID:"coop-pilot-001",
   factionID:11,corporationID:31,warID:"w1",campaignID:"c1",
   fleetID:"fw-c1-11"},
  "502":{entityID:502,systemID:202,pilotID:"coop-pilot-002",
   factionID:22,corporationID:32,warID:"w1",campaignID:"c1",
   fleetID:"fw-c1-22"}},processed:{},history:[]};
 const rows=new Map([[WAR_KEY,war],[FLEET_KEY,fleet]]);
 const store={coopAtomicNativeRows:{transact:([table],fn)=>{
  assert.equal(table,TABLE);
  if(throws)throw Error("SQLITE_COMMIT_OUTCOME_UNKNOWN");
  const next=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));
  const out=fn({get:(_,key)=>next.get(key)||null,
   put:(_,key,value)=>next.set(key,structuredClone(value))});
  rows.clear();for(const [key,value] of next)rows.set(key,value);
  return out;
 }}};
 const casualty=createWarCasualtyLedger({gameStore:store,env:flags,
  clock:()=>1234567,
  getFactionForCorporation:id=>id===31?corpFaction:22,
  verifyNativeWreck:d=>{
   witnessCount++;
   if(!physical)return {status:"NATIVE_WRECK_UNVERIFIED"};
   return {status:"PHYSICAL_NATIVE_WRECK_VERIFIED",
    systemID:d.systemID,victimEntityID:d.entityID,
    victimPilotID:d.pilotID,wreckID:d.wreckID,storedItemCount:3};
  }});
 return {casualty,rows,war,fleet,flags,
  setPhysical:x=>physical=x,setFaction:x=>corpFaction=x,
  failSql:()=>throws=true,get witnessCount(){return witnessCount},
  state:()=>rows.get(KEY)};
}
test("actual NPC wreck commits one immutable native casualty with no winner",()=>{
 const f=fixture();
 const result=f.casualty.record(command());
 assert.equal(result.status,"RECORDED");
 assert.equal(result.receipt.attribution,"NATIVE_VICTIM_WRECK_ONLY_NO_KILLER");
 assert.equal(f.state().count,1);
 const verdict=f.casualty.assess({campaignID:"c1"});
 assert.equal(verdict.attackerConfirmedLosses,1);
 assert.equal(verdict.defenderConfirmedLosses,0);
 assert.equal(verdict.captureAuthorized,false);
 assert.equal(verdict.victoryAdjudicated,false);
 assert.equal(verdict.killCreditAssigned,false);
 assert.equal(f.rows.get(WAR_KEY).campaigns.c1.state,"ASSAULT");
});
test("repeat native callback dedupes the same wreck without extra witness",()=>{
 const f=fixture();
 assert.equal(f.casualty.record(command()).status,"RECORDED");
 f.setPhysical(false);
 assert.equal(f.casualty.record(command()).status,"DUPLICATE");
 assert.equal(f.state().count,1);
 assert.equal(f.witnessCount,1);
});
test("one native wreck cannot be charged to a second physical ship",()=>{
 const f=fixture();f.casualty.record(command());
 const conflict=f.casualty.record(command({entityID:502,
  pilotID:"coop-pilot-002"}));
 assert.equal(conflict.reason,"NATIVE_WRECK_REPLAY_CONFLICT");
 assert.equal(f.state().count,1);
});
test("missing native wreck and SDE faction mismatch never create losses",()=>{
 const f=fixture({native:false});
 assert.equal(f.casualty.record(command()).reason,
  "NATIVE_WRECK_OR_SDE_FACTION_UNVERIFIED");
 f.setPhysical(true);f.setFaction(22);
 assert.equal(f.casualty.record(command()).reason,
  "NATIVE_WRECK_OR_SDE_FACTION_UNVERIFIED");
 assert.equal(f.state(),undefined);
});
test("hit, attack order, or claimed loss without physical native wreck are not evidence",()=>{
 const f=fixture();
 assert.equal(f.casualty.record({...command(),wreckID:0}).status,"BLOCKED");
 f.setPhysical(false);
 assert.equal(f.casualty.record(command()).status,"BLOCKED");
 assert.equal(f.state(),undefined);
});
test("only active real ASSAULT in target system authorizes loss observation",()=>{
 for(const phase of ["PREPARING","CANCELLED","OCCUPIED"]){
  const f=fixture({phase});
  assert.equal(f.casualty.record(command()).reason,
   "WAR_CASUALTY_NO_NATIVE_ASSAULT");
 }
 const ended=fixture({warActive:false});
 assert.equal(ended.casualty.record(command()).reason,
  "WAR_CASUALTY_NO_NATIVE_ASSAULT");
 const source=fixture();
 assert.equal(source.casualty.record(command({systemID:101})).status,"BLOCKED");
});
test("unretired native military transfer excludes the victim from causal attribution",()=>{
 const f=fixture();
 f.rows.get(FLEET_KEY).transfers={"501":{entityID:501,
  pilotID:"coop-pilot-001",warID:"w1",campaignID:"c1",
  phase:"NATIVE_COMMITTED",sourceSystemID:101,destinationSystemID:202}};
 assert.equal(f.casualty.record(command()).status,"BLOCKED");
 assert.equal(f.state(),undefined);
});
test("actual attacker and defender deaths are distinct counted victims not victory",()=>{
 const f=fixture();f.casualty.record(command());
 f.casualty.record(command({entityID:502,wreckID:9002,
  pilotID:"coop-pilot-002"}));
 const result=f.casualty.assess({campaignID:"c1"});
 assert.equal(result.attackerConfirmedLosses,1);
 assert.equal(result.defenderConfirmedLosses,1);
 assert.equal(result.totalConfirmedLosses,2);
 assert.equal(result.objectiveProofRequired,true);
 assert.equal(f.rows.get(WAR_KEY).campaigns.c1.state,"ASSAULT");
});
test("unknown SQLite commit never acknowledges a battle result",()=>{
 const f=fixture();f.failSql();
 assert.throws(()=>f.casualty.record(command()),/SQLITE_COMMIT_OUTCOME_UNKNOWN/);
 assert.equal(f.state(),undefined);
});
test("feature defaults off without native state mutations",()=>{
 const f=fixture();f.flags.EVEJS_COOP_FACTION_WAR_NATIVE_CASUALTIES="0";
 assert.equal(f.casualty.record(command()).status,"DISABLED");
 assert.equal(f.casualty.assess({campaignID:"c1"}).status,"DISABLED");
 assert.equal(f.state(),undefined);
});


test("one physical victim cannot count twice if native emits a second wreck ID",()=>{
 const f=fixture();assert.equal(f.casualty.record(command()).status,"RECORDED");
 const second=f.casualty.record(command({wreckID:9003}));
 assert.equal(second.reason,"WAR_CASUALTY_VICTIM_ALREADY_RECORDED");
 assert.equal(f.state().count,1);
});
