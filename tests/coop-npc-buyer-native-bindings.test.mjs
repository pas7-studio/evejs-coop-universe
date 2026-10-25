import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeNpcBuyerBindings}=require("../integration/coopNpcBuyerNativeBindings.cjs");
const OWNER=1000010,SELLER=90000001,STATION=60000001,REGION=10000002;
const ITEM=1990000200,ORDER=456,FILL=930000000000001,TYPE=34;
const CKEY="corporations\u001f"+OWNER;
async function run(fn,{buyerISK=1000,stale=false,foreign=false,duplicate=false,
 noMaterial=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop049-binding-"));
 const file=path.join(dir,"buyer-journal.json");
 const tables={
  corporations:{["records\u001f"+OWNER]:{corporationID:OWNER,isNPC:true}},
  corporationRuntime:{[CKEY]:{corporationID:OWNER,wallet:{divisions:{"1000":{
   balance:buyerISK,journal:[],transactions:[]}}}}},
  characters:{[SELLER]:{characterID:SELLER,balance:100,walletJournal:[],marketTransactions:[]}},
  items:{[ITEM]:{itemID:ITEM,ownerID:SELLER,typeID:TYPE,
   quantity:20,stacksize:20,categoryID:8,flagID:4,singleton:0,
   locationID:9200000000+ORDER},
   999:{itemID:999,ownerID:OWNER,typeID:TYPE,quantity:stale?12:10,
   stacksize:stale?12:10,categoryID:8,flagID:4,singleton:0,locationID:STATION}},
  marketEscrow:{[ORDER]:{orderId:String(ORDER),escrowType:"sell",isCorp:false,
   ownerId:foreign?SELLER+1:SELLER,stationId:STATION,typeId:TYPE,
   remainingQuantity:20,escrowLocationID:9200000000+ORDER}},
  npcMarketFills:{}
 };
 if(duplicate)tables.items[ITEM+1]={...tables.items[ITEM],itemID:ITEM+1};
 const dbRead=(table,key)=>{
  const k=key.split("/").filter(Boolean).join("\u001f");
  const data=tables[table]?.[k];
  return data==null?{success:false}:{success:true,data};
 };
 const gameStore={
  read:dbRead,
  coopAtomicNativeRows:{
   transact:(names,fn)=>{
    const before=structuredClone(tables);
    try{return fn({get:(t,k)=>tables[t]?.[k]??null,
     put:(t,k,v)=>{tables[t][k]=v},
     del:(t,k)=>{delete tables[t][k]},
     scan:t=>Object.entries(tables[t]).map(([key,value])=>({key,value}))})}
    catch(e){for(const key of Object.keys(tables))tables[key]=before[key];throw e}
   }}
 };
 const itemStore={
  listOwnedItems:id=>Object.values(tables.items).filter(i=>i.ownerID===id),
  findItemById:id=>tables.items[id]||null
 };
 let stage="open",phase=null,loss=false,claims=0,orderPrice=1.25;
 let getOrderCalls=0;
 // Actual Rust GetOrders returns public OrderRow without owner.
 const publicOrder=()=>({source:"player",order_id:String(ORDER),
  bid:false,station_id:STATION,region_id:REGION,type_id:TYPE,
  vol_remaining:stage==="filled"?0:20,price:orderPrice});
 // GetOrder returns OwnerOrderRow with nested .row and owner metadata.
 const ownerOrder=()=>({source:"player",is_corp:false,state:stage,
  owner_id:String(SELLER),row:publicOrder()});
 const call=async(method,args)=>{
  if(method==="GetOrders")return {sells:[publicOrder()]};
  if(method==="GetOrder"){getOrderCalls++;return ownerOrder();}
  if(method==="ClaimNpcCorpPlayerSell"){
   claims++;if(stage==="open"){stage="settling";phase="claimed";}
   return {source:"player",state:stage,fill_phase:phase,is_corp:false,bid:false,
    claim_key:args.claim_key,fill_id:String(FILL),order_id:String(ORDER),
    buyer_corp_id:String(OWNER),owner_id:String(SELLER),quantity:20,
    station_id:STATION,type_id:TYPE,price_cents:125};
  }
  if(method==="FinalizeNpcCorpPlayerSell"){
   stage="filled";phase="finalized";
   if(loss){loss=false;throw Error("LOST_RUST_FINAL_ACK")}
   return {state:stage,fill_phase:phase,fill_id:String(FILL),
    vol_remaining:0,history_recorded:phase==="finalized",history_day:"2026-10-25"};
  }
  if(method==="GetNpcCorpPlayerClaim")
   return {state:stage,fill_phase:phase,fill_id:String(FILL),
    vol_remaining:0,history_recorded:phase==="finalized",history_day:"2026-10-25"};
  throw Error("UNEXPECTED_RPC:"+method);
 };
 const raw=Object.freeze({ownerID:OWNER,stationID:STATION,typeID:TYPE,
  required:80,available:10,shortage:70,observedAt:1000000,
  authoritativeNative:true});
 const env={EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1"};
 const bridge=createNativeNpcBuyerBindings({file,gameStore,itemStore,
  marketClient:{call},clock:()=>1000000,env,
  marketRules:{getMarketContext:({characterID,stationID})=>({
   characterID,stationID,limits:{acc:0.08}}),
   computeSalesTaxAmount:(ctx,gross)=>Math.round(gross*ctx.limits.acc*100)/100},
  getStation:()=>({stationID:STATION,regionID:REGION}),
  resolveActor:async()=>({nativeVerified:true,isNpc:true,role:"trader",
   corporationID:OWNER,stationID:STATION,pilotID:"coop-pilot-100",
   playerControlled:false,underAttack:false,inWarp:false,activeNativeOrder:false}),
  readNeeds:()=>noMaterial?null:raw});
 const tick=()=>bridge.tick({actorID:100,buyerCorpID:OWNER,stationID:STATION,
  typeID:TYPE,maxUnitPriceCents:125,maxSpendCents:10000,minReserveCents:1000});
 const originals=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NPC_BUY_PLAYER_ASK"];
 const previous=originals.map(k=>process.env[k]);originals.forEach(k=>process.env[k]="1");
 try{return await fn({tick,tables,bridge,load:()=>fs.existsSync(file)?
  JSON.parse(fs.readFileSync(file,"utf8")):null,
  failNext:()=>{loss=true},price:v=>{orderPrice=v},
  get claims(){return claims},get getOrderCalls(){return getOrderCalls}})}
 finally{
  originals.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];
   else process.env[k]=previous[i]});
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
test("native GameStore+Rust witness closes actual physical NPC purchase",()=>run(async f=>{
 const r=await f.tick();
 assert.equal(r.status,"NPC_PLAYER_PURCHASE_SETTLED");
 assert.equal(f.tables.items[ITEM].ownerID,OWNER);
 assert.equal(f.tables.items[ITEM].locationID,STATION);
 assert.equal(f.tables.corporationRuntime[CKEY].wallet.divisions["1000"].balance,975);
 assert.equal(f.tables.characters[SELLER].balance,123);
 assert.equal(f.tables.npcMarketFills["corp-buy\u001f"+FILL].taxCents,200);
 assert.equal(f.tables.marketEscrow[ORDER],undefined);
 assert.equal(f.tables.npcMarketFills["corp-buy\u001f"+FILL].fillID,FILL);
 assert.equal(f.claims,1);
 assert.ok(f.getOrderCalls>=2);
}));
test("stale recipe quantity versus real GameStore stock fails closed",()=>run(async f=>{
 await assert.rejects(f.tick(),/MATERIAL_SHORTAGE_STALE/);
 assert.equal(f.claims,0);
},{stale:true}));
test("Rust seller escrow owned by wrong player never accepted",()=>run(async f=>{
 const r=await f.tick();
 assert.equal(r.status,"BLOCKED");
 assert.equal(f.claims,0);
},{foreign:true}));
test("multiple different player stacks in one escrow cannot be bought by strict authority",()=>run(async f=>{
 const r=await f.tick();
 assert.equal(r.status,"BLOCKED");
 assert.equal(f.claims,0);
},{duplicate:true}));
test("native corporation without spendable ISK does not reach Rust claim",()=>run(async f=>{
 const r=await f.tick();
 assert.equal(r.reason,"NPC_BUY_NO_SPENDABLE_ISK");
 assert.equal(f.claims,0);
},{buyerISK:0}));
test("SDE material proof is mandatory, no synthetic item demand",()=>run(async f=>{
 await assert.rejects(f.tick(),/NATIVE_SDE_DEFICIT_NOT_VERIFIED/);
 assert.equal(f.claims,0);
},{noMaterial:true}));
test("lost Rust finalize ACK recovers from same durable GameStore receipt",()=>run(async f=>{
 f.failNext();await assert.rejects(f.tick(),/LOST_RUST_FINAL_ACK/);
 const original=f.load().entries[OWNER+":"+ORDER];
 assert.equal(original.phase,"PREPARED");
 const r=await f.tick();
 assert.equal(r.status,"NPC_PLAYER_PURCHASE_SETTLED");
 assert.equal(f.load().entries[OWNER+":"+ORDER].claimKey,original.claimKey);
 assert.equal(f.tables.characters[SELLER].walletJournal.length,2);
 assert.equal(f.claims,2);
}));
