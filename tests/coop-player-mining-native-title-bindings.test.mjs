import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeMiningOreBindings,createTrustedTitleService,
 createRuntimeTitleVerifier}=require("../integration/coopPlayerMiningOreNativeBindings.cjs");
const SEP="\u001f",CID=8102,ITEM=8103,PLAYER=8104,NPC=8105,
 STATION=6000081,FOLDER=70102,DIV=115;
const OP="coop-mining-ore-title:v1:coop-mining-shift:"+"a".repeat(32)+":"+CID;
const clone=x=>structuredClone(x);
function make(){
 let dock=STATION,readError=false,quoteValid=true,offices=[
  {corporationID:PLAYER,stationID:STATION,officeFolderID:FOLDER,officeID:777,impounded:false}];
 const corps={
  [PLAYER]:{corporationID:PLAYER,isNPC:false},
  [NPC]:{corporationID:NPC,isNPC:true}
 };
 const rows=new Map(),cargoTag="coop-warehouse:v1:cargo:"+CID;
 const funds=(id,other,amount,after)=>({
  transactionID:OP,referenceID:OP,ownerID1:id,ownerID2:other,
  accountKey:1000,amount,balance:after});
 const seller=funds(NPC,PLAYER,12.34,112.34),buyer=funds(PLAYER,NPC,-12.34,487.66);
 rows.set("corporations"+SEP+NPC,{corporationID:NPC,wallet:{divisions:{
  "1000":{balance:112.34,transactions:[seller],journal:[seller]}}}});
 rows.set("corporations"+SEP+PLAYER,{corporationID:PLAYER,wallet:{divisions:{
  "1000":{balance:487.66,transactions:[buyer],journal:[buyer]}}}});
 const title={version:1,status:"COMMITTED",operationID:OP,cargoID:CID,
  itemID:ITEM,typeID:34,quantity:22,sourceCorpID:NPC,buyerCorpID:PLAYER,
  stationID:STATION,officeFolderID:FOLDER,division:DIV,priceCents:1234,
  sourceBeforeCents:10000,sourceAfterCents:11234,
  buyerBeforeCents:50000,buyerAfterCents:48766,committedAt:10000};
 rows.set("coopPlayerMiningOreTitle"+SEP+CID,title);
 const item={itemID:ITEM,typeID:34,quantity:22,stacksize:22,singleton:0,
  ownerID:PLAYER,locationID:FOLDER,flagID:DIV,customInfo:cargoTag};
 const inventory={findItemById:id=>id===ITEM?item:null,
  findWarehouseItem:({cargoID})=>cargoID===CID?item:null};
 const gameStore={read(table,path){
  if(readError)return {success:false,errorMsg:"READ_ERROR"};
  if(table!=="corporationRuntime")return {success:false,errorMsg:"TABLE_NOT_FOUND"};
  const row=rows.get(path.slice(1).replace("/",SEP));
  return row?{success:true,data:clone(row)}:{success:false,errorMsg:"ENTRY_NOT_FOUND"};
 }};
 const access={isMember:()=>true,canView:()=>true,canWallet:()=>true,canIndustry:()=>true};
 const depend={gameStore,corporationState:{
  getCorporationRecord:id=>corps[id]||null,
  isNpcCorporationID:id=>id===NPC},
  corporationRuntime:{getCorporationOffices:()=>offices},itemStore:inventory,
  getDockedStation:()=>dock,access,
  priceQuote:()=>quoteValid?{verifiedNative:true,priceCents:1234}:null};
 const build=(override={})=>createNativeMiningOreBindings({...depend,...override});
 const receipt={version:1,phase:"COMMITTED",cargoID:CID,itemID:ITEM,typeID:34,
  quantity:22,corporationID:NPC,stationID:STATION};
 return {build,depend,offices,corps,rows,item,receipt,access,
  dock:v=>dock=v,readError:v=>readError=v,priceValid:v=>quoteValid=v,
  setOffices:v=>offices=v};
}
test("original active native office & docked member authorize title read",()=>{
 const x=make(),b=x.build();
 assert.equal(b.verifyOffice({buyerCorpID:PLAYER,stationID:STATION,
  officeFolderID:FOLDER,division:115,session:{characterID:2001}}),true);
 assert.equal(b.mode,"ORIGINAL_GAMESTORE_READ_ONLY");
 assert.equal(b.supportsLiveTransfer,false);
});
test("wrong physical dock, office folder, division or impound fails closed",()=>{
 const x=make(),b=x.build(),args={buyerCorpID:PLAYER,stationID:STATION,
  officeFolderID:FOLDER,division:115,session:{characterID:2001}};
 for(const change of [{officeFolderID:FOLDER+1},{division:114},{stationID:STATION+1},
  {session:{socket:{destroyed:true}}}]){
  assert.equal(b.verifyOffice({...args,...change}),false);
 }
 x.dock(STATION+1);assert.equal(b.verifyOffice(args),false);
 x.dock(STATION);x.offices[0].impounded=true;
 assert.equal(b.verifyOffice(args),false);
});
test("client-supplied corp ID never impersonates original NPC or player",()=>{
 const x=make(),b=x.build();
 assert.equal(b.verifyNpcCorporation(NPC),true);
 assert.equal(b.verifyNpcCorporation(PLAYER),false);
 x.corps[NPC].isNPC=false;
 assert.equal(b.verifyNpcCorporation(NPC),false);
});
test("duplicate matching corporate offices fail safely",()=>{
 const x=make();x.setOffices([...x.offices,{...x.offices[0]}]);
 assert.equal(x.build().verifyOfficeReceipt({buyerCorpID:PLAYER,stationID:STATION,
  officeFolderID:FOLDER,division:115}),false);
});
test("native GameStore source receipt is read-only, no creation on missing title",()=>{
 const x=make(),b=x.build();
 assert.equal(b.readTitleReceipt(CID).itemID,ITEM);
 assert.equal(b.readTitleReceipt(CID+1),null);
 assert.equal(b.readCorporation(NPC).corporationID,NPC);
});
test("damaged or inaccessible native GameStore never passes title audit",()=>{
 const x=make(),b=x.build();
 assert.equal(b.verifyTransferredTitle(x.receipt),true);
 x.readError(true);
 assert.equal(b.verifyTransferredTitle(x.receipt),false);
});
test("verified original item and both original wallet receipts permit reconciliation",()=>{
 const x=make(),b=x.build();
 assert.equal(b.verifyTransferredTitle(x.receipt),true);
});
test("tampered wallet or wrong original item cannot clear warehouse audit",()=>{
 for(const breakProof of [
  x=>x.item.ownerID=PLAYER+9,
  x=>x.item.locationID=STATION,
  x=>x.item.customInfo="cloned",
  x=>x.rows.get("corporations"+SEP+PLAYER).wallet.divisions["1000"].journal[0].amount=-9
 ]){
  const x=make();breakProof(x);
  assert.equal(x.build().verifyTransferredTitle(x.receipt),false);
 }
});
test("paid ore quote refuses unknown or fractional native ISK",()=>{
 const x=make();
 assert.equal(x.build().quoteOre({}).priceCents,1234);
 assert.equal(x.build({priceQuote:null}).quoteOre({}),null);
 x.priceValid(false);assert.equal(x.build().quoteOre({}),null);
 assert.equal(x.build({priceQuote:()=>({verifiedNative:true,priceCents:0.5})}).quoteOre({}),null);
});
test("native price and warehouse receipts are prerequisites for composing writer",()=>{
 const x=make();
 assert.throws(()=>createTrustedTitleService({...x.depend,warehouse:{getReceipt:()=>null},
 priceQuote:null}),/TRUSTED_SELLER/);
 assert.throws(()=>createTrustedTitleService({...x.depend,warehouse:null,
 priceQuote:()=>null}),/TRUSTED_SELLER/);
});
test("composed original GameStore title writer is explicitly OFF until both flags on",()=>{
 const x=make();let writes=0;
 const service=createTrustedTitleService({...x.depend,
  warehouse:{getReceipt:()=>x.receipt},
  priceQuote:()=>null,env:{EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
    EVEJS_COOP_PLAYER_NPC_MINING_ORE_TITLE:"0"},
  gameStore:{...x.depend.gameStore,coopAtomicNativeRows:{
   mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
   transact:()=>{writes++;throw Error("MUST_NOT_WRITE");}}}});
 const result=service.transfer({shiftID:"coop-mining-shift:"+"a".repeat(32),
  cargoID:CID,itemID:ITEM,typeID:34,quantity:22,systemID:11,fleetID:12,
  sourceCorpID:NPC,buyerCorpID:PLAYER,stationID:STATION,officeFolderID:FOLDER,
  maxPriceCents:1234});
 assert.equal(result.reason,"MINING_ORE_TRANSFER_DISABLED");
 assert.equal(writes,0);
});
test("runtime warehouse verifier remains absent while new feature flag OFF",()=>{
 const previous=process.env.EVEJS_COOP_PLAYER_NPC_MINING_ORE_TITLE;
 try{delete process.env.EVEJS_COOP_PLAYER_NPC_MINING_ORE_TITLE;
  assert.equal(createRuntimeTitleVerifier(),null);}
 finally{
  if(previous===undefined)delete process.env.EVEJS_COOP_PLAYER_NPC_MINING_ORE_TITLE;
  else process.env.EVEJS_COOP_PLAYER_NPC_MINING_ORE_TITLE=previous;
 }
});
