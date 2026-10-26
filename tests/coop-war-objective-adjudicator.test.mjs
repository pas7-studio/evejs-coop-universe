import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const core=require("../integration/coopFactionWarCore.cjs");
const {KEY:WAR_KEY,TABLE}=require("../integration/coopFactionWarStore.cjs");
const {KEY:FLEET_KEY}=require("../integration/coopWarFleetRegistry.cjs");
const {KEY,createWarObjectiveAdjudicator}=
 require("../integration/coopWarObjectiveAdjudicator.cjs");
function fixture({origin=true,control=true,corp=32}={}){
 const flags={EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
  EVEJS_COOP_FACTION_WAR_NATIVE_OBJECTIVES:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"};
 let now=100000,combat=origin,occupation=control,
  observed=0,contact=false;
 const war=core.empty();
 war.wars.w1={warID:"w1",attackerFactionID:11,defenderFactionID:22,state:"ACTIVE"};
 war.territories["101"]={systemID:101,militaryControllerFactionID:11,
  originalOwnerFactionID:11,state:"SECURE",revision:1};
 war.territories["202"]={systemID:202,militaryControllerFactionID:22,
  originalOwnerFactionID:22,state:"CONTESTED",revision:2};
 war.campaigns.c1={campaignID:"c1",warID:"w1",state:"ASSAULT",
  attackerFactionID:11,sourceSystemID:101,targetSystemID:202,
  revision:2,objectiveEvidence:[],startedAt:10};
 const fleet={version:1,ships:{"501":{entityID:501,systemID:202,
  pilotID:"coop-pilot-001",corporationID:31,factionID:11,
  fleetID:"fw-c1-11",warID:"w1",campaignID:"c1"}},processed:{},history:[]};
 const rows=new Map([[WAR_KEY,war],[FLEET_KEY,fleet]]);
 const structure={structureID:700,solarSystemID:202,ownerCorpID:corp,
  typeID:1010,position:{x:100,y:200,z:300},state:7,destroyedAt:null};
 const gameStore={coopAtomicNativeRows:{transact:([table],fn)=>{
  assert.equal(table,TABLE);
  const next=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(_,key)=>next.get(key)||null,
   put:(_,key,value)=>next.set(key,structuredClone(value))};
  const result=fn(tx);
  rows.clear();for(const [k,v] of next)rows.set(k,v);
  return result;
 }}};
 const instance=createWarObjectiveAdjudicator({gameStore,env:flags,
  getNativeStructure:id=>id===700?structure:null,
  getFactionForCorporation:id=>id===32?22:11,
  verifyNativeCombatDestruction:details=>combat&&
   details.structureID===700&&details.systemID===202&&
   details.combatProofID==="native-combat-700"&&
   details.ownerCorporationID===32,
  observeNativeControl:d=>{
   observed++;
   return occupation?{status:"UNCONTESTED_NATIVE_ATTACKER",
    systemID:d.systemID,attackerFactionID:11,
    defenderFactionID:22,attackerCount:1,defenderCount:0,
    physicalProof:true}:
    {status:contact?"CONTESTED":"SCENE_NOT_LOADED",
     systemID:d.systemID,attackerCount:0,defenderCount:0,
     physicalProof:false};
  },
  clock:()=>now});
 const bind={campaignID:"c1",eventID:"bind-c1",structureID:700,
  expectedRevision:2};
 const neutral={campaignID:"c1",eventID:"combat-c1",structureID:700,
  expectedRevision:2,combatProofID:"native-combat-700"};
 const sample=i=>({campaignID:"c1",eventID:"sample-c1-"+i,
  expectedRevision:3});
 const capture={campaignID:"c1",eventID:"capture-c1",
  expectedRevision:3,captureProofID:"native-presence-700"};
 return {flags,rows,war,structure,instance,bind,neutral,sample,capture,
  tick:ms=>{now+=ms},now:()=>now,combat:x=>combat=x,
  control:x=>occupation=x,contact:x=>contact=x,
  get observations(){return observed},
  state:()=>rows.get(KEY),authoritative:()=>rows.get(WAR_KEY)};
}
const setup=fixture=>{
 const b=fixture.instance.bind(fixture.bind);
 assert.equal(b.status,"APPLIED");
 fixture.tick(1000);
 fixture.structure.destroyedAt=fixture.now();
 const n=fixture.instance.neutralize(fixture.neutral);
 assert.equal(n.status,"APPLIED");
};
test("bind original native defender structure while assault is active",()=>{
 const f=fixture();
 const r=f.instance.bind(f.bind);
 assert.equal(r.status,"APPLIED");
 assert.equal(f.state().objectives.c1.structureID,700);
 assert.equal(f.state().objectives.c1.ownerFactionID,22);
 assert.equal(f.instance.bind(f.bind).status,"DUPLICATE");
 assert.equal(f.authoritative().campaigns.c1.state,"ASSAULT");
});
test("cannot bind foreign, missing, admin-destroyed, or wrong-revision structure",()=>{
 const alien=fixture({corp:31});
 assert.equal(alien.instance.bind(alien.bind).reason,
  "OBJECTIVE_STRUCTURE_NOT_DEFENDER_NATIVE");
 const dead=fixture();dead.structure.destroyedAt=12345;
 assert.equal(dead.instance.bind(dead.bind).reason,
  "OBJECTIVE_STRUCTURE_NOT_DEFENDER_NATIVE");
 const stale=fixture();
 assert.equal(stale.instance.bind({...stale.bind,expectedRevision:1}).reason,
  "OBJECTIVE_BIND_NOT_AVAILABLE");
});
test("destroyedAt alone cannot neutralize objective without native combat origin",()=>{
 const f=fixture({origin:false});
 assert.equal(f.instance.bind(f.bind).status,"APPLIED");
 f.tick(1000);f.structure.destroyedAt=f.now();
 assert.equal(f.instance.neutralize(f.neutral).reason,
  "NATIVE_COMBAT_DESTRUCTION_NOT_PROVEN");
 assert.equal(f.authoritative().campaigns.c1.objectiveEvidence.length,0);
 assert.equal(f.state().objectives.c1.state,"BOUND");
});
test("real combat-origin objective is recorded once in exact same SQLite commit",()=>{
 const f=fixture();setup(f);
 assert.equal(f.authoritative().campaigns.c1.objectiveEvidence.length,1);
 assert.equal(f.authoritative().campaigns.c1.objectiveEvidence[0].objectiveID,
  "structure:700");
 assert.equal(f.authoritative().campaigns.c1.revision,3);
 assert.equal(f.state().objectives.c1.state,"NEUTRALIZED");
 assert.equal(f.instance.neutralize(f.neutral).status,"DUPLICATE");
 assert.equal(f.authoritative().campaigns.c1.objectiveEvidence.length,1);
});
test("four consecutive native 30-second samples and 90s presence authorize military control",()=>{
 const f=fixture();setup(f);
 for(let i=1;i<=4;i++){
  f.tick(i===1?30000:30000);
  const r=f.instance.sample(f.sample(i));
  assert.equal(r.status,"APPLIED");
  if(i<4)assert.equal(r.receipt.captureReady,false);
  else assert.equal(r.receipt.captureReady,true);
 }
 assert.equal(f.instance.capture(f.capture).status,"APPLIED");
 assert.equal(f.authoritative().campaigns.c1.state,"OCCUPIED");
 assert.equal(f.authoritative().territories["202"].militaryControllerFactionID,11);
 assert.equal(f.authoritative().territories["202"].state,"OCCUPIED");
 assert.equal(f.state().objectives.c1.state,"CAPTURED");
 assert.equal(f.instance.capture(f.capture).status,"DUPLICATE");
 assert.equal(f.authoritative().territories["202"].revision,3);
});
test("native wreck casualties never count as an independent objective",()=>{
 const f=fixture();
 f.rows.set("coop-faction-war\u001fcasualties-v1",{
  version:1,count:5,byWreck:{}});
 assert.equal(f.instance.capture(f.capture).reason,
  "CAPTURE_REVISION_OR_OBJECTIVE_INVALID");
 assert.equal(f.authoritative().campaigns.c1.state,"ASSAULT");
});
test("contested or unknown scene immediately resets consecutive occupancy",()=>{
 const f=fixture();setup(f);
 f.tick(30000);f.instance.sample(f.sample(1));
 f.tick(30000);f.instance.sample(f.sample(2));
 f.control(false);f.contact(true);
 f.tick(30000);
 const result=f.instance.sample(f.sample(3));
 assert.equal(result.status,"APPLIED");
 assert.equal(result.receipt.consecutiveSamples,0);
 assert.equal(f.instance.capture(f.capture).reason,
  "CAPTURE_NATIVE_OCCUPANCY_NOT_SUSTAINED");
 assert.equal(f.authoritative().campaigns.c1.state,"ASSAULT");
});
test("offline catch-up or replayed same-second samples cannot produce fake occupation",()=>{
 const f=fixture();setup(f);
 f.tick(30000);f.instance.sample(f.sample(1));
 assert.equal(f.instance.sample(f.sample(2)).reason,"OCCUPANCY_SAMPLE_TOO_SOON");
 f.tick(60000);const r=f.instance.sample(f.sample(3));
 assert.equal(r.receipt.consecutiveSamples,1);
 assert.equal(f.instance.capture(f.capture).reason,
  "CAPTURE_NATIVE_OCCUPANCY_NOT_SUSTAINED");
});
test("native defender returning at final capture gate aborts contested CAS",()=>{
 const f=fixture();setup(f);
 for(let i=1;i<=4;i++){f.tick(30000);f.instance.sample(f.sample(i))}
 f.control(false);f.contact(true);
 assert.equal(f.instance.capture(f.capture).reason,
  "NATIVE_CAPTURE_CURRENT_CONTROL_UNPROVEN");
 assert.equal(f.authoritative().territories["202"].militaryControllerFactionID,22);
});
test("campaign revision change prevents stale objective and final territory capture",()=>{
 const f=fixture();setup(f);
 for(let i=1;i<=4;i++){f.tick(30000);f.instance.sample(f.sample(i))}
 f.authoritative().campaigns.c1.revision=4;
 assert.equal(f.instance.capture(f.capture).reason,
  "CAPTURE_REVISION_OR_OBJECTIVE_INVALID");
 assert.equal(f.authoritative().territories["202"].militaryControllerFactionID,22);
});
test("same structure ID cannot be bound to another campaign",()=>{
 const f=fixture();f.instance.bind(f.bind);
 const s=f.authoritative();
 s.campaigns.c2={...s.campaigns.c1,campaignID:"c2",revision:2};
 assert.equal(f.instance.bind({...f.bind,campaignID:"c2",eventID:"bind-c2"}).reason,
  "OBJECTIVE_BIND_NOT_AVAILABLE");
});
test("all capture mechanics default off without native structure providers",()=>{
 const f=fixture();f.flags.EVEJS_COOP_FACTION_WAR_NATIVE_OBJECTIVES="0";
 assert.equal(f.instance.bind(f.bind).status,"DISABLED");
 assert.equal(f.state(),undefined);
});
