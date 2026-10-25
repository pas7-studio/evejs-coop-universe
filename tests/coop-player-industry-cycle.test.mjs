import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makePlayerIndustryGuard}=require("../integration/coopPlayerIndustryGuard.cjs");
const {makePlayerIndustryFence}=require("../integration/coopPlayerIndustryFence.cjs");
const {makePlayerIndustryReceipts}=require("../integration/coopPlayerIndustryReceipts.cjs");
function memory(){
 const files=new Map(),handles=new Map();let fd=0;
 return {readFileSync:p=>{if(!files.has(p)){const e=Error("ENOENT");e.code="ENOENT";throw e}return files.get(p)},
  mkdirSync:()=>{},
  openSync:(p,mode)=>{if(mode==="wx"&&files.has(p))throw Error("EEXIST");
   if(mode==="wx"||mode==="a"&&!files.has(p))files.set(p,"");
   const n=++fd;handles.set(n,{p,mode});return n},
  writeSync:(n,buf,off=0,len=buf.length)=>{const h=handles.get(n),s=typeof buf==="string"?buf:buf.data;
   files.set(h.p,(h.mode==="a"?files.get(h.p):"")+s.slice(off,off+len));return len},
  fsyncSync:()=>{},closeSync:n=>handles.delete(n),unlinkSync:p=>files.delete(p)};
}
function setup(){
 const a={characterID:101,userid:201,corporationID:900,socket:{destroyed:false}};
 const b={characterID:102,userid:202,corporationID:900,socket:{destroyed:false}};
 const sessions=[a,b];const items=new Map([
  [500,{itemID:500,typeID:600,categoryID:9,ownerID:101,locationID:300,flagID:4,
   singleton:1,quantity:1}],
  [510,{itemID:510,typeID:34,categoryID:4,ownerID:102,locationID:300,flagID:4,
   singleton:0,quantity:12}]
 ]);
 const state={500:{jobID:null,original:true,materialEfficiency:0,timeEfficiency:0,runsRemaining:-1}};
 const jobs={};let wallet=200;
 const list=(owner,loc,flag)=>[...items.values()].filter(x=>
  x.ownerID===owner&&x.locationID===loc&&x.flagID===flag);
 const materials=()=>Object.fromEntries(list(101,300,4).filter(x=>x.categoryID!==9)
  .map(x=>[x.typeID,x.quantity]));
 const definition={maxProductionLimit:10,
  activities:{1:{products:[{typeID:710,quantity:1}]}}};
 const quote={activityID:1,ownerID:101,blueprint:{
  itemID:500,typeID:600,ownerID:101,locationID:300,flagID:4},
  definition,facility:{facilityID:300,online:true,activities:{1:{}}},
  inputLocation:{itemID:300,flagID:4,ownerID:101},
  outputLocation:{itemID:300,flagID:4,ownerID:101},account:[101,1000],
  materials:[{typeID:34,quantity:10}],runs:2,licensedRuns:10,
  timeInSeconds:3600,cost:50,tax:5,sccSurcharge:5,totalCost:60};
 const request={blueprintID:500,facilityID:300,runs:2,activityID:1};
 const getJobByID=id=>jobs[id]||null;
 const getState=id=>state[id]||null;
 const getItem=id=>items.get(id)||null;
 const receipt=makePlayerIndustryReceipts({getJobByID,getBlueprintState:getState,
  getInventoryItem:getItem,listContainerItems:list,getWalletBalance:()=>wallet,
  getBlueprintDefinitionByTypeID:()=>definition,
  getIndustryActivity:(d,act)=>d.activities[act]});
 const guard=makePlayerIndustryGuard({
  getSessions:()=>sessions,getCharacterRecord:id=>({accountId:id+100,corporationID:900}),
  getInventoryItem:getItem,getBlueprintByItemID:()=>quote.blueprint,
  getBlueprintState:getState,getJobByID,quoteIndustryJob:()=>({success:true,quote}),
  getAvailableMaterials:materials,hasCorporationIndustryJobAccess:()=>false,
  canTakeFromOwnerLocation:()=>false,canViewOwnerLocation:()=>false,
  canUseCorporationWallet:()=>false,getCharacterWallet:()=>({balance:wallet}),
  getCorporationWalletBalance:()=>0,getActivity:(d,act)=>d.activities[act],
  nowFiletime:()=>"133400000000000000"});
 const fence=makePlayerIndustryFence({file:"/var/lib/evejs/player-industry-test.jsonl",
  storage:memory(),clock:()=>1720000000000});
 const trade=(ownerFrom,ownerTo,type,qty)=>{
  const sender=list(ownerFrom,300,4).find(x=>x.typeID===type&&x.quantity>=qty);
  if(!sender)return {success:false};
  sender.quantity-=qty;if(sender.quantity===0)items.delete(sender.itemID);
  const receiver=list(ownerTo,300,4).find(x=>x.typeID===type);
  if(receiver)receiver.quantity+=qty;
  else items.set(type===34?511:712,{itemID:type===34?511:712,typeID:type,
   categoryID:4,ownerID:ownerTo,locationID:300,flagID:4,singleton:0,quantity:qty});
  return {success:true};
 };
 const installNative=()=>{
  items.get(511).quantity-=10;if(items.get(511).quantity===0)items.delete(511);
  wallet-=60;items.get(500).locationID=2003;
  state[500].jobID=700;
  jobs[700]={jobID:700,blueprintID:500,blueprintTypeID:600,
   blueprintLocationID:300,blueprintLocationFlagID:4,
   activityID:1,ownerID:101,installerID:101,facilityID:300,
   runs:2,totalCost:60,materials:{"34":10},status:1,endDate:"133399999000000000",
   pauseDate:null,completedCharacterID:0,
   outputLocationID:300,outputFlagID:4};
  return {success:true,data:{jobID:700}};
 };
 const deliverNative=()=>{
  jobs[700].status=101;jobs[700].completedCharacterID=101;
  items.set(711,{itemID:711,typeID:710,categoryID:6,ownerID:101,
   locationID:300,flagID:4,singleton:0,quantity:2});
  items.get(500).locationID=300;state[500].jobID=null;
  return {success:true,data:{jobID:700}};
 };
 return {a,b,guard,receipt,fence,trade,request,installNative,deliverNative,items,
  jobs,state,wallet:()=>wallet};
}
test("two native actors hand off real ore, pay and produce BPO product without cloning",()=>{
 const x=setup(),contract={fromOwnerID:102,toOwnerID:101,sourceLocationID:300,
  sourceFlagID:4,destinationLocationID:300,destinationFlagID:4,typeID:34,quantity:10};
 assert.equal(x.guard.checkInstall(x.a,x.request).reason,"NATIVE_MATERIAL_QUANTITY_MISMATCH");
 let before=x.receipt.captureHandoff(contract);
 assert.equal(x.receipt.verifyHandoff({before,nativeTransferResult:x.trade(102,101,34,10)}),true);
 const proof=x.guard.checkInstall(x.a,x.request);assert.equal(proof.ok,true);
 const install=x.fence.execute({proof,captureNative:p=>x.receipt.capture(p),
  nativeExecute:x.installNative,
  verifyNative:p=>x.receipt.verifyInstall(p)});
 assert.equal(install.status,"NATIVE_INDUSTRY_OPERATION_SETTLED");
 assert.equal(x.wallet(),140);
 x.jobs[700].status=3;
 const delivery=x.guard.checkDeliver(x.a,700);assert.equal(delivery.ok,true);
 const output=x.fence.execute({proof:delivery,captureNative:p=>x.receipt.capture(p),
  nativeExecute:x.deliverNative,
  verifyNative:p=>x.receipt.verifyDeliver(p)});
 assert.equal(output.status,"NATIVE_INDUSTRY_OPERATION_SETTLED");
 assert.equal(x.items.get(711).quantity,2);assert.equal(x.state[500].jobID,null);
 before=x.receipt.captureHandoff({...contract,fromOwnerID:101,toOwnerID:102,typeID:710,quantity:2});
 assert.equal(x.receipt.verifyHandoff({before,nativeTransferResult:x.trade(101,102,710,2)}),true);
 assert.equal(x.items.get(712).ownerID,102);
 assert.equal(x.fence.execute({proof:delivery,captureNative:p=>x.receipt.capture(p),
  nativeExecute:()=>{throw Error("must not call")},verifyNative:()=>true}).status,
  "NATIVE_DELIVERY_ALREADY_SETTLED");
});
