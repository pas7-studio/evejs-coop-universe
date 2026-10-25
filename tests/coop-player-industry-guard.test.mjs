import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makePlayerIndustryGuard,ACT}=require("../integration/coopPlayerIndustryGuard.cjs");
function fixture(){
 const s1={characterID:101,userid:201,corporationID:901,socket:{destroyed:false}};
 const s2={characterID:102,userid:202,corporationID:901,socket:{destroyed:false}};
 const sessions=[s1,s2];const characters={
  101:{accountId:201,corporationID:901},102:{accountId:202,corporationID:901}};
 const inventory={500:{itemID:500,typeID:600,categoryID:9,ownerID:101,locationID:300,flagID:4}};
 const blueprints={500:{itemID:500,typeID:600,ownerID:101,locationID:300,flagID:4}};
 const bpStates={500:{itemID:500,jobID:null,original:true,runsRemaining:-1,materialEfficiency:2,timeEfficiency:4}};
 const definition={maxProductionLimit:20,productTypeID:710,
  activities:{[ACT.MANUFACTURING]:{products:[{typeID:710,quantity:2}]} }};
 const quote={activityID:1,ownerID:101,blueprint:blueprints[500],facility:{
  facilityID:300,online:true,activities:{1:{},3:{},4:{},5:{},9:{}}},
  inputLocation:{itemID:300,ownerID:101,flagID:4},
  outputLocation:{itemID:300,ownerID:101,flagID:4},
  account:[101,1000],runs:2,licensedRuns:10,definition,materials:[{typeID:34,quantity:10}],
  cost:50,tax:5,sccSurcharge:5,totalCost:60,timeInSeconds:3600};
 const request={blueprintID:500,activityID:1,facilityID:300,runs:2};
 const available={34:10},wallets={101:200,102:100,901:1000};
 const jobs={700:{jobID:700,ownerID:101,installerID:101,blueprintID:500,
   facilityID:300,status:3,activityID:1,endDate:"133399999000000000",
   pauseDate:null,runs:2,totalCost:60,outputLocationID:300,outputFlagID:4,
   materials:{"34":10}}};
 let corpFactory=false,corpTake=false,corpView=false,corpWallet=false;
 const native=makePlayerIndustryGuard({
  getSessions:()=>sessions,getCharacterRecord:id=>characters[id],
  getInventoryItem:id=>inventory[id],
  getBlueprintByItemID:id=>blueprints[id],
  getBlueprintState:id=>bpStates[id],
  getJobByID:id=>jobs[id],
  quoteIndustryJob:()=>({success:true,quote}),
  getAvailableMaterials:()=>available,
  hasCorporationIndustryJobAccess:()=>corpFactory,
  canTakeFromOwnerLocation:()=>corpTake,
  canViewOwnerLocation:()=>corpView,
  canUseCorporationWallet:()=>corpWallet,
  getCharacterWallet:id=>({balance:wallets[id]}),
  getCorporationWalletBalance:id=>wallets[id],
  getActivity:(def,activityID)=>def.activities[activityID],
  nowFiletime:()=>"133400000000000000"
 });
 return {s1,s2,sessions,characters,inventory,blueprints,bpStates,definition,
  quote,request,available,wallets,jobs,native,
  corporate(on=true){corpFactory=on;corpTake=on;corpView=on;corpWallet=on},
  walletPermission(on){corpWallet=on},takePermission(on){corpTake=on},
  viewPermission(on){corpView=on},factoryPermission(on){corpFactory=on}};
}
test("native paid BPO manufacturing quote accepted with exact material ownership",()=>{
 const x=fixture();const r=x.native.checkInstall(x.s1,x.request);
 assert.equal(r.ok,true);assert.equal(r.cost,60);assert.equal(r.materials[0].quantity,10);
});
test("two characters do not inherit personal blueprint permission",()=>{
 const x=fixture();
 assert.equal(x.native.checkInstall(x.s2,x.request).reason,"FOREIGN_INDUSTRY_OWNER");
 x.s1.userid=202;assert.equal(x.native.checkInstall(x.s1,x.request).reason,
  "NATIVE_INDUSTRY_ACCOUNT_MISMATCH");
});
test("session replacement, duplicate connected character and disconnect rejected",()=>{
 const x=fixture();x.sessions.push({...x.s1});
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"DUPLICATE_OR_STALE_NATIVE_SESSION");
 x.sessions.pop();x.s1.socket.destroyed=true;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"INVALID_NATIVE_INDUSTRY_SESSION");
});
test("reject quote tampering, wrong blueprint id and foreign inventory custody",()=>{
 const x=fixture();x.request.runs=3;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_QUOTE_IDENTITY_MISMATCH");
 x.request.runs=2;x.inventory[500].ownerID=102;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_BLUEPRINT_CUSTODY_MISMATCH");
});
test("prevent free output and missing real ore",()=>{
 const x=fixture();x.quote.totalCost=0;x.quote.cost=0;x.quote.tax=0;x.quote.sccSurcharge=0;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"UNFUNDED_NATIVE_PRODUCT_QUOTE");
 x.quote.totalCost=60;x.quote.cost=50;x.quote.tax=5;x.quote.sccSurcharge=5;
 x.available[34]=0;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_MATERIAL_QUANTITY_MISMATCH");
});
test("BPC manufacturing uses actual runs, BPC research/copy prohibited",()=>{
 const x=fixture();x.bpStates[500].original=false;x.bpStates[500].runsRemaining=1;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"BPC_INSUFFICIENT_LICENSED_RUNS");
 x.bpStates[500].runsRemaining=10;
 assert.equal(x.native.checkInstall(x.s1,x.request).ok,true);
 x.quote.activityID=5;x.request.activityID=5;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"BPC_NOT_VALID_FOR_THIS_NATIVE_ACTIVITY");
});
test("invention is not silently treated as supported reaction",()=>{
 const x=fixture();x.request.activityID=8;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_INVENTION_NOT_IMPLEMENTED");
});
test("unfunded owner wallet and blocked blueprint job prevent installation",()=>{
 const x=fixture();x.wallets[101]=0;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_INDUSTRY_FUNDS_INSUFFICIENT");
 x.wallets[101]=200;x.bpStates[500].jobID=700;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"BLUEPRINT_ALREADY_INSTALLED");
});
test("corp owner requires factory, hangar-take and wallet division roles",()=>{
 const x=fixture();
 x.inventory[500].ownerID=901;x.blueprints[500].ownerID=901;
 x.quote.ownerID=901;x.quote.account=[901,1000];
 x.quote.inputLocation.ownerID=901;x.quote.outputLocation.ownerID=901;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"CORPORATION_FACTORY_ROLE_REQUIRED");
 x.corporate();
 assert.equal(x.native.checkInstall(x.s1,x.request).ok,true);
 assert.equal(x.native.checkInstall(x.s2,x.request).ok,true);
});
test("native copied BPO research activity is valid and never mints direct products",()=>{
 const x=fixture();x.request.activityID=4;x.quote.activityID=4;
 x.quote.materials=[];x.quote.cost=10;x.quote.tax=0;x.quote.sccSurcharge=0;x.quote.totalCost=10;
 assert.equal(x.native.checkInstall(x.s1,x.request).ok,true);
});
test("native READY job requires paid receipt and actual installed blueprint",()=>{
 const x=fixture();x.bpStates[500].jobID=700;
 x.inventory[500].locationID=2003;
 assert.equal(x.native.checkDeliver(x.s1,700).ok,true);
 x.jobs[700].totalCost=0;
 assert.equal(x.native.checkDeliver(x.s1,700).reason,"NATIVE_PAID_JOB_EVIDENCE_MISSING");
});
test("READY cannot be claimed before FILETIME and cannot be delivered twice",()=>{
 const x=fixture();x.bpStates[500].jobID=700;x.inventory[500].locationID=2003;
 x.jobs[700].endDate="133500000000000000";
 assert.equal(x.native.checkDeliver(x.s1,700).reason,"NATIVE_JOB_TIME_NOT_ELAPSED");
 x.jobs[700].endDate="133399999000000000";
 x.jobs[700].status=101;
 assert.equal(x.native.checkDeliver(x.s1,700).reason,"NATIVE_INDUSTRY_JOB_NOT_READY");
});
test("corporation delivery may be claimed only by authorized colleague",()=>{
 const x=fixture();x.bpStates[500].jobID=700;x.inventory[500].locationID=2003;
 x.inventory[500].ownerID=901;x.blueprints[500].ownerID=901;x.jobs[700].ownerID=901;
 assert.equal(x.native.checkDeliver(x.s2,700).reason,"CORPORATION_FACTORY_ROLE_REQUIRED");
 x.corporate();
 assert.equal(x.native.checkDeliver(x.s2,700).ok,true);
});
test("delivery requires genuine BPO / installed custody and BPC limits",()=>{
 const x=fixture();x.bpStates[500].jobID=700;
 assert.equal(x.native.checkDeliver(x.s1,700).reason,
  "NATIVE_INSTALLED_BLUEPRINT_CUSTODY_MISMATCH");
 x.inventory[500].locationID=2003;
 x.bpStates[500].original=false;x.bpStates[500].runsRemaining=1;
 assert.equal(x.native.checkDeliver(x.s1,700).reason,"NATIVE_DELIVERY_BPC_RUNS_EXCEEDED");
});
test("invalid facility, time and material recipe are rejected before side effects",()=>{
 const x=fixture();x.quote.facility.online=false;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_FACILITY_ACTIVITY_UNAVAILABLE");
 x.quote.facility.online=true;x.quote.timeInSeconds=0;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_INDUSTRY_QUOTE_INVARIANT_FAILED");
 x.quote.timeInSeconds=3600;x.quote.definition.activities[1].products=[];
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_PRODUCT_RECIPE_MISSING");
});

