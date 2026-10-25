import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAlifeSalvageMarket}=require("../integration/coopAlifeSalvageMarket.cjs");
const {createSalvagePendingMarket}=require("../integration/coopSalvageNpcPendingMarket.cjs");
const {createNpcCorporateSettlement}=require("../integration/coopNpcCorporateSettlement.cjs");
// Source-backed whole-chain simulation with one rollback-capable native
// GameStore and deterministic Rust RPC stand-in. NOT a real SQLite/Rust game.
const envKeys=["EVEJS_COOP_ALIFE","EVEJS_COOP_ALIFE_SALVAGE_MARKET",
 "EVEJS_COOP_ALIFE_SALVAGE_RIVALS","EVEJS_COOP_SALVAGE_NATIVE_MARKET",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_NPC_MARKET_PENDING",
 "EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF",
 "EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT"];
async function live(fn){
 const old=envKeys.map(x=>process.env[x]);
 for(const key of envKeys)process.env[key]="1";
 try{return await fn()}finally{envKeys.forEach((key,i)=>{
  if(old[i]===undefined)delete process.env[key];
  else process.env[key]=old[i];
 })};
}
function stage({lostFinalize=false,crashBeforeFinalize=false}={}){
 const row={v:1,state:"NPC_STOCK_DELIVERED",wreckID:8001,
  manifestKey:"30000144-77-1000000",wreckItemID:9001,
  sourceCargoID:5501,npcCargoID:2001,entityID:801,
  corporationID:10001,stationID:60001,nativeItemID:100000};
 let db={
  npcCargo:{cargo:{}},items:{"100000":{itemID:100000,ownerID:10001,
   locationID:60001,flagID:4,typeID:34,quantity:5,stacksize:5,
   singleton:0,customInfo:"coop-salvage-rival:v1:9001:5501"}},
  marketEscrow:{},npcMarketFills:{},characters:{"701":{
   characterID:701,balance:500,walletJournal:[],marketTransactions:[]}},
  corporationRuntime:{
   ["corporations\u001f10001"]:{corporationID:10001,wallet:{divisions:{
    "1000":{key:1000,balance:100,journal:[],transactions:[]}}}},
   coopSalvageRivalMoves:{version:1,moves:{"9001":row}}
  }
 };
 let rustState="missing",order=null,claimBuyer=null,lost=lostFinalize,preCrash=crashBeforeFinalize,fillID=900000000000001;
 const calls=[],commits=[];
 const atomic={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(tables,cb)=>{
   const next=structuredClone(db);
   const tx={get:(t,k)=>next[t]?.[k]??null,
    scan:t=>Object.entries(next[t]||{}).map(([key,value])=>({key,value})),
    put:(t,k,v)=>{next[t][k]=v},del:(t,k)=>{delete next[t][k]}};
   const answer=cb(tx);db=next;commits.push([...tables]);return answer;
  }};
 const rustOrder=()=>({...order,state:rustState,
  vol_remaining:rustState==="filled"?0:5});
 const call=async(method,params)=>{
  calls.push(method);
  if(method==="GetOrders")return {buys:[{source:"player",state:"open",
   bid:true,station_id:60001,type_id:34,owner_id:8888,
   order_id:"7101",price:12,vol_remaining:5}],sells:[]};
  if(method==="ReserveNpcSellOrder"){
   if(rustState!=="missing")throw Error("SECOND_NATIVE_RUST_ORDER");
   order={operation_id:params.operation_id,order_id:"456",
    source_item_id:params.source_item_id,owner_id:params.owner_id,
    station_id:params.station_id,type_id:params.type_id,
    quantity:params.quantity,price:params.price,bid:false,is_corp:true,source:"coop-npc",vol_remaining:5};
   rustState="pending";return rustOrder();
  }
  if(method==="GetNpcSellOrder"){
   if(!order)throw Error("MISSING_ORDER");
   return rustOrder();
  }
  if(method==="ActivateNpcSellOrder"){
   if(!order||params.operation_id!==order.operation_id||
    params.order_id!=="456")throw Error("ORDER_MISMATCH");
   if(!["pending","open"].includes(rustState))throw Error("ORDER_NOT_PENDING");
   rustState="open";return rustOrder();
  }
  if(method==="ClaimNpcSellOrder"){
   if(!order||params.operation_id!==order.operation_id||
    params.order_id!=="456")throw Error("CLAIM_IDENTITY_INVALID");
   if(claimBuyer!==null&&claimBuyer!==Number(params.buyer_id))
    throw Error("BUYER_CLAIM_CONFLICT");
   if(!["open","settling","filled"].includes(rustState))
    throw Error("ORDER_NOT_ACTIVE");
   rustState=rustState==="filled"?"filled":"settling";
   claimBuyer=Number(params.buyer_id);return {...rustOrder(),
    buyer_id:String(claimBuyer),fill_id:String(fillID),
    price_cents:1200,source:"coop-npc"};
  }
  if(method==="FinalizeNpcSellOrder"){
   if(claimBuyer!==Number(params.buyer_id)||
    Number(params.fill_id)!==fillID||params.order_id!=="456")
    throw Error("FINALIZE_IDENTITY_CHANGED");
   if(!["settling","filled"].includes(rustState))throw Error("ORDER_NOT_CLAIMED");
   if(preCrash){preCrash=false;throw Error("RUST_FINALIZE_NOT_CALLED_BEFORE_CRASH")}
   rustState="filled";
   const reply={...rustOrder(),state:"filled",buyer_id:String(claimBuyer),
    fill_id:String(fillID),vol_remaining:0};
   if(lost){lost=false;throw Error("LOST_FINALIZE_ACK")}
   return reply;
  }
  if(method==="GetNpcSellClaim")return {...rustOrder(),
   buyer_id:String(claimBuyer),fill_id:String(fillID)};
  throw Error("UNEXPECTED_RUST_RPC:"+method);
 };
 const readJournal=()=>db.corporationRuntime.coopSalvageRivalMoves;
 const readOps=()=>db.corporationRuntime.coopSalvageMarketOps||
  {version:1,bySource:{}};
 const readWitness=()=>({status:"READY",record:{manifestKey:row.manifestKey,
  wreckID:row.wreckID,stationID:row.stationID,corporationID:row.corporationID,
  rows:[{cargoID:5501,wreckItemID:9001,typeID:34,quantity:5}]}});
 const makeMarket=cents=>createSalvagePendingMarket({
  atomic,call,getItem:id=>db.items[String(id)]||null,
  getEscrow:id=>db.marketEscrow[String(id)]||null,
  readJournal,readOps,readWitness,
  readFill:id=>db.npcMarketFills["order\u001f"+id]||null,
  readCorp:id=>db.corporationRuntime["corporations\u001f"+id],
  isNpcCorporation:id=>id===10001,
  verifyStation:(id,owner)=>id===60001&&owner===10001,
  resolvePriceCents:()=>cents,clock:()=>1761400000000});
 const alife=createAlifeSalvageMarket({
  readJournal,readOps,marketFactory:makeMarket,
  getStation:id=>id===60001?{stationID:60001,regionID:10000002,solarSystemID:30000144}:null,
  getOrders:params=>call("GetOrders",params),
  systems:()=>new Set([30000144]),clock:()=>1761400000000});
 const settlement=createNpcCorporateSettlement({
  gameStore:atomic,
  market:{claimOnce:({orderID,buyerID,operationID})=>
   call("ClaimNpcSellOrder",{order_id:String(orderID),
    buyer_id:String(buyerID),operation_id:operationID}),
   finalizeOnce:({orderID,buyerID,operationID,fillID})=>
    call("FinalizeNpcSellOrder",{order_id:String(orderID),
     buyer_id:String(buyerID),operation_id:operationID,fill_id:String(fillID)}),
   inspectClaim:({operationID})=>call("GetNpcSellClaim",{operation_id:operationID})},
  verifyBuyerSession:(id,station)=>id===701&&station===60001,
  verifyNpcCorporation:(id,station)=>id===10001&&station===60001,
  clock:()=>1761400000000
 });
 const buyer=()=>settlement.purchaseOnce({
  buyerID:701,identity:{
   operationID:order.operation_id,orderID:456,
   ownerID:10001,stationID:60001,typeID:34,itemID:100000,quantity:5
  },maxPriceCents:1200});
 return {alife,buyer,makeMarket,calls,commits,db:()=>structuredClone(db),
  state:()=>rustState,order:()=>order};
}
test("whole source-backed salvage → real quote → Rust ask → player buy → native corp ISK → SOLD",()=>live(async()=>{
 const f=stage(),selling=await f.alife.tick();
 assert.equal(selling.status,"ALIFE_SALVAGE_MARKET_ATTEMPT");
 assert.equal(selling.result.status,"NATIVE_SALVAGE_MARKET_LISTED");
 assert.equal(f.db().items["100000"].locationID,9200000456);
 assert.equal(f.state(),"open");
 const purchase=await f.buyer(),db=f.db();
 assert.equal(purchase.status,"PURCHASED");
 assert.equal(db.characters["701"].balance,440);
 assert.equal(db.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,160);
 assert.equal(db.items["100000"].ownerID,701);
 assert.equal(db.items["100000"].locationID,60001);
 assert.equal(db.marketEscrow["456"],undefined);
 assert.equal(db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"SOLD");
 assert.equal(f.state(),"filled");
 const before=f.db();
 assert.equal((await f.buyer()).status,"PURCHASED");
 assert.deepEqual(f.db(),before);
 assert.equal(f.calls.filter(x=>x==="ReserveNpcSellOrder").length,1);
}));
test("crash after real wallet commit, before Rust finalize acknowledgement: recover without a second charge",()=>live(async()=>{
 const f=stage({lostFinalize:true});
 assert.equal((await f.alife.tick()).result.status,"NATIVE_SALVAGE_MARKET_LISTED");
 await assert.rejects(f.buyer(),/LOST_FINALIZE_ACK/);
 const paid=f.db();
 assert.equal(paid.characters["701"].balance,440);
 assert.equal(paid.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,160);
 assert.equal(paid.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"NATIVE_SALE_COMMITTED");
 assert.equal((await f.alife.tick()).result.status,"NATIVE_SALVAGE_SOLD_RECOVERED");
 const after=f.db();
 assert.equal(after.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"SOLD");
 assert.equal(after.characters["701"].balance,440);
 assert.equal(after.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,160);
 assert.deepEqual(after.items,paid.items);
 assert.equal(f.calls.filter(x=>x==="ReserveNpcSellOrder").length,1);
 assert.equal(f.calls.filter(x=>x==="FinalizeNpcSellOrder").length,1);
}));
test("crash before Rust finalize executes: one verified native payment, idempotent restart finishes Rust",()=>live(async()=>{
 const f=stage({crashBeforeFinalize:true});
 assert.equal((await f.alife.tick()).result.status,"NATIVE_SALVAGE_MARKET_LISTED");
 await assert.rejects(f.buyer(),/RUST_FINALIZE_NOT_CALLED_BEFORE_CRASH/);
 assert.equal(f.state(),"settling");
 const paid=f.db();
 assert.equal(paid.characters["701"].balance,440);
 assert.equal(paid.corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,160);
 assert.equal((await f.alife.tick()).result.status,"NATIVE_SALVAGE_SOLD_RECOVERED");
 assert.equal(f.state(),"filled");
 assert.equal(f.db().characters["701"].balance,440);
 assert.equal(f.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,160);
 assert.equal(f.calls.filter(x=>x==="ReserveNpcSellOrder").length,1);
 assert.equal(f.calls.filter(x=>x==="FinalizeNpcSellOrder").length,2);
}));
