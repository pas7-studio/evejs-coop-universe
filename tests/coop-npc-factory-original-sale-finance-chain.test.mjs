import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcCorporateSettlement,TABLES}=require("../integration/coopNpcCorporateSettlement.cjs");
const {createOriginalNpcSaleSettlementAudit}=require("../integration/coopNpcIndustryOriginalSaleAudit.cjs");
const {createOriginalNpcWalletReceiptWitness}=require("../integration/coopNpcIndustryOriginalWalletWitness.cjs");
const OWNER=1000035,STATION=60010001,BUYER=90000001,ORDER=500;
const TYPE=215,ITEM=1990000200,JOB=970000000000000,FILL=2345001;
const OP="npc-manufacture:"+"a".repeat(32),SEP="\u001f";
function fixture(){
 let state="open",claimCalls=0,finalizeCalls=0;
 const data={
  characters:{[BUYER]:{characterID:BUYER,balance:1200,walletJournal:[],
   marketTransactions:[]}},
  corporationRuntime:{["corporations"+SEP+OWNER]:{
   corporationID:OWNER,wallet:{divisions:{"1000":{
    balance:100,journal:[],transactions:[]}}}}},
  items:{[ITEM]:{itemID:ITEM,ownerID:OWNER,locationID:9200000000+ORDER,
   flagID:4,singleton:0,quantity:100,stacksize:100,typeID:TYPE,
   customInfo:"coop-industry:v1:"+JOB}},
  marketEscrow:{[ORDER]:{orderId:String(ORDER),escrowType:"sell",
   isCorp:true,ownerId:OWNER,stationId:STATION,sourceItemID:ITEM,
   coopOperationID:OP,escrowLocationID:9200000000+ORDER,
   remainingQuantity:100}},
  npcMarketFills:{}
 };
 const clone=x=>structuredClone(x);
 const gameStore={transact:(tables,fn)=>{
  assert.deepEqual(tables,TABLES);
  const saved=clone(data);
  try{return fn({get:(table,key)=>data[table]?.[key]??null,
   put:(table,key,value)=>{data[table][key]=value},
   del:(table,key)=>{delete data[table][key]},
   scan:table=>Object.entries(data[table]).map(([key,value])=>({key,value}))})}
  catch(error){for(const key of TABLES)data[key]=saved[key];throw error}
 }};
 const claim={source:"coop-npc",state:"settling",operation_id:OP,
  order_id:String(ORDER),source_item_id:String(ITEM),owner_id:OWNER,
  station_id:STATION,type_id:TYPE,quantity:100,buyer_id:String(BUYER),
  fill_id:String(FILL),price_cents:1200,is_corp:true,bid:false};
 const market={
  claimOnce:async()=>{claimCalls++;return {...claim,state:state==="filled"?"filled":"settling"}},
  finalizeOnce:async()=>{finalizeCalls++;state="filled";
   return{state:"filled",order_id:String(ORDER),buyer_id:String(BUYER),
    fill_id:String(FILL),vol_remaining:0}},
  inspectClaim:async()=>({state,buyer_id:String(BUYER),fill_id:String(FILL)})
 };
 const settle=createNpcCorporateSettlement({gameStore,market,
  verifyBuyerSession:(id,st)=>id===BUYER&&st===STATION,
  verifyNpcCorporation:(id,st)=>id===OWNER&&st===STATION,
  clock:()=>1761390000000});
 const producer={operationID:OP,ownerID:OWNER,stationID:STATION,
  orderID:ORDER,itemID:ITEM,typeID:TYPE,quantity:100,
  phase:"LISTED"};
 const director={inspect:()=>clone({version:1,entries:{[OP]:producer},history:{}})};
 const wallet=createOriginalNpcWalletReceiptWitness({
  getCorporation:id=>id===OWNER?data.corporationRuntime["corporations"+SEP+OWNER]:null,
  getCharacter:id=>id===BUYER?data.characters[BUYER]:null});
 const audit=createOriginalNpcSaleSettlementAudit({
  director,
  listNativeReceipts:async id=>Object.values(data.npcMarketFills)
   .filter(row=>row.orderID===id),
  inspectRustFill:async()=>({operation_id:OP,order_id:String(ORDER),
   fill_id:String(FILL),buyer_id:String(BUYER),state}),
  getNativeWalletEvidence:(id,receipt)=>wallet.verify(id,receipt),
  getOriginalItem:id=>data.items[id]??null,
  getOriginalEscrow:id=>data.marketEscrow[id]??null,
  getRustOrder:async()=>({operation_id:OP,order_id:String(ORDER),
   owner_id:OWNER,station_id:STATION,type_id:TYPE,
   source_item_id:String(ITEM),source:"coop-npc",
   is_corp:true,bid:false,state,
   vol_remaining:state==="filled"?0:100})
 });
 const id={operationID:OP,orderID:ORDER,ownerID:OWNER,stationID:STATION,
  typeID:TYPE,itemID:ITEM,quantity:100};
 return {data,settle,audit,id,
  auditSale:()=>audit.audit({ownerID:OWNER,stationID:STATION,
   operationID:OP,orderID:ORDER}),
  get claims(){return claimCalls},get finalizes(){return finalizeCalls}};
}
async function withFlags(fn){
 const keys=["EVEJS_COOP_NATIVE_ATOMIC_ROWS",
  "EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF"];
 const old=keys.map(k=>process.env[k]);keys.forEach(k=>{process.env[k]="1"});
 try{return await fn(fixture())}
 finally{keys.forEach((k,i)=>{if(old[i]==null)delete process.env[k];
  else process.env[k]=old[i]})}
}
test("existing COOP-035 original GameStore commit is proven by new Rust and wallet audit",()=>withFlags(async f=>{
 assert.equal((await f.settle.purchaseOnce({buyerID:BUYER,
  identity:f.id,maxPriceCents:1200})).status,"PURCHASED");
 const a=await f.auditSale();
 assert.equal(a.status,"ORIGINAL_FULL_SALE_ATTESTED");
 assert.equal(a.revenueCents,120000);
 assert.equal(a.soldQuantity,100);assert.equal(a.remainingQuantity,0);
 assert.equal(f.data.characters[BUYER].balance,0);
 assert.equal(f.data.corporationRuntime["corporations"+SEP+OWNER].wallet.divisions["1000"].balance,1300);
 assert.equal(f.data.items[ITEM].ownerID,BUYER);
 assert.equal(f.data.marketEscrow[ORDER],undefined);
}));
test("replaying same original Rust fill never credits NPC corp twice and remains auditable",()=>withFlags(async f=>{
 await f.settle.purchaseOnce({buyerID:BUYER,identity:f.id,maxPriceCents:1200});
 const saved=structuredClone(f.data);
 await f.settle.purchaseOnce({buyerID:BUYER,identity:f.id,maxPriceCents:1200});
 assert.deepEqual(f.data,saved);
 assert.equal((await f.auditSale()).status,"ORIGINAL_FULL_SALE_ATTESTED");
}));
test("forged original financial journal after payment cannot be attested as earned ISK",()=>withFlags(async f=>{
 await f.settle.purchaseOnce({buyerID:BUYER,identity:f.id,maxPriceCents:1200});
 const corp=f.data.corporationRuntime["corporations"+SEP+OWNER];
 corp.wallet.divisions["1000"].transactions[0].amount=1201;
 assert.match((await f.auditSale()).reason,/WALLET_RECEIPT_MISMATCH/);
}));
