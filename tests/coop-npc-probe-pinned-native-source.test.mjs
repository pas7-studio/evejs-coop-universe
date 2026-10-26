import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcProbeScanEvidence}=require("../integration/coopNpcProbeScanEvidence.cjs");
const {createExpeditionDirector}=require("../integration/coopNpcExpeditionDirector.cjs");

const scanPath=process.env.EVEJS_PINNED_PROBE_SCAN_SOURCE;
const scenePath=process.env.EVEJS_PINNED_PROBE_SCENE_SOURCE;
const requirePinned=Boolean(scanPath&&scenePath);
const site={siteID:250,itemID:250,solarSystemID:30000142,
 targetID:"ABC-123",siteKind:"signature",family:"relic",
 typeID:900,actualPosition:{x:1e9,y:2e9,z:3e9},position:[1e9,2e9,3e9]};

function pinnedModules(){
 const vector=x=>({type:"list",items:x.map(value=>({type:"real",value}))});
 const helpers={
  buildDict:entries=>({type:"dict",entries}),
  buildFiletimeLong:x=>x,
  buildKeyVal:entries=>({type:"object",name:"util.KeyVal",args:{type:"dict",entries}}),
  buildMarshalRealVectorList:vector,
  buildMarshalReal:value=>({type:"real",value}),
  currentFileTime:()=>123n,
  normalizeBigInt:x=>BigInt(x),unwrapMarshalValue:x=>x,
  normalizeNumber:(x,fallback=0)=>Number.isFinite(Number(x))?Number(x):fallback
 };
 const range={resolveProbeRangeContract:(_type,step)=>({rangeStep:step,scanRange:1e10}),
  clampVectorToProbeBounds:x=>x};
 const authority={
  getScanContracts:()=>({probeScanGroups:{signatures:3}}),
  getSignatureTypeDefinition:()=>({inventoryGroupID:502}),
  getScanStrengthAttribute:()=>1908};
 const itemType={resolveItemByTypeID:()=>({groupID:479,categoryID:8,
  name:"Core Scanner Probe",mass:1,radius:10,graphicID:100})};
 const shim=(requested)=>{
  if(requested==="path")return {join:(...parts)=>parts.join("/")};
  if(requested.includes("serviceHelpers"))return helpers;
  if(requested.includes("explorationAuthority"))return authority;
  if(requested.includes("signatureRuntime"))return{listSystemSignatureSites:()=>[site]};
  if(requested.includes("probeRuntimeState"))return range;
  if(requested.includes("itemTypeRegistry"))return itemType;
  if(requested.includes("space/runtime"))return{ensureScene:()=>null,removeDynamicEntity:()=>null};
  throw Error("UNEXPECTED_NATIVE_DEPENDENCY: "+requested);
 };
 function load(fullPath){
  const mod={exports:{}};
  const source=fs.readFileSync(fullPath,"utf8");
  vm.runInNewContext("(function(require,module,exports,__dirname) {\n"+
   source+"\n})",{Number,BigInt,Math,Date,Map,Set,Array,Object,JSON,console},
   {filename:fullPath})(shim,mod,mod.exports,"/pinned-native");
  return mod.exports;
 }
 return{scan:load(scanPath),scene:load(scenePath),range};
}
test("pinned original scanner and physical probe entity can generate one real certainty=1 NPC proof",
 {skip:!requirePinned},()=>{
 const native=pinnedModules();
 const entityID=980000000011,ownerID=901,corpID=700,
  systemID=30000142,moduleID=980100000101;
 const rows=[1,2,3,4].map(i=>{
  const cargoID=980200000000+i;
  const position={x:1e9+i*1000,y:2e9,z:3e9};
  return {cargoID,entityID,ownerID,moduleID,typeID:3001,
   groupID:479,categoryID:8,quantity:0,singleton:false,
   deployedProbe:{status:"IN_SPACE",probeID:cargoID,entityID,ownerID,
    systemID,typeID:3001,launchedAtMs:995000,rangeStep:4,
    scanRange:1e10,position}};
 });
 const sceneObjects=new Map();
 sceneObjects.set(entityID,{itemID:entityID,kind:"ship",nativeNpc:true,
  systemID,ownerID,corporationID:corpID,position:{x:0,y:0,z:0}});
 for(const row of rows){
  const p=row.deployedProbe,physical=native.scene.buildProbeSceneEntity({
   probeID:p.probeID,typeID:p.typeID,
   pos:[p.position.x,p.position.y,p.position.z],
   destination:[p.position.x,p.position.y,p.position.z],
   scanRange:p.scanRange,rangeStep:p.rangeStep,state:1},
   {ownerID,systemID});
  assert.equal(physical.kind,"probe");
  assert.equal(physical.itemID,row.cargoID);
  physical.nativeNpcProbe=true;
  physical.nativeNpcCargoID=row.cargoID;
  sceneObjects.set(row.cargoID,physical);
 }
 const actualResults=native.scan.buildSignatureScanResults(systemID,new Map(rows.map(row=>{
  const p=row.deployedProbe;
  return [row.cargoID,{probeID:row.cargoID,typeID:row.typeID,
   pos:[p.position.x,p.position.y,p.position.z],
   destination:[p.position.x,p.position.y,p.position.z],
   scanRange:p.scanRange,rangeStep:p.rangeStep,state:1}];
 })));
 assert.equal(actualResults.results.length,1);
 const certainty=Object.fromEntries(actualResults.results[0].args.entries).certainty;
 assert.equal(certainty,1);
 const evidence=createNpcProbeScanEvidence({
  getNativeEntity:()=>({entityID,systemID,ownerID,corporationID:corpID}),
  getController:()=>({entityID,systemID}),
  listNativeModulesForEntity:()=>[{moduleID,entityID,ownerID,
   typeID:1001,groupID:481,categoryID:7,moduleState:{online:true}}],
  listNativeCargoForEntity:()=>rows,
  getCompatibleProbeChargeTypeIDs:()=>[3001],
  resolveProbeRangeContract:native.range.resolveProbeRangeContract,
  scanNativeResults:(_sid,probes)=>native.scan.buildSignatureScanResults(systemID,probes),
  listNativeSites:()=>[site],clock:()=>1000000
 });
 const result=evidence.scan({scene:{systemID,getEntityByID:id=>sceneObjects.get(id)},
  entityID,assignments:[{pilotID:"coop-pilot-310",entityID,systemID}]});
 assert.equal(result.status,"NATIVE_PROBE_SCANNED");
 assert.equal(result.probeCount,4);
 assert.equal(result.proofs.length,1);
 assert.equal(result.proofs[0].nativeScanCertainty,1);
 assert.equal(result.proofs[0].siteID,250);
});

