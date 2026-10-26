import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarGateHandoff}=require("../integration/coopWarGateHandoff.cjs");
const {TABLE,KEY:FLEET_KEY}=require("../integration/coopWarFleetRegistry.cjs");
const {KEY:WAR_KEY}=require("../integration/coopFactionWarStore.cjs");
const {KEY:TREASURY_KEY}=require("../integration/coopWarTreasury.cjs");
const env=()=>({
 EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER:"1",
 EVEJS_COOP_FACTION_WAR_GATE_APPROACH:"1",EVEJS_COOP_WAR_TREASURY:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_DURABLE_NPC_SHIPS:"1",
 EVEJS_COOP_NATIVE_GATE_APPROACH:"1",EVEJS_COOP_NATIVE_GATE_TRANSFER:"1",
 EVEJS_COOP_ALIFE:"1"
});
function fixture(mode="success",journalDir){
 const ships=new Map([[101,new Set([501])],[202,new Set()],[303,new Set()]]);
 const ship={itemID:501,kind:"ship",nativeNpc:true,corporationID:31};
 const entity={entityID:501,systemID:101,corporationID:31,ownerID:31};
 const controller={entityID:501,systemID:101};
 const links={"coop-pilot-001":{entityID:501,pilotID:"coop-pilot-001",systemID:101}};
 const identityRegistry={snapshot:()=>({links:structuredClone(links)}),
  relocate:(pilot,src,id,dest)=>{
   if(ships.get(src).has(id)||!ships.get(dest).has(id)||
    links[pilot]?.systemID!==src)return {status:"PHYSICAL_PROOF_MISSING"};
   links[pilot].systemID=dest;return {status:"RELOCATED"};
  }};
 const fleet={version:1,ships:{"501":{
  entityID:501,pilotID:"coop-pilot-001",systemID:101,
  corporationID:31,factionID:11,warID:"w1",campaignID:"c1",fleetID:"fw-c1-11"
 }},history:[],processed:{}};
 const war={version:1,wars:{w1:{state:"ACTIVE",attackerFactionID:11}},
  campaigns:{c1:{state:"PREPARING",sourceSystemID:101,
   targetSystemID:202,supplyReservationID:"res1"}}};
 const treasury={version:1,reservations:{res1:{
  status:"HELD",warID:"w1",campaignID:"c1",factionID:11,cents:1000}}};
 const db=new Map([[FLEET_KEY,fleet],[WAR_KEY,war],[TREASURY_KEY,treasury]]);
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,[TABLE]);
  const copy=new Map([...db].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(_,key)=>copy.get(key)||null,put:(_,key,value)=>copy.set(key,value)};
  const result=fn(tx);db.clear();for(const [key,value] of copy)db.set(key,value);
  return result;
 }}};
 const nativeStore={getNativeEntity:()=>entity,getNativeController:()=>controller,
  listNativeModulesForEntity:()=>[{moduleID:801,entityID:501,typeID:1000}],
  listNativeCargoForEntity:()=>[{cargoID:901,entityID:501,quantity:10}]};
 let recoverCalls=0,moveCalls=0;
 const handoff=createWarGateHandoff({gameStore,identityRegistry,
  env:env(),clock:()=>1234567,nativeStore,service:{},journalDir,
  sceneForSystem:systemID=>({systemID,
   getEntityByID:id=>ships.get(systemID).has(id)?ship:null}),
  getGate:()=>null,getController:()=>controller,isScrambled:()=>false,
  nativeTransferFactory:args=>({
   recoverPending:()=>{recoverCalls++;return {status:"CLEAN",recovered:0}},
   transfer:request=>{
    moveCalls++;
    if(mode==="preflight-refused")
     return {success:false,errorMsg:"NATIVE_PREFLIGHT_REJECTED"};
    const source=request.gate.sourceSystemID,destination=request.gate.destinationSystemID;
    ships.get(source).delete(501);ships.get(destination).add(501);
    entity.systemID=destination;controller.systemID=destination;
    if(mode==="throw-after-move")throw Error("native crash after physical move");
    const result=args.registry.relocate(request.pilotID,source,501,destination);
    if(result.status!=="RELOCATED")
     return {success:false,errorMsg:"JSON_IDENTITY_RELOCATION_FAILED"};
    return {success:true,entityID:501,systemID:destination,
     verifiedSourceAbsent:true,verifiedDestinationPresent:true,
     preservedCargo:true,preservedModules:true};
   }
  })
 });
 const request={pilotID:"coop-pilot-001",entityID:501,
  gate:{sourceSystemID:101,destinationSystemID:202},
  sourceScene:{systemID:101},ship,controller};
 return {handoff,request,ships,db,links,
  get recoverCalls(){return recoverCalls},get moveCalls(){return moveCalls}};
}
test("native war handoff moves one physical ship, SQL fleet and JSON pilot",()=>{
 const f=fixture();
 assert.equal(f.handoff.auditStartup().status,"CLEAN");
 const out=f.handoff.transfer(f.request);
 assert.equal(out.success,true);
 assert.equal(f.db.get(FLEET_KEY).ships["501"].systemID,202);
 assert.equal(f.links["coop-pilot-001"].systemID,202);
 assert.equal(f.handoff.pending().status,"CLEAN");
 assert.equal(f.handoff.auditStartup().status,"CLEAN");
 assert.equal(f.ships.get(101).size,0);
 assert.equal(f.ships.get(202).size,1);
});
test("low-level preflight refusal restores no assets and aborts SQL intent",()=>{
 const f=fixture("preflight-refused");
 const out=f.handoff.transfer(f.request);
 assert.equal(out.success,false);
 assert.equal(f.db.get(FLEET_KEY).ships["501"].systemID,101);
 assert.equal(f.db.get(FLEET_KEY).transfers["501"].phase,"ABORTED");
 assert.equal(f.handoff.pending().status,"CLEAN");
});
test("crash after native physical move cannot trigger duplicate retry",()=>{
 const f=fixture("throw-after-move");
 const first=f.handoff.transfer(f.request);
 assert.equal(first.success,false);
 assert.equal(first.errorMsg,"WAR_NATIVE_TRANSFER_OUTCOME_UNKNOWN");
 assert.equal(f.handoff.pending().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.handoff.auditStartup().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.handoff.transfer(f.request).success,false);
 assert.equal(f.moveCalls,1);
});
test("default-off gate refuses handoff even when all dependencies exist",()=>{
 const flags=env();flags.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER="0";
 assert.equal(require("../integration/coopWarGateHandoff.cjs").flag(flags),false);
});

