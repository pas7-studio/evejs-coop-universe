import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makePlayerIndustryReceipts}=require("../integration/coopPlayerIndustryReceipts.cjs");
const INSTALL={ok:true,kind:"INSTALL",characterID:101,ownerID:101,blueprintID:500,
 facilityID:300,inputLocationID:300,inputFlagID:4,outputLocationID:300,outputFlagID:4,
 activityID:1,runs:2,materials:[{typeID:34,quantity:10}],cost:60,account:[101,1000]};
const DELIVER={ok:true,kind:"DELIVER",characterID:101,ownerID:101,blueprintID:500,
 jobID:710,facilityID:300,outputLocationID:300,outputFlagID:4,activityID:1,runs:2,cost:60};
function fixture(){
 const items=new Map([
  [500,{itemID:500,typeID:600,categoryID:9,ownerID:101,locationID:300,flagID:4,
   singleton:1,quantity:1}],
  [502,{itemID:502,typeID:34,categoryID:4,ownerID:101,locationID:300,flagID:4,
   singleton:0,quantity:12}],
  [503,{itemID:503,typeID:710,categoryID:6,ownerID:101,locationID:300,flagID:4,
   singleton:0,quantity:3}]
 ]);
 const states={500:{jobID:null,original:true,materialEfficiency:2,timeEfficiency:4}};
 const jobs={710:{jobID:710,blueprintID:500,blueprintTypeID:600,ownerID:101,
  installerID:101,facilityID:300,activityID:1,runs:2,totalCost:60,
  blueprintLocationID:300,blueprintLocationFlagID:4,
  materials:{"34":10},status:1,completedCharacterID:0,licensedRuns:10}};
 let wallet=200;
 const activity={1:{products:[{typeID:710,quantity:2}]},5:{products:[]}};
 const receipts=makePlayerIndustryReceipts({
  getJobByID:id=>jobs[id],getBlueprintState:id=>states[id]||null,
  getInventoryItem:id=>items.get(id)||null,
  listContainerItems:(owner,loc,flag)=>[...items.values()].filter(i=>
   i.ownerID===owner&&i.locationID===loc&&i.flagID===flag),
  getWalletBalance:()=>wallet,
  getBlueprintDefinitionByTypeID:()=>({activities:activity}),
  getIndustryActivity:(definition,id)=>definition.activities[id]
 });
 const installed=()=>{items.get(502).quantity=2;items.get(500).locationID=2003;
  wallet=140;states[500].jobID=710};
 const ready=()=>{jobs[710].status=3;items.get(500).locationID=2003;states[500].jobID=710};
 const delivered=()=>{jobs[710].status=101;jobs[710].completedCharacterID=101;
  states[500].jobID=null;items.get(500).locationID=300};
 return {items,states,jobs,receipts,installed,ready,delivered,
  wallet:()=>wallet,setWallet:v=>{wallet=v}};
}
test("install confirms exact ISK and mineral spend with real blueprint job lock",()=>{
 const x=fixture(),before=x.receipts.capture(INSTALL);x.installed();
 assert.equal(x.receipts.verifyInstall({proof:INSTALL,nativeResult:{success:true,data:{jobID:710}},before}),true);
});
test("reported install success without physical ore debit is not accepted",()=>{
 const x=fixture(),before=x.receipts.capture(INSTALL);
 x.items.get(500).locationID=2003;x.states[500].jobID=710;x.setWallet(140);
 assert.equal(x.receipts.verifyInstall({proof:INSTALL,nativeResult:{success:true,data:{jobID:710}},before}),false);
});
test("reported install success without wallet fee is not accepted",()=>{
 const x=fixture(),before=x.receipts.capture(INSTALL);
 x.installed();x.setWallet(200);
 assert.equal(x.receipts.verifyInstall({proof:INSTALL,nativeResult:{success:true,data:{jobID:710}},before}),false);
});
test("manufacturing delivery requires exact physical output and native DELIVERED status",()=>{
 const x=fixture();x.ready();const before=x.receipts.capture(DELIVER);
 x.items.get(503).quantity+=4;x.delivered();
 assert.equal(x.receipts.verifyDeliver({proof:DELIVER,nativeResult:{success:true},before}),true);
});
test("phantom delivery, missing output and double quantity fail closed",()=>{
 const x=fixture();x.ready();const before=x.receipts.capture(DELIVER);
 x.delivered();
 assert.equal(x.receipts.verifyDeliver({proof:DELIVER,nativeResult:{success:true},before}),false);
 x.items.get(503).quantity+=8;
 assert.equal(x.receipts.verifyDeliver({proof:DELIVER,nativeResult:{success:true},before}),false);
});
test("copying requires two native BPC itemIDs, original=false and licensed runs",()=>{
 const x=fixture();x.ready();x.jobs[710].activityID=5;
 const proof={...DELIVER,activityID:5};const before=x.receipts.capture(proof);
 for(const itemID of [510,511]){
  x.items.set(itemID,{itemID,typeID:600,categoryID:9,ownerID:101,
   locationID:300,flagID:4,singleton:1,quantity:1});
  x.states[itemID]={original:false,runsRemaining:10,materialEfficiency:2,timeEfficiency:4};
 }
 x.delivered();
 assert.equal(x.receipts.verifyDeliver({proof,nativeResult:{success:true},before}),true);
 x.states[511].original=true;
 assert.equal(x.receipts.verifyDeliver({proof,nativeResult:{success:true},before}),false);
});
test("ME research changes the real BPO's level and returns the BPO",()=>{
 const x=fixture();x.ready();x.jobs[710].activityID=4;
 const proof={...DELIVER,activityID:4};const before=x.receipts.capture(proof);
 x.delivered();x.states[500].materialEfficiency=4;
 assert.equal(x.receipts.verifyDeliver({proof,nativeResult:{success:true},before}),true);
});
test("TE research rejects missing efficiency increment",()=>{
 const x=fixture();x.ready();x.jobs[710].activityID=3;
 const proof={...DELIVER,activityID:3};const before=x.receipts.capture(proof);
 x.delivered();
 assert.equal(x.receipts.verifyDeliver({proof,nativeResult:{success:true},before}),false);
 x.states[500].timeEfficiency=8;
 assert.equal(x.receipts.verifyDeliver({proof,nativeResult:{success:true},before}),true);
});