test("EX-03B11 pinned native certainty 1 flows from real original probes to scout-first warp and witnessed follower",
 {skip:!requirePinned},()=>{
 const pinned=pinnedModules();
 const systemID=30000142,ownerID=901,corporationID=700;
 const scoutID=980000000021,patrolID=980000000022,moduleID=980100000221;
 const rows=Array.from({length:4},(_,i)=>{
  const cargoID=980200000021+i;
  const position={x:site.actualPosition.x+(i+1)*1000,
   y:site.actualPosition.y,z:site.actualPosition.z};
  return {cargoID,entityID:scoutID,ownerID,moduleID,typeID:3001,
   groupID:479,categoryID:8,quantity:0,singleton:false,
   deployedProbe:{status:"IN_SPACE",probeID:cargoID,entityID:scoutID,
    ownerID,systemID,typeID:3001,launchedAtMs:995000,
    rangeStep:4,scanRange:1e10,position}};
 });
 const entities=new Map([
  [scoutID,{itemID:scoutID,kind:"ship",nativeNpc:true,
   ownerID,corporationID,systemID,position:{x:0,y:0,z:0}}],
  [patrolID,{itemID:patrolID,kind:"ship",nativeNpc:true,
   ownerID,corporationID,systemID,position:{x:1000000,y:0,z:0}}]
 ]);
 for(const row of rows){
  const p=row.deployedProbe;
  const probe=pinned.scene.buildProbeSceneEntity({
   probeID:p.probeID,typeID:row.typeID,
   pos:[p.position.x,p.position.y,p.position.z],
   destination:[p.position.x,p.position.y,p.position.z],
   scanRange:p.scanRange,rangeStep:p.rangeStep,state:1
  },{ownerID,systemID});
  assert.equal(probe.itemID,row.cargoID);
  probe.nativeNpcProbe=true;probe.nativeNpcCargoID=row.cargoID;
  entities.set(row.cargoID,probe);
 }
 const native=new Map([
  [scoutID,{entityID:scoutID,ownerID,corporationID,systemID}],
  [patrolID,{entityID:patrolID,ownerID,corporationID,systemID}]
 ]);
 const controllers=new Map([...native.keys()].map(entityID=>
  [entityID,{entityID,systemID}]));
 const scene={systemID,getEntityByID:id=>entities.get(id),sessions:new Map()};
 const assignments=[
  {entityID:scoutID,pilotID:"coop-pilot-321",systemID},
  {entityID:patrolID,pilotID:"coop-pilot-322",systemID}
 ];
 const roles={"coop-pilot-321":"patrol","coop-pilot-322":"patrol"};
 const evidence=createNpcProbeScanEvidence({
  getNativeEntity:id=>native.get(id),getController:id=>controllers.get(id),
  listNativeModulesForEntity:id=>id===scoutID?[{
   entityID:scoutID,moduleID,ownerID,typeID:1001,
   groupID:481,categoryID:7,moduleState:{online:true}
  }]:[],
  listNativeCargoForEntity:id=>id===scoutID?rows:[],
  getCompatibleProbeChargeTypeIDs:()=>[3001],
  resolveProbeRangeContract:pinned.range.resolveProbeRangeContract,
  scanNativeResults:(sid,probes)=>pinned.scan.buildSignatureScanResults(sid,probes),
  listNativeSites:()=>[site],clock:()=>1000000
 });
 const warps=[],orders=[];
 const director=createExpeditionDirector({
  listNativeSites:()=>[site],getNativeEntity:id=>native.get(id),
  getController:id=>controllers.get(id),
  isNativeProbeScout:id=>id===scoutID,
  nativeProbeScan:args=>evidence.scan(args),
  orderBridge:{blocked:()=>false,issue:order=>{
   orders.push({entityID:order.entityID,action:order.action});
   return order.execute();
  }},
  warpToPoint:(id,point)=>{
   warps.push({id,point});
   return {success:true};
  },clock:()=>1000000
 });
 const first=director.tick({scene,assignments,roles});
 assert.equal(first.remoteScans,1,"pinned engine certainty=1 must admit physical NPC proof");
 assert.equal(first.scoutWarpOrders,1);
 assert.equal(first.patrolWarpOrders,0);
 assert.equal(first.scoutOnGridVerified,0);
 assert.deepEqual(orders,[{entityID:scoutID,action:"expedition-scout-rendezvous"}]);
 assert.deepEqual(warps,[{id:scoutID,point:site.actualPosition}]);
 const inTransit=director.tick({scene,assignments,roles});
 assert.equal(inTransit.orders,0,"no premature patrol warp before scout is on grid");
 entities.get(scoutID).position={...site.actualPosition};
 assert.equal(director.tick({scene,assignments,roles}).orders,0,
  "an unmaterialized catalog-only site cannot verify scout arrival");
 entities.set(site.siteID,{itemID:site.siteID,kind:"signature",
  position:{...site.actualPosition}});
 const arrived=director.tick({scene,assignments,roles});
 assert.equal(arrived.scoutOnGridVerified,1);
 assert.equal(arrived.scoutWarpOrders,0);
 assert.equal(arrived.patrolWarpOrders,1);
 assert.deepEqual(orders[1],
  {entityID:patrolID,action:"expedition-rendezvous"});
 assert.deepEqual(warps[1],{id:patrolID,point:site.actualPosition});
 assert.equal(director.tick({scene,assignments,roles}).orders,0,
  "same original site cannot cause a repeated native patrol warp");
});
