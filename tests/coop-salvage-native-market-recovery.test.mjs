import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSalvagePendingMarket}=require("../integration/coopSalvageNpcPendingMarket.cjs");
const op="npc-salvage:"+crypto.createHash("sha256")
 .update(["30000144-77-1000000",8001,9001,100000,5501,10001,60001].join(":"))
 .digest("hex").slice(0,32);
const keys=["EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_NATIVE_NPC_MARKET_PENDING","EVEJS_COOP_SALVAGE_NATIVE_MARKET"];
function fixture({phase="PREPARED",rustState="pending",failRust=false,
 corruptSource=false,salePaid=false,badWallet=false,paidRustState="filled"}={}){
 const cargo={itemID:100000,ownerID:10001,locationID:60001,
  flagID:4,typeID:34,quantity:5,stacksize:5,singleton:0,
  customInfo:"coop-salvage-rival:v1:9001:5501"};
 const p={v:1,manifestKey:"30000144-77-1000000",wreckID:8001,
  sourceCargoID:5501,wreckItemID:9001,npcCargoID:2001,entityID:801,
  corporationID:10001,stationID:60001,nativeItemID:100000,
  typeID:34,quantity:5,operationID:op,priceCents:1200,at:1000,
  phase,orderID:phase==="PREPARED"?undefined:456};
 if(salePaid){p.phase="NATIVE_SALE_COMMITTED";p.orderID=456;
  p.fillID=900000000000001;p.buyerID=701;p.grossCents=6000;
  rustState=paidRustState}
 const r={v:1,state:"NPC_STOCK_DELIVERED",manifestKey:p.manifestKey,
  wreckID:p.wreckID,sourceCargoID:p.sourceCargoID,wreckItemID:p.wreckItemID,
  npcCargoID:p.npcCargoID,entityID:p.entityID,corporationID:p.corporationID,
  stationID:p.stationID,nativeItemID:p.nativeItemID};
 const esc={orderId:"456",escrowType:"sell",ownerId:10001,isCorp:true,
  typeId:34,stationId:60001,escrowLocationID:9200000456,
  remainingQuantity:5,sourceItemID:100000,coopOperationID:op,
  coopSource:"NATIVE_SALVAGE"};
 const db={items:{"100000":cargo},npcCargo:{cargo:{}},
  corporationRuntime:{
   coopSalvageMarketOps:{version:1,bySource:{"9001":p}},
   coopSalvageRivalMoves:{version:1,moves:{"9001":r}}
  },marketEscrow:{},npcMarketFills:{}};
 if(phase==="ESCROWED"||phase==="LISTED"||salePaid){
  db.items["100000"].locationID=9200000456;
  db.marketEscrow["456"]=esc;
 }
 if(salePaid){
  db.items["100000"].locationID=60001;
  db.items["100000"].ownerID=701;
  delete db.marketEscrow["456"];
  db.npcMarketFills["order\u001f456"]={phase:"NATIVE_COMMITTED",coopSource:"NATIVE_SALVAGE",
   operationID:op,fillID:p.fillID,buyerID:701,orderID:456,
   ownerID:10001,itemID:100000,grossCents:6000};
 }
 const corps={corporationID:10001,wallet:{divisions:{"1000":{
  journal:badWallet?[]:[{transactionID:900000000000001,amount:60}],
  transactions:badWallet?[]:[{transactionID:900000000000001,amount:60}]
 }}}};
 let commits=0,calls=[],nativeOrderState=rustState;
 const order=state=>({operation_id:op,source_item_id:"100000",
  order_id:"456",owner_id:10001,station_id:60001,type_id:34,
  quantity:5,price:12,bid:false,is_corp:true,source:"coop-npc",vol_remaining:state==="filled"?0:5,state});
 const atomic={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(tables,fn)=>{
   const next=structuredClone(db);
   const tx={get:(t,k)=>next[t]?.[k]??null,
    scan:t=>Object.entries(next[t]||{}).map(([key,value])=>({key,value})),
    put:(t,k,v)=>next[t][k]=v,
    del:(t,k)=>delete next[t][k]};
   const out=fn(tx);Object.assign(db,next);commits++;return out;
  }};
 const call=async(method)=>{
  calls.push(method);
  if(failRust&&method==="GetNpcSellOrder")throw Error("READ_TIMEOUT");
  if(method==="GetNpcSellOrder")return order(nativeOrderState);
  if(method==="ActivateNpcSellOrder"){
   nativeOrderState="open";return order("open")}
  if(method==="FinalizeNpcSellOrder"){
   if(nativeOrderState!=="settling")throw Error("NOT_SETTLING");
   nativeOrderState="filled";
   return {state:"filled",order_id:"456",
    fill_id:"900000000000001",buyer_id:"701"};
  }
  if(method==="GetNpcSellClaim")return {state:nativeOrderState,
   order_id:"456",fill_id:"900000000000001",buyer_id:"701"};
  throw Error("RECOVERY_MUST_NOT_REPEAT_RESERVE:"+method);
 };
 const create=()=>createSalvagePendingMarket({atomic,call,
  getItem:id=>db.items[String(id)]||null,
  getEscrow:id=>db.marketEscrow[String(id)]||null,
  readJournal:()=>structuredClone(db.corporationRuntime.coopSalvageRivalMoves),
  readOps:()=>structuredClone(db.corporationRuntime.coopSalvageMarketOps),
  readFill:id=>db.npcMarketFills["order\u001f"+id]||null,
  readCorp:()=>corps,
  readWitness:()=>({status:"READY",record:{manifestKey:p.manifestKey,
   wreckID:8001,stationID:60001,corporationID:10001,
   rows:[{cargoID:5501,wreckItemID:9001,typeID:34,quantity:5}]}}),
  isNpcCorporation:()=>true,verifyStation:()=>true,
  resolvePriceCents:()=>1200,clock:()=>1761400000000});
 if(corruptSource)db.items["100000"].typeID=35;
 return {create,db,calls,commits:()=>commits,
  setRust:v=>nativeOrderState=v};
}
async function ready(cb){
 const old=keys.map(k=>process.env[k]);
 keys.forEach(k=>process.env[k]="1");
 try{return await cb()}finally{keys.forEach((k,i)=>{
  if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]});
 }
}
test("lost Reserve ACK: read pending Rust once and finish original native escrow and activation",()=>ready(async()=>{
 const f=fixture(),r=await f.create().reconcile(9001);
 assert.equal(r.status,"NATIVE_SALVAGE_LISTED_RECOVERED");
 assert.equal(f.db.items["100000"].locationID,9200000456);
 assert.equal(f.db.marketEscrow["456"].coopSource,"NATIVE_SALVAGE");
 assert.equal(f.db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"LISTED");
 assert.equal(f.calls.filter(x=>x==="ActivateNpcSellOrder").length,1);
 assert.equal(f.calls.filter(x=>x==="ReserveNpcSellOrder").length,0);
}));
test("Rust read unavailable after PREPARED never reserves twice or mutates original item",()=>ready(async()=>{
 const f=fixture({failRust:true}),r=await f.create().reconcile(9001);
 assert.equal(r.phase,"RUST_ORDER_READ_UNKNOWN");
 assert.equal(f.commits(),0);
 assert.equal(f.db.items["100000"].locationID,60001);
 assert.deepEqual(f.calls,["GetNpcSellOrder"]);
}));
test("changed source item forbids crash recovery, no escrow minted",()=>ready(async()=>{
 const f=fixture({corruptSource:true}),r=await f.create().reconcile(9001);
 assert.equal(r.phase,"ESCROW_RECOVERY_COMMIT_UNKNOWN");
 assert.equal(f.commits(),0);
 assert.equal(Object.keys(f.db.marketEscrow).length,0);
}));
test("lost activation ACK: prove native escrow then reactivate identical Rust order only",()=>ready(async()=>{
 const f=fixture({phase:"ESCROWED"}),r=await f.create().reconcile(9001);
 assert.equal(r.status,"NATIVE_SALVAGE_LISTED_RECOVERED");
 assert.equal(f.commits(),1);
 assert.deepEqual(f.calls,["GetNpcSellOrder","ActivateNpcSellOrder","GetNpcSellOrder"]);
}));
test("Rust open after lost ACK seals LISTED without any repeated activation or stock move",()=>ready(async()=>{
 const f=fixture({phase:"ESCROWED",rustState:"open"});
 assert.equal((await f.create().reconcile(9001)).status,"NATIVE_SALVAGE_LISTED_RECOVERED");
 assert.equal(f.calls.filter(x=>x==="ActivateNpcSellOrder").length,0);
 assert.equal(f.db.marketEscrow["456"].sourceItemID,100000);
}));
test("LISTED and genuine Rust open remain read-only and paid wallet stays unchanged",()=>ready(async()=>{
 const f=fixture({phase:"LISTED",rustState:"open"}),r=await f.create().reconcile(9001);
 assert.equal(r.status,"NATIVE_SALVAGE_ALREADY_LISTED");
 assert.equal(f.commits(),0);
 assert.deepEqual(f.calls,["GetNpcSellOrder"]);
}));
test("buyer claim settling is never mistaken for an unlocked item or paid income",()=>ready(async()=>{
 const f=fixture({phase:"LISTED",rustState:"settling"}),r=await f.create().reconcile(9001);
 assert.equal(r.status,"NATIVE_SALVAGE_BUYER_SETTLEMENT_IN_PROGRESS");
 assert.equal(f.commits(),0);
}));
test("paid native fill, buyer item, corp wallet and Rust fill seal SOLD without paying again",()=>ready(async()=>{
 const f=fixture({salePaid:true}),r=await f.create().reconcile(9001);
 assert.equal(r.status,"NATIVE_SALVAGE_SOLD_RECOVERED");
 assert.equal(f.db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"SOLD");
 assert.equal(f.db.items["100000"].ownerID,701);
 assert.equal(f.commits(),1);
 assert.deepEqual(f.calls,["GetNpcSellClaim"]);
}));
test("paid GameStore survives crash before Rust finalize: finalize exactly the signed original claim",()=>ready(async()=>{
 const f=fixture({salePaid:true,paidRustState:"settling"});
 const before=structuredClone(f.db.items);
 const result=await f.create().reconcile(9001);
 assert.equal(result.status,"NATIVE_SALVAGE_SOLD_RECOVERED");
 assert.deepEqual(f.db.items,before);
 assert.equal(f.db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"SOLD");
 assert.equal(f.calls.filter(x=>x==="FinalizeNpcSellOrder").length,1);
 assert.deepEqual(f.calls,["GetNpcSellClaim","FinalizeNpcSellOrder","GetNpcSellClaim"]);
 assert.equal(f.commits(),1);
}));
test("paid native receipt without real corporation wallet journal never seals SOLD",()=>ready(async()=>{
 const f=fixture({salePaid:true,badWallet:true}),r=await f.create().reconcile(9001);
 assert.equal(r.phase,"NATIVE_RUST_WALLET_FILL_MISMATCH");
 assert.equal(f.commits(),0);
}));
test("SOLD journal never starts another native Rust market operation",()=>ready(async()=>{
 const f=fixture({salePaid:true});
 f.db.corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase="SOLD";
 assert.equal((await f.create().reconcile(9001)).status,"NATIVE_SALVAGE_ALREADY_SOLD");
 assert.equal(f.calls.length,0);
}));
test("recovery is default OFF; no market RPC even with a durable PREPARED journal",async()=>{
 const f=fixture(),before=process.env.EVEJS_COOP_SALVAGE_NATIVE_MARKET;
 process.env.EVEJS_COOP_SALVAGE_NATIVE_MARKET="0";
 try{assert.equal((await f.create().reconcile(9001)).reason,"SALVAGE_MARKET_DISABLED");
  assert.equal(f.calls.length,0)}finally{
  if(before===undefined)delete process.env.EVEJS_COOP_SALVAGE_NATIVE_MARKET;
  else process.env.EVEJS_COOP_SALVAGE_NATIVE_MARKET=before;
 }
});