test("reaction quote requires paid native recipe and actual reaction materials",()=>{
 const x=fixture();x.request.activityID=9;x.quote.activityID=9;
 x.quote.definition.activities[9]={products:[{typeID:730,quantity:1}]};
 assert.equal(x.native.checkInstall(x.s1,x.request).ok,true);
 x.quote.definition.activities[9].products=[];
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"NATIVE_PRODUCT_RECIPE_MISSING");
});
test("copying BPO checks native licensed production runs",()=>{
 const x=fixture();x.request.activityID=5;x.quote.activityID=5;
 x.quote.materials=[];x.quote.cost=10;x.quote.tax=0;x.quote.sccSurcharge=0;
 x.quote.totalCost=10;x.quote.licensedRuns=21;
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"COPY_LICENSED_RUNS_INVALID");
 x.quote.licensedRuns=10;
 assert.equal(x.native.checkInstall(x.s1,x.request).ok,true);
});
test("corporation wallet division and hangar take permissions are independent",()=>{
 const x=fixture();
 x.inventory[500].ownerID=901;x.blueprints[500].ownerID=901;
 x.quote.ownerID=901;x.quote.account=[901,1000];
 x.quote.inputLocation.ownerID=901;x.quote.outputLocation.ownerID=901;
 x.corporate();x.walletPermission(false);
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"CORPORATION_WALLET_TAKE_REQUIRED");
 x.walletPermission(true);x.takePermission(false);
 assert.equal(x.native.checkInstall(x.s1,x.request).reason,"CORPORATION_HANGAR_TAKE_REQUIRED");
});
test("native facility time/rig quote must remain positive, but no synthetic speed bonus is applied",()=>{
 const x=fixture();x.quote.timeInSeconds=720;
 const result=x.native.checkInstall(x.s1,x.request);
 assert.equal(result.ok,true);
 assert.equal(result.cost,60);
});
