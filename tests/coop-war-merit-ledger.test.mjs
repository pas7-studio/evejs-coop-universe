import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarMeritLedger,KEY,validate}=require("../integration/coopWarMeritLedger.cjs");
const {note}=require("../integration/coopWarKillMerit.cjs");

// The ledger persists into the existing GameStore corporationRuntime atomic
// keyspace; this fixture is that writer's transaction surface.
function fixture(){
 const rows=new Map();
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  const tx={get:(t,k)=>rows.get(k)||null,put:(t,k,v)=>{rows.set(k,structuredClone(v));}};
  return fn(tx);
 }}};
 const env={EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_MERIT:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"};
 const ledger=createWarMeritLedger({gameStore,env,clock:()=>1000000});
 return {ledger,rows,env,gameStore};
}
const strictProof=(over={})=>({status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
 systemID:30001363,victimEntityID:980000017316,victimPilotID:"coop-pilot-055",
 attackerEntityID:980000017150,attackerPilotID:"coop-pilot-050",
 wreckID:980300000005,...over});

test("a confirmed kill pays the killer and costs the victim, once",()=>{
 const f=fixture();
 const events=[];
 const first=note({proof:strictProof(),ledger:f.ledger,emit:(e,c,s,d)=>events.push({e,d})});
 assert.equal(first.status,"PROMOTED");
 assert.equal(first.attackerPilotID,"coop-pilot-050");
 const killer=first.awards[0],victim=first.awards[1];
 assert.equal(killer.merit,25);
 assert.equal(killer.promoted,true);
 assert.equal(killer.from,"recruit");
 assert.equal(killer.to,"pilot");
 assert.equal(killer.command,2);
 assert.equal(victim.kind,"force-lost");
 assert.equal(victim.merit,0,"merit never goes below zero");
 const meritevents=events.filter(x=>x.e==="living-native-war-merit");
 assert.equal(meritevents.length,2);
 assert.equal(meritevents[0].d.status,"PROMOTED");
 assert.equal(meritevents[0].d.wreckID,980300000005);
 assert.equal(meritevents[0].d.evidence,"UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK");
 const replay=note({proof:strictProof(),ledger:f.ledger});
 assert.equal(replay.status,"DUPLICATE","the same wreck never pays twice");
 assert.equal(f.ledger.records()["coop-pilot-050"].merit,25);
});

test("no strict native attacker means no merit at all",()=>{
 const f=fixture();
 for(const status of ["UPSTREAM_ATTACKER_NOT_PROVIDED","UPSTREAM_ATTACKER_NOT_NATIVE",
  "VICTIM_NOT_NAMED","ATTACKER_NOT_NAMED","INVALID_NATIVE_DESTRUCTION"]){
  const result=note({proof:strictProof({status}),ledger:f.ledger});
  assert.equal(result.status,"NO_STRICT_NATIVE_ATTACKER",status);
 }
 assert.deepEqual(f.ledger.records(),{});
});

test("an identity that cannot be a kill is refused",()=>{
 const f=fixture();
 assert.equal(note({proof:strictProof({attackerPilotID:"not-a-pilot"}),ledger:f.ledger}).status,"BLOCKED");
 assert.equal(note({proof:strictProof({attackerPilotID:"coop-pilot-055"}),ledger:f.ledger}).status,"BLOCKED",
  "a hull cannot kill itself");
 assert.equal(note({proof:strictProof({wreckID:0}),ledger:f.ledger}).status,"BLOCKED");
 assert.deepEqual(f.ledger.records(),{});
});

test("the ledger refuses a different payout for a wreck it already paid",()=>{
 const f=fixture();
 assert.equal(f.ledger.award({pilotID:"coop-pilot-050",kind:"warship-kill", evidenceKey:"wreck:980300000005"}).status,"PROMOTED");
 const conflict=f.ledger.award({pilotID:"coop-pilot-051",kind:"warship-kill",
  evidenceKey:"wreck:980300000005"});
 assert.equal(conflict.status,"BLOCKED");
 assert.equal(conflict.reason,"WAR_MERIT_REPLAY_CONFLICT");
});

test("an unknown event or a disabled feature never pays",()=>{
 const f=fixture();
 assert.equal(f.ledger.award({pilotID:"coop-pilot-050",kind:"free-isk",
  evidenceKey:"wreck:1"}).reason,"UNKNOWN_MERIT_EVENT");
 f.env.EVEJS_COOP_FACTION_WAR_MERIT="0";
 assert.equal(f.ledger.award({pilotID:"coop-pilot-050",kind:"warship-kill",
  evidenceKey:"wreck:1"}).status,"DISABLED");
 assert.deepEqual(f.ledger.records(),{});
});

test("a stored record is validated and survives a reload",()=>{
 const f=fixture();
 f.ledger.award({pilotID:"coop-pilot-050",kind:"warship-kill",evidenceKey:"wreck:7"});
 const stored=f.rows.get(KEY);
 assert.equal(stored.version,1);
 validate(stored);
 assert.equal(stored.records["coop-pilot-050"].rank,"pilot");
 assert.equal(stored.records["coop-pilot-050"].history.length,1);
 assert.equal(stored.paid["warship-kill:wreck:7"].merit,25);
 const reloaded=createWarMeritLedger({gameStore:f.gameStore,env:f.env,clock:()=>2000000});
 assert.equal(reloaded.records()["coop-pilot-050"].merit,25);
 assert.throws(()=>validate({version:1,records:{bad:{}},paid:{}}),
  /WAR_MERIT_RECORD_CORRUPT/);
});
