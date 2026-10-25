import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createNpcCorporateSettlement,TABLES}=require("../integration/coopNpcCorporateSettlement.cjs");
const OP="npc-manufacture:0123456789abcdef0123456789abcdef";
const OWNER=1000010,STATION=60000001,ITEM=1990000200,ORDER=456,BUYER=90000001,FILL=900000000000001;
const IDENTITY={operationID:OP,orderID:ORDER,ownerID:OWNER,stationID:STATION,
 typeID:215,itemID:ITEM,quantity:100};
const ROW="corporations\u001f"+OWNER, RECEIPT="order\u001f"+ORDER;
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir,"coop035-native-sqlite-")),filepath=path.join(dir,"gamestore.sqlite");
 let db=new DatabaseSync(filepath);
 for(const table of TABLES)db.exec('CREATE TABLE "'+table+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,key,value)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
  .run(String(key),JSON.stringify(value));
 const read=(t,key)=>{const row=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(String(key));return row?JSON.parse(row.json):null};
 put("characters",BUYER,{characterID:BUYER,balance:1200,walletJournal:[],marketTransactions:[]});
 put("corporationRuntime",ROW,{corporationID:OWNER,wallet:{divisions:{"1000":{
   key:1000,balance:100,journal:[],transactions:[]}}}});
 put("items",ITEM,{itemID:ITEM,ownerID:OWNER,locationID:9200000000+ORDER,
   flagID:4,singleton:0,quantity:100,stacksize:100,typeID:215,customInfo:"coop-industry:v1:970000000000000"});
 put("marketEscrow",ORDER,{orderId:String(ORDER),escrowType:"sell",isCorp:true,
   ownerId:OWNER,stationId:STATION,sourceItemID:ITEM,coopOperationID:OP,
   remainingQuantity:100,escrowLocationID:9200000000+ORDER});
 let writer=createSqliteAdapter(()=>db).claimTransactor();
 let finalizeFailure=false,finalizeCalls=0;
 const order=()=>({source:"coop-npc",state:"settling",operation_id:OP,order_id:String(ORDER),
  source_item_id:String(ITEM),owner_id:OWNER,station_id:STATION,type_id:215,
  quantity:100,buyer_id:String(BUYER),fill_id:String(FILL),price_cents:1200,is_corp:true,bid:false});
 let rustState="open";
 const market={
  claimOnce:async()=>{if(rustState==="open")rustState="settling";return{...order(),state:rustState}},
  finalizeOnce:async()=>{rustState="filled";finalizeCalls++;
   if(finalizeFailure){finalizeFailure=false;throw Error("RUST_ACK_LOST")}
   return{state:"filled",order_id:String(ORDER),buyer_id:String(BUYER),
    fill_id:String(FILL),vol_remaining:0}},
  inspectClaim:async()=>({state:rustState,fill_id:String(FILL),buyer_id:String(BUYER)})
 };
 const settlement=()=>createNpcCorporateSettlement({gameStore:{transact:(tables,fn)=>writer.transact(tables,fn).result},
  market,verifyBuyerSession:()=>true,verifyNpcCorporation:()=>true,clock:()=>1761390000000});
 const snapshot=()=>Object.fromEntries(TABLES.map(t=>[t,db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 return {get db(){return db},read,put,market,snapshot,settlement,
  get finalized(){return finalizeCalls},
  failFinalize(){finalizeFailure=true},
  restart(){db.close();db=new DatabaseSync(filepath);writer=createSqliteAdapter(()=>db).claimTransactor()},
  close(){db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
async function run(fn){
 const a=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS,b=process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF;
 const f=fixture();
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF="1";
 try{return await fn(f)}finally{
  if(a===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=a;
  if(b===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF;else process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF=b;
  f.close();
 }
}
test("real SQLite commits exactly five native tables, conserved ISK and existing item",()=>run(async f=>{
 const result=await f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200});
 assert.equal(result.status,"PURCHASED");
 assert.equal(f.read("characters",BUYER).balance,0);
 assert.equal(f.read("corporationRuntime",ROW).wallet.divisions["1000"].balance,1300);
 assert.equal(f.read("items",ITEM).ownerID,BUYER);
 assert.equal(f.read("items",ITEM).locationID,STATION);
 assert.equal(f.read("marketEscrow",ORDER),null);
 assert.equal(f.read("npcMarketFills",RECEIPT).phase,"NATIVE_COMMITTED");
 assert.equal(f.read("characters",BUYER).walletJournal.length,1);
 assert.equal(f.read("corporationRuntime",ROW).wallet.divisions["1000"].journal.length,1);
}));
test("a complete process-level SQLite connection restart preserves the one-time receipt",()=>run(async f=>{
 const first=await f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200});
 assert.equal(first.status,"PURCHASED");const snap=f.snapshot();
 f.restart();
 const again=await f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200});
 assert.equal(again.status,"PURCHASED");assert.deepEqual(f.snapshot(),snap);
 assert.equal(f.finalized,2);
}));
test("missing buyer wallet funds rolls back all five real SQLite tables",()=>run(async f=>{
 f.put("characters",BUYER,{...f.read("characters",BUYER),balance:1});const before=f.snapshot();
 await assert.rejects(f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200}),
  /INSUFFICIENT_FUNDS/);
 assert.deepEqual(f.snapshot(),before);
}));
test("lost Rust finalize ACK after durable five-table COMMIT recovers after SQLite restart",()=>run(async f=>{
 f.failFinalize();
 await assert.rejects(f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200}),
  /RUST_ACK_LOST/);
 const committed=f.snapshot();f.restart();
 const second=await f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200});
 assert.equal(second.status,"PURCHASED");assert.deepEqual(f.snapshot(),committed);
 assert.equal(f.read("characters",BUYER).walletJournal.length,1);
}));
test("foreign source-item custody blocks all wallet changes in a real SQLite transaction",()=>run(async f=>{
 f.put("items",ITEM,{...f.read("items",ITEM),ownerID:999});const snap=f.snapshot();
 await assert.rejects(f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200}),
  /OUTPUT_CUSTODY_INVALID/);assert.deepEqual(f.snapshot(),snap);
}));
test("unregistered receipt table prevents an unsafe partial native commit",()=>run(async f=>{
 f.db.exec('DROP TABLE "npcMarketFills"');
 const snap=Object.fromEntries(TABLES.filter(t=>t!=="npcMarketFills")
  .map(t=>[t,f.db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 await assert.rejects(f.settlement().purchaseOnce({buyerID:BUYER,identity:IDENTITY,maxPriceCents:1200}),
  /no such table/);
 const after=Object.fromEntries(TABLES.filter(t=>t!=="npcMarketFills")
  .map(t=>[t,f.db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 assert.deepEqual(after,snap);
}));
