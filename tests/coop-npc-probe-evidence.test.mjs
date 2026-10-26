import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcProbeHardware}=require("../integration/coopNpcProbeHardware.cjs");
const {createNpcProbeScanEvidence}=require("../integration/coopNpcProbeScanEvidence.cjs");
const sid=30000142,id=980000000010,owner=901,corp=700;
function fixture(){
 let now=1000000,scanCalls=0,sourceCertainty=1,sourceTarget="ABC-123";
 const ship={itemID:id,kind:"ship",nativeNpc:true,systemID:sid,
  ownerID:owner,corporationID:corp,position:{x:0,y:0,z:0}};
 const entity={entityID:id,systemID:sid,ownerID:owner,corporationID:corp};
 const controller={entityID:id,systemID:sid};
 const launcher={moduleID:980100000001,entityID:id,ownerID:owner,
  typeID:1001,groupID:481,categoryID:7,flagID:11,
  moduleState:{online:true,incapacitated:false}};
 const cargo=[1,2,3,4].map(i=>({
  cargoID:980200000000+i,entityID:id,ownerID:owner,moduleID:launcher.moduleID,
  typeID:3001,groupID:479,categoryID:8,quantity:0,
  deployedProbe:{status:"IN_SPACE",probeID:980200000000+i,entityID:id,
   ownerID:owner,systemID:sid,typeID:3001,launchedAtMs:now-5000,
   position:{x:i*1000,y:0,z:0},rangeStep:4,scanRange:1e10}
 }));
 const probes=new Map(cargo.map(c=>[c.cargoID,{itemID:c.cargoID,kind:"probe",
  typeID:3001,ownerID:owner,systemID:sid,
  position:{...c.deployedProbe.position}}]));
 const scene={systemID:sid,getEntityByID:probeID=>probeID===id?ship:probes.get(probeID)};
 const assignments=[{entityID:id,systemID:sid,pilotID:"coop-pilot-310"}];
 const site={siteID:250,systemID:sid,solarSystemID:sid,targetID:"ABC-123",
  itemID:250,siteKind:"signature",family:"relic",typeID:900,
  instanceID:889,actualPosition:{x:1e9,y:2e9,z:3e9}};
 const resultRow=()=>({type:"object",name:"util.KeyVal",args:{type:"dict",entries:[
  ["id",sourceTarget],["certainty",sourceCertainty],["itemID",250],
  ["pos",{type:"list",items:[site.actualPosition.x,site.actualPosition.y,site.actualPosition.z]
    .map(v=>({type:"real",value:v}))}]]}});
 const deps={
  getNativeEntity:()=>entity,getController:()=>controller,
  listNativeModulesForEntity:()=>[launcher],listNativeCargoForEntity:()=>cargo,
  getCompatibleProbeChargeTypeIDs:()=>[3001],
  resolveProbeRangeContract:(_type,step)=>({rangeStep:step,scanRange:1e10}),
  scanNativeResults:(_sys,map)=>{scanCalls++;assert.equal(map.size,cargo.length);
   return {results:[resultRow()]};},
  listNativeSites:()=>[site],clock:()=>now};
 const hardware=()=>createNpcProbeHardware(deps).check({scene,entityID:id,assignments});
 const scan=()=>createNpcProbeScanEvidence(deps).scan({scene,entityID:id,assignments});
 return {deps,scene,ship,entity,controller,launcher,cargo,probes,assignments,site,
  hardware,scan,mutateClock:ms=>{now+=ms},
  getScanCalls:()=>scanCalls,setCertainty:v=>{sourceCertainty=v},
  setResultTarget:v=>{sourceTarget=v}};
}
test("source owns exact scanner launcher and unconsumed native charge records",()=>{
 const f=fixture();
 for(const c of f.cargo){c.quantity=1;delete c.deployedProbe;}
 const result=f.hardware();
 assert.equal(result.status,"NATIVE_SCANNER_HARDWARE_READY");
 assert.equal(result.availableUnits,4);
 assert.equal(result.launcherID,f.launcher.moduleID);
 assert.deepEqual(result.originalCargoIDs,f.cargo.map(x=>x.cargoID));
 assert.equal(f.scan().status,"BLOCKED"); // not launched, no scan
});
test("original cargo flight receipts + four materialized probes allow native engine scan",()=>{
 const f=fixture(),r=f.scan();
 assert.equal(r.status,"NATIVE_PROBE_SCANNED");
 assert.equal(r.probeCount,4);
 assert.equal(f.getScanCalls(),1);
 assert.equal(r.proofs.length,1);
 assert.equal(r.proofs[0].nativeScanCertainty,1);
 assert.equal(r.proofs[0].siteID,f.site.siteID);
 assert.equal(r.proofs[0].source,"ORIGINAL_PHYSICAL_NPC_PROBE_SCAN");
 assert.equal(r.nativeWalletMutation,false);
 assert.equal(r.nativeLootGranted,false);
});
test("source catalog alone cannot create NPC probe scans",()=>{
 const f=fixture();for(const c of f.cargo)delete c.deployedProbe;
 assert.equal(f.scan().status,"BLOCKED");
 assert.equal(f.getScanCalls(),0);
});
test("real 3 probes cannot reach native certainty scanner path",()=>{
 const f=fixture();f.cargo.pop();const r=f.scan();
 assert.equal(r.reason,"NPC_SCANNER_FOUR_ORIGINAL_PROBES_REQUIRED");
 assert.equal(f.getScanCalls(),0);
});
test("client/scanner probe without original NPC cargo record is ignored",()=>{
 const f=fixture();f.cargo.length=0;
 assert.equal(f.scan().proofs.length,0);
 assert.equal(f.getScanCalls(),0);
});
test("missing physical probe or owner mismatch refuses entire scan",()=>{
 const f=fixture();f.probes.delete(f.cargo[0].cargoID);
 assert.equal(f.scan().reason,"NPC_SCANNER_PHYSICAL_PROBE_UNVERIFIED");
 const g=fixture();g.probes.get(g.cargo[0].cargoID).ownerID=25;
 assert.equal(g.scan().reason,"NPC_SCANNER_PHYSICAL_PROBE_UNVERIFIED");
});
test("retargeted physical probe position invalidates native flight receipt",()=>{
 const f=fixture();f.probes.get(f.cargo[0].cargoID).position.x+=2000;
 assert.equal(f.scan().status,"BLOCKED");assert.equal(f.getScanCalls(),0);
});
test("foreign corp, recycled NPC hull or duplicate pilot cannot scan",()=>{
 for(const mutation of [
  f=>{f.ship.corporationID=800},f=>{f.ship.nativeNpc=false},
  f=>{f.assignments.push({entityID:18,systemID:sid,pilotID:"coop-pilot-310"})}
 ]){
  const f=fixture();mutation(f);assert.equal(f.scan().status,"BLOCKED");
  assert.equal(f.getScanCalls(),0);
 }
});
test("out-of-range and wrong charge/probe compatibility cannot bypass",()=>{
 for(const mutation of [
  f=>{f.cargo[0].deployedProbe.scanRange=1e11},
  f=>{f.cargo[0].typeID=3900},
  f=>{f.cargo[0].deployedProbe.rangeStep=99},
  f=>{f.launcher.moduleState.online=false}
 ]){
  const f=fixture();mutation(f);assert.equal(f.scan().status,"BLOCKED");
  assert.equal(f.getScanCalls(),0);
 }
});
test("expired flight and active warp cannot leak remote site",()=>{
 const f=fixture();f.mutateClock(3605000);
 assert.equal(f.scan().status,"BLOCKED");
 const g=fixture();g.ship.pendingWarp={};
 assert.equal(g.scan().status,"BLOCKED");
});
test("native certainty below 1 cannot share private coordinates",()=>{
 const f=fixture();f.setCertainty(0.99);
 const r=f.scan();assert.equal(r.status,"NATIVE_PROBE_SCANNED");
 assert.deepEqual(r.proofs,[]);
});
test("source scanner result for unknown site cannot become NPC intel",()=>{
 const f=fixture();f.setResultTarget("FAKE-999");
 assert.equal(f.scan().proofs.length,0);
});
test("hardware failure is non-mutating and fails closed",()=>{
 const f=fixture();f.launcher.moduleState.online=false;
 assert.equal(f.hardware().ready,false);
 assert.deepEqual(f.scan().proofs,[]);
 assert.equal(f.getScanCalls(),0);
});
