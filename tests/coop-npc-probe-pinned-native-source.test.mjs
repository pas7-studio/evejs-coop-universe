import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcProbeScanEvidence}=require("../integration/coopNpcProbeScanEvidence.cjs");

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
