import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createNpcPartialSettlement,TABLES}=require("../integration/coopNpcPartialFillAtomic.cjs");
const OWNER=1000010,STATION=60000001,TYPE=215,ITEM=1990000200,ORDER=456,BUYER=90000001;
const OP="npc-manufacture:0123456789abcdef0123456789abcdef";
const CLAIM1="npc-partial:11111111111111111111111111111111";
const CLAIM2="npc-partial:22222222222222222222222222222222";
const CORP_KEY="corporations\u001f"+OWNER;
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop047-partial-"));
 const file=path.join(dir,"native-gamestore.sqlite");
 let db=new DatabaseSync(file);
 for(const tbl of TABLES)db.exec('CREATE TABLE "'+tbl+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
  .run(String(k),JSON.stringify(v));
 const read=(t,k)=>{const x=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(String(k));return x?JSON.parse(x.json):null};
 put("characters",BUYER,{characterID:BUYER,balance:5000,walletJournal:[],marketTransactions:[]});
 put("corporationRuntime",CORP_KEY,{corporationID:OWNER,wallet:{divisions:{"1000":{
  balance:100,journal:[],transactions:[]}}}});
 put("items",ITEM,{itemID:ITEM,typeID:TYPE,ownerID:OWNER,
  locationID:9200000000+ORDER,flagID:4,singleton:0,categoryID:8,quantity:100,stacksize:100,
  customInfo:"coop-industry:v1:970000000000000"});
 put("identityState","nextItemID",1990000300);
 put("marketEscrow",ORDER,{orderId:String(ORDER),escrowType:"sell",isCorp:true,
  ownerId:OWNER,stationId:STATION,typeId:TYPE,sourceItemID:ITEM,coopOperationID:OP,
  remainingQuantity:100,escrowLocationID:9200000000+ORDER});
 let writer=createSqliteAdapter(()=>db).claimTransactor();
 let configured={claimKey:CLAIM1,fillID:910000000000001,quantity:20,remainingBefore:100};
 let stage="claimed";
 const claim=()=>({source:"coop-npc",state:stage==="claimed"?"settling":
  configured.remainingBefore===configured.quantity?"filled":"open",
  fill_phase:stage,operation_id:OP,claim_key:configured.claimKey,
  order_id:String(ORDER),source_item_id:String(ITEM),owner_id:OWNER,station_id:STATION,type_id:TYPE,
  buyer_id:String(BUYER),fill_id:String(configured.fillID),fill_quantity:configured.quantity,
  remaining_before:configured.remainingBefore,
  remaining_after:configured.remainingBefore-configured.quantity,
  price_cents:1200,is_corp:true,bid:false});
 let lost=false;
 const market={
  claimPartialOnce:async()=>claim(),
  finalizePartialOnce:async()=>{stage="finalized";
   if(lost){lost=false;throw Error("LOST_PARTIAL_FINAL_ACK");}
   return claim();},
  inspectPartialClaim:async()=>claim()
 };
 const settle=()=>createNpcPartialSettlement({gameStore:{
  transact:(tables,fn)=>writer.transact(tables,fn).result},
  market,verifyBuyerSession:()=>true,verifyNpcCorporation:()=>true,
  clock:()=>1761390000000});
 const buy=()=>settle().purchaseOnce({buyerID:BUYER,
  identity:{operationID:OP,claimKey:configured.claimKey,orderID:ORDER,
   ownerID:OWNER,stationID:STATION,typeID:TYPE,itemID:ITEM,quantity:configured.quantity},
  maxPriceCents:1200});
 const snapshot=()=>Object.fromEntries(TABLES.map(t=>
  [t,db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 return {read,put,buy,snapshot,get db(){return db},
  next:(qty,remaining=80)=>{configured={claimKey:CLAIM2,fillID:910000000000002,
    remainingBefore:remaining,quantity:qty};stage="claimed";},
  loseAck:()=>{lost=true},
  restart:()=>{db.close();db=new DatabaseSync(file);writer=createSqliteAdapter(()=>db).claimTransactor()},
  close:()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
async function run(fn){
 const keys=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF",
  "EVEJS_COOP_NATIVE_NPC_PARTIAL_FILL"],prev=keys.map(k=>process.env[k]);
 keys.forEach(k=>process.env[k]="1");const f=fixture();
 try{return await fn(f);}finally{
  f.close();keys.forEach((k,i)=>{if(prev[i]===undefined)delete process.env[k];else process.env[k]=prev[i];});
 }
}
test("real SQLite six-table split transfers exact quantity and ISK",()=>run(async f=>{
 const result=await f.buy();
 assert.equal(result.status,"PURCHASED_PARTIAL");
 assert.equal(f.read("items",ITEM).quantity,80);
 assert.equal(f.read("items",result.buyerItemID).quantity,20);
 assert.equal(f.read("items",result.buyerItemID).ownerID,BUYER);
 assert.equal(f.read("marketEscrow",ORDER).remainingQuantity,80);
 assert.equal(f.read("identityState","nextItemID"),1990000301);
 assert.equal(f.read("characters",BUYER).balance,4760);
 assert.equal(f.read("corporationRuntime",CORP_KEY).wallet.divisions["1000"].balance,340);
}));
test("SQLite restart and duplicate Rust partial claim never debit twice",()=>run(async f=>{
 await f.buy();const snap=f.snapshot();f.restart();
 assert.equal((await f.buy()).status,"PURCHASED_PARTIAL");
 assert.deepEqual(f.snapshot(),snap);
}));
test("terminal residual fill removes escrow and moves original item",()=>run(async f=>{
 await f.buy();f.next(80);
 const done=await f.buy();
 assert.equal(done.buyerItemID,ITEM);assert.equal(done.remainingQuantity,0);
 assert.equal(f.read("marketEscrow",ORDER),null);
 assert.equal(f.read("items",ITEM).ownerID,BUYER);
 assert.equal(f.read("items",1990000300).quantity,20);
}));
test("late missing-receipt-table fault cannot partially write native SQLite",()=>run(async f=>{
 f.db.exec('DROP TABLE "npcMarketFills"');
 const snap=Object.fromEntries(TABLES.filter(t=>t!=="npcMarketFills")
  .map(t=>[t,f.db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 await assert.rejects(f.buy(),/no such table/);
 const after=Object.fromEntries(TABLES.filter(t=>t!=="npcMarketFills")
  .map(t=>[t,f.db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 assert.deepEqual(after,snap);
}));
test("lost Rust ACK after SQLite COMMIT recovers with no duplicate split",()=>run(async f=>{
 f.loseAck();await assert.rejects(f.buy(),/LOST_PARTIAL_FINAL_ACK/);
 const snap=f.snapshot();f.restart();const r=await f.buy();
 assert.equal(r.status,"PURCHASED_PARTIAL");assert.deepEqual(f.snapshot(),snap);
}));
test("native buyer overdraft leaves all six tables unchanged",()=>run(async f=>{
 f.put("characters",BUYER,{...f.read("characters",BUYER),balance:1});
 const snap=f.snapshot();await assert.rejects(f.buy(),/INSUFFICIENT_ISK/);
 assert.deepEqual(f.snapshot(),snap);
}));
