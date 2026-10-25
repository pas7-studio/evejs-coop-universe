import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createNpcCorporateBuyer,TABLES}=require("../integration/coopNpcCorporateBuyerAtomic.cjs");
const BUYER=1000010,SELLER=90000001,STATION=60000001,TYPE=215,ORDER=456,ITEM=1990000200;
const FILL=930000000000001,KEY="npc-corpbuy:0123456789abcdef0123456789abcdef";
const CKEY="corporations\u001f"+BUYER;
const REQ={claimKey:KEY,buyerCorpID:BUYER,sellerID:SELLER,
 stationID:STATION,typeID:TYPE,orderID:ORDER,quantity:20,
 maxUnitPriceCents:125,minReserveCents:10000};
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop048-corp-buy-")),
  dbpath=path.join(dir,"gamestore.sqlite");
 let db=new DatabaseSync(dbpath);
 for(const t of TABLES)db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
  .run(String(k),JSON.stringify(v));
 const read=(t,k)=>{
  const row=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(String(k));
  return row?JSON.parse(row.json):null;
 };
 put("corporationRuntime",CKEY,{corporationID:BUYER,wallet:{divisions:{"1000":{
  balance:1000,journal:[],transactions:[]}}}});
 put("characters",SELLER,{characterID:SELLER,balance:100,
  walletJournal:[],marketTransactions:[]});
 put("items",ITEM,{itemID:ITEM,ownerID:SELLER,
  locationID:9200000000+ORDER,flagID:4,categoryID:8,
  typeID:TYPE,singleton:0,quantity:20,stacksize:20});
 put("marketEscrow",ORDER,{orderId:String(ORDER),escrowType:"sell",isCorp:false,
  ownerId:SELLER,stationId:STATION,typeId:TYPE,
  remainingQuantity:20,escrowLocationID:9200000000+ORDER});
 let writer=createSqliteAdapter(()=>db).claimTransactor();
 let phase="claimed",rustState="settling",dropAck=false;
 const claim=()=>({source:"player",state:rustState,fill_phase:phase,is_corp:false,bid:false,
  claim_key:KEY,fill_id:String(FILL),order_id:String(ORDER),
  owner_id:String(SELLER),buyer_corp_id:String(BUYER),quantity:20,
  station_id:STATION,type_id:TYPE,price_cents:125,
  vol_remaining:rustState==="filled"?0:20});
 const market={
  claimOnce:async()=>claim(),
  finalizeOnce:async()=>{phase="finalized";rustState="filled";
   if(dropAck){dropAck=false;throw Error("RUST_ACK_LOST")}
   return claim()},
  inspectClaim:async()=>claim()
 };
 const settlement=()=>createNpcCorporateBuyer({
  gameStore:{transact:(tables,fn)=>writer.transact(tables,fn).result},
  market,verifyBuyerCorporation:()=>true,verifyPlayerSeller:()=>true,
  quoteSellerTax:({sellerID,stationID,grossCents})=>({sellerID,stationID,grossCents,
   taxCents:Math.round(grossCents*0.08),policy:"EVEJS_NATIVE_MARKET_RULES"}),
  clock:()=>1761390000000
 });
 const buy=()=>settlement().purchaseOnce(REQ);
 const snapshot=()=>Object.fromEntries(TABLES.map(t=>[t,
  db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 return {buy,read,put,snapshot,get db(){return db},
  loseAck:()=>{dropAck=true},
  restart:()=>{db.close();db=new DatabaseSync(dbpath);
   writer=createSqliteAdapter(()=>db).claimTransactor()},
  close:()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
async function run(callback){
 const names=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NPC_BUY_PLAYER_ASK"],
  previous=names.map(k=>process.env[k]);
 names.forEach(k=>process.env[k]="1");
 const f=fixture();
 try{return await callback(f)}
 finally{f.close();names.forEach((k,i)=>{
  if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];
 })}
}
test("native real SQLite purchase transfers one player item and exactly 25 ISK",()=>run(async f=>{
 const result=await f.buy();
 assert.equal(result.status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.equal(f.read("items",ITEM).ownerID,BUYER);
 assert.equal(f.read("items",ITEM).locationID,STATION);
 assert.equal(f.read("marketEscrow",ORDER),null);
 assert.equal(f.read("corporationRuntime",CKEY).wallet.divisions["1000"].balance,975);
 assert.equal(f.read("characters",SELLER).balance,123);
 assert.equal(f.read("characters",SELLER).walletJournal.length,2);
 assert.equal(f.read("npcMarketFills","corp-buy\u001f"+FILL).taxCents,200);
 assert.equal(f.read("npcMarketFills","corp-buy\u001f"+FILL).itemID,ITEM);
}));
test("SQLite connection restart replays completed Rust claim without extra debit",()=>run(async f=>{
 await f.buy();const before=f.snapshot();f.restart();
 assert.equal((await f.buy()).status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.deepEqual(f.snapshot(),before);
}));
test("lost Rust finalize ACK after SQLite COMMIT never reissues the item",()=>run(async f=>{
 f.loseAck();
 await assert.rejects(f.buy(),/RUST_ACK_LOST/);
 const after=f.snapshot();f.restart();
 assert.equal((await f.buy()).status,"NPC_PURCHASED_PLAYER_GOODS");
 assert.deepEqual(f.snapshot(),after);
}));
test("insufficient corporation wallet funds rollback all five tables",()=>run(async f=>{
 f.put("corporationRuntime",CKEY,{...f.read("corporationRuntime",CKEY),
  wallet:{divisions:{"1000":{balance:1,journal:[],transactions:[]}}}});
 const before=f.snapshot();
 await assert.rejects(f.buy(),/ISK_RESERVE_OR_FUNDS_EXCEEDED/);
 assert.deepEqual(f.snapshot(),before);
}));
test("missing native receipt table cannot leave a half-committed purchase",()=>run(async f=>{
 f.db.exec('DROP TABLE "npcMarketFills"');
 const names=TABLES.filter(t=>t!=="npcMarketFills");
 const snapshot=()=>Object.fromEntries(names.map(t=>[t,
  f.db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 const before=snapshot();
 await assert.rejects(f.buy(),/no such table/);
 assert.deepEqual(snapshot(),before);
}));