test("normal verified terminal flight auto-retires without moving native ship",()=>{
 const journalDir=fs.mkdtempSync(path.join(os.tmpdir(),"fw-transit-"));
 try{
  const f=fixture("success",journalDir);
  assert.equal(f.handoff.transfer(f.request).success,true);
  const before=f.db.get(FLEET_KEY).transfers["501"].transferID;
  assert.equal(before,"fw:501:101:202:1");
  const retired=f.handoff.retireCompleted({max:2});
  assert.equal(retired.retired.length,1);
  assert.equal(retired.retired[0].transferID,before);
  assert.equal(f.handoff.retireCompleted({max:2}).retired.length,0);
  assert.equal(f.db.get(FLEET_KEY).transferHistory.length,1);
  assert.equal(f.db.get(FLEET_KEY).transfers["501"],undefined);
  assert.equal(f.db.get(FLEET_KEY).ships["501"].systemID,202);
 }finally{fs.rmSync(journalDir,{recursive:true,force:true})}
});
test("reassigned hull can cross a second verified adjacent border, preserving IDs",()=>{
 const journalDir=fs.mkdtempSync(path.join(os.tmpdir(),"fw-transit-"));
 try{
  const f=fixture("success",journalDir);
  assert.equal(f.handoff.transfer(f.request).success,true);
  assert.equal(f.handoff.retireCompleted({max:1}).retired.length,1);
  const fleet=f.db.get(FLEET_KEY),war=f.db.get(WAR_KEY),
   treasury=f.db.get(TREASURY_KEY);
  fleet.ships["501"].campaignID="c2";
  war.campaigns.c2={state:"PREPARING",sourceSystemID:202,
   targetSystemID:303,supplyReservationID:"res2"};
  treasury.reservations.res2={status:"HELD",warID:"w1",
   campaignID:"c2",factionID:11,cents:5000};
  const request={...f.request,
   gate:{sourceSystemID:202,destinationSystemID:303},
   sourceScene:{systemID:202}};
  assert.equal(f.handoff.transfer(request).success,true);
  assert.equal(f.db.get(FLEET_KEY).ships["501"].entityID,501);
  assert.equal(f.db.get(FLEET_KEY).ships["501"].systemID,303);
  assert.equal(f.db.get(FLEET_KEY).transfers["501"].transferID,
   "fw:501:202:303:2");
  assert.equal(f.handoff.retireCompleted({max:1}).retired.length,1);
  assert.deepEqual(f.db.get(FLEET_KEY).transferHistory.map(x=>x.transferID),
   ["fw:501:101:202:1","fw:501:202:303:2"]);
  assert.equal(f.db.get(FLEET_KEY).nextTransferSerial,3);
  assert.equal(f.links["coop-pilot-001"].systemID,303);
  assert.equal(f.ships.get(101).size+f.ships.get(202).size+
   f.ships.get(303).size,1);
 }finally{fs.rmSync(journalDir,{recursive:true,force:true})}
});
test("the same hull is quarantined when native gate journal is still present",()=>{
 const journalDir=fs.mkdtempSync(path.join(os.tmpdir(),"fw-transit-"));
 try{
  const f=fixture("success",journalDir);
  assert.equal(f.handoff.transfer(f.request).success,true);
  fs.writeFileSync(path.join(journalDir,"coop-pilot-001.json"),"not yet reconciled");
  const r=f.handoff.retireCompleted({max:1});
  assert.equal(r.retired.length,0);
  assert.equal(f.db.get(FLEET_KEY).transfers["501"].phase,"COMPLETE");
  assert.equal(f.db.get(FLEET_KEY).transferHistory,undefined);
 }finally{fs.rmSync(journalDir,{recursive:true,force:true})}
});
