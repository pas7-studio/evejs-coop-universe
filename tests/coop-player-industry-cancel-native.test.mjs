import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makePlayerIndustryGuard}=require("../integration/coopPlayerIndustryGuard.cjs");
const {makePlayerIndustryReceipts}=require("../integration/coopPlayerIndustryReceipts.cjs");

function setup(){
 const session={characterID:101,userid:201,corporationID:900,socket:{destroyed:false}};
 const job={jobID:700,ownerID:101,installerID:101,blueprintID:500,
  blueprintLocationID:300,blueprintLocationFlagID:4,
  facilityID:300,activityID:1,status:3,completedCharacterID:0};
 const item={itemID:500,ownerID:101,locationID:2003,flagID:4,categoryID:9};
 const state={jobID:700,original:true};
 const deps={getSessions:()=>[session],
  getCharacterRecord:()=>({accountId:201,corporationID:900}),
  getInventoryItem:()=>item,getBlueprintByItemID:()=>item,getBlueprintState:()=>state,
  getJobByID:()=>job,quoteIndustryJob:()=>({success:false}),getAvailableMaterials:()=>({}),
  hasCorporationIndustryJobAccess:()=>false,canTakeFromOwnerLocation:()=>false,
  canViewOwnerLocation:()=>false,canUseCorporationWallet:()=>false,
  getCharacterWallet:()=>({balance:100}),getCorporationWalletBalance:()=>0,
  getActivity:()=>null,nowFiletime:()=>"133400000000000000",
  listContainerItems:()=>[],getWalletBalance:()=>100,
  getBlueprintDefinitionByTypeID:()=>null,getIndustryActivity:()=>null};
 return {session,job,item,state,
  guard:makePlayerIndustryGuard(deps),receipts:makePlayerIndustryReceipts(deps)};
}
test("original active native job may cancel only with original installed BPO",()=>{
 const x=setup(),proof=x.guard.checkCancel(x.session,700);
 assert.equal(proof.ok,true);assert.equal(proof.kind,"CANCEL");
 assert.equal(proof.ownerID,101);assert.equal(proof.blueprintID,500);
 x.item.locationID=300;
 assert.equal(x.guard.checkCancel(x.session,700).reason,"NATIVE_CANCEL_BLUEPRINT_NOT_INSTALLED");
});
test("cancel cannot be replayed against already cancelled or delivered job",()=>{
 const x=setup();
 for(const status of [101,102,103]){
  x.job.status=status;
  assert.equal(x.guard.checkCancel(x.session,700).reason,"NATIVE_CANCEL_JOB_NOT_ACTIVE");
 }
});
test("cancel rejects colleague personal job and mismatched native account",()=>{
 const x=setup();
 const colleague={...x.session,characterID:102,userid:202};
 assert.notEqual(x.guard.checkCancel(colleague,700).ok,true);
 x.session.userid=202;
 assert.equal(x.guard.checkCancel(x.session,700).reason,"NATIVE_INDUSTRY_ACCOUNT_MISMATCH");
});
test("native cancelled job, actor and returned blueprint are receipt-verified",()=>{
 const x=setup(),proof=x.guard.checkCancel(x.session,700),before=x.receipts.capture(proof);
 x.job.status=102;x.job.completedCharacterID=101;
 x.item.locationID=300;x.state.jobID=null;
 const nativeResult={success:true,data:{jobID:700}};
 assert.equal(x.receipts.verifyCancel({proof,nativeResult,before}),true);
 x.item.locationID=301;
 assert.equal(x.receipts.verifyCancel({proof,nativeResult,before}),false);
});
test("wrong cancel actor, missing native ACK and false terminal status fail closed",()=>{
 const x=setup(),proof=x.guard.checkCancel(x.session,700),before=x.receipts.capture(proof);
 x.job.status=102;x.job.completedCharacterID=102;
 x.item.locationID=300;x.state.jobID=null;
 assert.equal(x.receipts.verifyCancel({proof,nativeResult:{success:true,data:{jobID:700}},before}),false);
 x.job.completedCharacterID=101;
 assert.equal(x.receipts.verifyCancel({proof,nativeResult:{success:false},before}),false);
 assert.equal(x.receipts.verifyCancel({proof,nativeResult:{success:true,data:{jobID:701}},before}),false);
});