test("two characters transfer exactly one native mineral quantity without cloning",()=>{
 const x=fixture();
 x.items.set(550,{itemID:550,typeID:34,categoryID:4,ownerID:102,
  locationID:300,flagID:4,singleton:0,quantity:5});
 const contract={fromOwnerID:101,toOwnerID:102,sourceLocationID:300,sourceFlagID:4,
  destinationLocationID:300,destinationFlagID:4,typeID:34,quantity:7};
 const before=x.receipts.captureHandoff(contract);
 x.items.get(502).quantity-=7;x.items.get(550).quantity+=7;
 assert.equal(x.receipts.verifyHandoff({before,nativeTransferResult:{success:true}}),true);
 assert.equal(x.receipts.verifyHandoff({before,nativeTransferResult:{success:false}}),false);
});
test("fake player transfer with missing debit fails inventory conservation",()=>{
 const x=fixture();
 x.items.set(550,{itemID:550,typeID:34,categoryID:4,ownerID:102,
  locationID:300,flagID:4,singleton:0,quantity:5});
 const before=x.receipts.captureHandoff({fromOwnerID:101,toOwnerID:102,
  sourceLocationID:300,sourceFlagID:4,destinationLocationID:300,
  destinationFlagID:4,typeID:34,quantity:7});
 x.items.get(550).quantity+=7;
 assert.equal(x.receipts.verifyHandoff({before,nativeTransferResult:{success:true}}),false);
});
