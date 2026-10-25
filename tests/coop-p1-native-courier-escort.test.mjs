import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOperations}=require("../integration/coopFleetOperations.cjs");
function setup(){
 const systemID=30000144,station=60000001;
 const charA={characterID:101,_space:{shipID:9001,systemID,initialStateSent:true}};
 const charB={characterID:102,_space:{shipID:9002,systemID,initialStateSent:true}};
 const charC={characterID:103,_space:{shipID:9003,systemID,initialStateSent:true}};
 const ships=new Map([[9001,{itemID:9001,kind:"ship"}],[9002,{itemID:9002,kind:"ship"}],
  [9003,{itemID:9003,kind:"ship"}]]);
 const scene={systemID,sessions:new Map([[1,charA],[2,charB],[3,charC]]),
  getEntityByID:id=>ships.get(id)||null};
 const fleet={fleetID:777,members:new Map([[101,{job:2,role:1}],
  [102,{job:0,role:4}],[103,{job:0,role:4}]])};
 const tags=new Map(),notices=[];
 const native={FLEET:{FLEET_JOB_CREATOR:2,FLEET_CMDR_ROLES:[1,2,3]},
  getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(f,id)=>f.members.get(id)||null,
  setFleetTargetTag:(session,itemID,tag)=>{
   if(session!==charA||tags.get(itemID)===tag)return false;
   tags.set(itemID,tag);return true;
  },
  getTargetTagForCharacter:(_,itemID)=>tags.get(itemID)||null
 };
 const contracts=[{contractID:980000008,type:3,status:1,forCorp:false,
  issuerID:101,acceptorID:102,plasticWrapItemID:5555,
  startStationID:station,endStationID:60000022,reward:99000,collateral:10000}];
 const wrap={itemID:5555,typeID:3468,ownerID:102,locationID:9002,flagID:5};
 const allowed=session=>contracts.filter(c=>
  c.issuerID===session.characterID||c.acceptorID===session.characterID);
 const ops=createOperations({getScene:()=>scene,getFleets:()=>native,
  getMiningFleets:()=>[],getCargo:()=>[],getWreck:()=>null,
  getContracts:allowed,getItem:()=>wrap,
  send:(session,message)=>notices.push([session.characterID,message])});
 return {ops,charA,charB,charC,wrap,scene,fleet,tags,contracts,notices};
}
test("real accepted courier contract belongs only to its issuer or acceptor",()=>{
 const f=setup();
 assert.equal(f.ops.execute(f.charA,"deliveries").status,"NATIVE_COURIER_CONTRACTS");
 assert.equal(f.ops.execute(f.charB,"deliveries").status,"NATIVE_COURIER_CONTRACTS");
 assert.match(f.ops.execute(f.charA,"deliveries").message,/reward=99000 ISK/);
 assert.equal(f.ops.execute(f.charC,"deliveries").status,"NO_NATIVE_COURIER_CONTRACTS");
});
test("actual plastic wrap aboard native fleet ship is required to coordinate escort",()=>{
 const f=setup();
 assert.equal(f.ops.execute(f.charA,"escort 980000008").status,"NATIVE_COURIER_ESCORT_TAGGED");
 assert.equal(f.tags.get(9002),"3");
 assert.equal(f.notices.length,2,"other real crew members see native escort target");
 assert.equal(f.ops.execute(f.charA,"escort 980000008").status,
  "NATIVE_COURIER_ESCORT_ALREADY_TAGGED");
 assert.equal(f.notices.length,2,"no duplicate notification on idempotent native tagging");
 assert.equal(f.contracts[0].reward,99000,"operation did not pay, debit or mutate contract");
});
test("no ghost courier tag when the package is docked, fake, in drone bay or wrong owner",()=>{
 const f=setup();
 for(const update of [
  {locationID:60000001},{typeID:12345},{flagID:87},{ownerID:101},
  {itemID:5556}
 ]){
  const original={...f.wrap};Object.assign(f.wrap,update);
  assert.equal(f.ops.execute(f.charA,"escort 980000008").status,
   "NATIVE_COURIER_PACKAGE_NOT_LOADED");
  Object.assign(f.wrap,original);
 }
 assert.equal(f.tags.size,0);
});
test("unaccepted, foreign/corp, missing issuer, outsider and noncommander are denied",()=>{
 const f=setup();
 assert.equal(f.ops.execute(f.charC,"escort 980000008").status,
  "NOT_AN_ACCEPTED_NATIVE_CONTRACT");
 assert.equal(f.ops.execute(f.charB,"escort 980000008").status,
  "NATIVE_COMMAND_PERMISSION_DENIED");
 f.contracts[0].status=0;
 assert.equal(f.ops.execute(f.charA,"escort 980000008").status,
  "NOT_AN_ACCEPTED_NATIVE_CONTRACT");
 f.contracts[0].status=1;f.contracts[0].forCorp=true;
 assert.equal(f.ops.execute(f.charA,"escort 980000008").status,
  "NOT_AN_ACCEPTED_NATIVE_CONTRACT");
 f.contracts[0].forCorp=false;f.fleet.members.delete(101);
 assert.equal(f.ops.execute(f.charB,"escort 980000008").status,
  "CONTRACT_PARTIES_NOT_IN_NATIVE_FLEET");
 assert.equal(f.tags.size,0);
});
test("escort cannot forge a reward or reuse a different native contract's package",()=>{
 const f=setup();
 f.contracts[0].plasticWrapItemID=8888;
 assert.equal(f.ops.execute(f.charA,"escort 980000008").status,
  "NATIVE_COURIER_PACKAGE_NOT_LOADED");
 assert.equal(f.tags.size,0);
});
