import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createCorporateSellFillSettlement}=
 require("../integration/coopPlayerMiningCorporateFillSettlement.cjs");
const {createMiningCorporatePnl}=
 require("../integration/coopPlayerMiningCorporatePnl.cjs");

// Real on-disk SQLite + original Node integration modules. The Rust witness
// below is a disk-persisted TEST DOUBLE, not a compiled Rust market daemon.
// This is NOT a live two-client EveJS test or evidence of playable trading.
const SEP="\u001f",ORDER="9521",CARGO=7773,ITEM=190003,TYPE=34,
 CORP=5001,EMPLOYER=9005,BUYER=8011,STATION=60001;
const SHIFT="coop-mining-shift:"+"a".repeat(32);
const TITLE="coop-mining-ore-title:v1:"+SHIFT+":"+CARGO;
const ESCROW=9200000000+Number(ORDER);
const NOW=1793030000000;
const TABLES=["items","corporationRuntime","characters","marketEscrow","identityState"];
const entry=(id,owner,other,amount,balance,ref=id)=>({
 transactionID:id,referenceID:ref,accountKey:1000,ownerID1:owner,
 ownerID2:other,amount:amount/100,balance:balance/100
});
const wallet=journal=>({
 balance:1000,journal:structuredClone(journal),transactions:structuredClone(journal)
});
function fixture(t,{lostCommitAck=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"corp-mining-durable-"));
 const file=path.join(dir,"gamestore.sqlite"),witnessFile=path.join(dir,"rust-test-double.json");
 const oldFlag=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";
 let db,writer,claim,dropAck=lostCommitAck;
 const get=(table,key)=>{
  const row=db.prepare('SELECT json FROM "'+table+'" WHERE key=?').get(String(key));
  return row?JSON.parse(row.json):null;
 };
 const put=(table,key,value)=>db.prepare(
  'INSERT INTO "'+table+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json'
 ).run(String(key),JSON.stringify(value));
 function open(){
  db=new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL");
  for(const table of TABLES)
   db.exec('CREATE TABLE IF NOT EXISTS "'+table+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  writer=createSqliteAdapter(()=>db).claimTransactor();
 }
 function close(){db.close();db=null;}
 t.after(()=>{
  if(db)close();
  if(oldFlag===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=oldFlag;
  fs.rmSync(dir,{recursive:true,force:true});
 });
 open();
 const wageA=entry(SHIFT,CORP,EMPLOYER,-300,99700);
 const wageB=entry(SHIFT,EMPLOYER,CORP,300,100300);
 const oreA=entry(TITLE,CORP,EMPLOYER,-800,98900);
 const oreB=entry(TITLE,EMPLOYER,CORP,800,101100);
 put("corporationRuntime","corporations"+SEP+CORP,{
  corporationID:CORP,wallet:{divisions:{"1000":{
   ...wallet([wageA,oreA]),balance:989
  }}}
 });
 put("corporationRuntime","corporations"+SEP+EMPLOYER,{
  corporationID:EMPLOYER,wallet:{divisions:{"1000":{
   ...wallet([wageB,oreB]),balance:1011
  }}}
 });
 put("corporationRuntime","coopPlayerMiningShift"+SEP+SHIFT,{
  version:1,status:"FUNDED",operationID:SHIFT,corporationID:CORP,
  employerCorpID:EMPLOYER,wageCents:300,buyerAfterCents:99700,
  employerAfterCents:100300
 });
 put("corporationRuntime","coopPlayerMiningOreTitle"+SEP+CARGO,{
  version:1,status:"COMMITTED",operationID:TITLE,shiftID:SHIFT,
  cargoID:CARGO,itemID:ITEM,typeID:TYPE,quantity:8,stationID:STATION,
  officeFolderID:64001,division:115,sourceCorpID:EMPLOYER,buyerCorpID:CORP,
  priceCents:800,buyerAfterCents:98900,sourceAfterCents:101100
 });
 put("corporationRuntime","coopPlayerMiningCorpSell"+SEP+CARGO,{
  version:1,phase:"ESCROW_BOUND_UNSETTLED",orderID:ORDER,operationID:SHIFT,
  itemID:ITEM,cargoID:CARGO,corporationID:CORP,stationID:STATION,
  typeID:TYPE,quantity:8,remainingQuantity:8,escrowLocationID:ESCROW
 });
 put("items",ITEM,{
  itemID:ITEM,ownerID:CORP,locationID:ESCROW,flagID:4,typeID:TYPE,
  quantity:8,stacksize:8,singleton:0,customInfo:"coop-warehouse:v1:cargo:"+CARGO
 });
 put("marketEscrow",ORDER,{
  orderId:ORDER,escrowType:"sell",isCorp:true,ownerId:CORP,
  typeId:TYPE,stationId:STATION,escrowLocationID:ESCROW,
  remainingQuantity:8,sourceItemIDs:[ITEM],phase:"ESCROW_BOUND_UNSETTLED"
 });
 put("characters",BUYER,{
  characterID:BUYER,balance:200,walletJournal:[],marketTransactions:[]
 });
 put("identityState","nextItemID",1990000001);
 fs.writeFileSync(witnessFile,"{}");
 const gameStore={
  read(table,rawPath){
   const parts=rawPath.split("/").filter(Boolean);
   const key=parts.join(SEP);
   let value=get(table,key);
   if(value===null&&table==="corporationRuntime"&&parts.length===1){
    const rows=db.prepare('SELECT key,json FROM "corporationRuntime" WHERE key LIKE ?')
     .all(parts[0]+SEP+"%");
    if(rows.length)value=Object.fromEntries(rows.map(row=>[
     row.key.slice(parts[0].length+1),JSON.parse(row.json)
    ]));
   }
   return value===null?{success:false,errorMsg:"ENTRY_NOT_FOUND"}:
    {success:true,data:value};
  },
  coopAtomicNativeRows:{
   mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
   transact(tables,fn){
    const result=writer.transact(tables,fn).result;
    if(dropAck){dropAck=false;throw Error("TEST_LOST_AFTER_DURABLE_COMMIT");}
    return result;
   }
  }
 };
 function setClaim(cycle,volumeBefore,quantity){
  claim={verifiedNative:true,phase:"claimed",state:"settling",
   source:"coop-corporation",is_corp:true,bid:false,orderID:ORDER,cycle,
   buyerCharacterID:BUYER,sellerCorpID:CORP,cargoID:CARGO,
   sourceItemID:ITEM,stationID:STATION,typeID:TYPE,
   volumeBefore,quantity,volumeAfter:volumeBefore-quantity,
   priceCents:250,escrowLocationID:ESCROW};
 }
 setClaim(1,8,3);
 function settlement(){
  return createCorporateSellFillSettlement({
   gameStore,enabled:()=>true,clock:()=>NOW,
   readNativeClaim:()=>claim,
   quoteNativeFees:()=>({
    verifiedNative:true,transactionTaxCents:30,brokerFeeCents:15
   })
  });
 }
 function recordTestDoubleRelease(r){
  const states=JSON.parse(fs.readFileSync(witnessFile,"utf8"));
  states[ORDER+":"+r.cycle]={
   verifiedNative:true,phase:"released",orderID:ORDER,cycle:r.cycle,
   nativeReceiptKey:r.receiptKey,
   ack:{phase:"released",receiptKey:r.receiptKey,
    volumeAfter:r.volumeAfter,verifiedGameStore:true}
  };
  fs.writeFileSync(witnessFile,JSON.stringify(states));
 }
 function crashCommitAndExit(){
  // Child is a NEW Node process. It commits to the same on-disk SQLite,
  // then exits immediately without closing the connection or sending an ACK.
  const source=[
   'const {DatabaseSync}=require("node:sqlite");',
   'const {createSqliteAdapter}=require(process.env.CORP_TEST_ATOMIC);',
   'const {createCorporateSellFillSettlement}=require(process.env.CORP_TEST_SETTLEMENT);',
   'const db=new DatabaseSync(process.env.CORP_TEST_SQLITE);',
   'const writer=createSqliteAdapter(()=>db).claimTransactor();',
   'const claim=JSON.parse(process.env.CORP_TEST_CLAIM);',
   'const gameStore={coopAtomicNativeRows:{mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,transact:(tables,fn)=>writer.transact(tables,fn).result}};',
   'const service=createCorporateSellFillSettlement({gameStore,enabled:()=>true,clock:()=>1793030000000,readNativeClaim:()=>claim,quoteNativeFees:()=>({verifiedNative:true,transactionTaxCents:30,brokerFeeCents:15})});',
   'const result=service.settle({orderID:claim.orderID,cycle:claim.cycle});',
   'if(result.phase!=="GAMESTORE_COMMITTED")process.exit(13);',
   'process.exit(77);'
  ].join("\n");
  const result=spawnSync(process.execPath,["-e",source],{
   env:{...process.env,CORP_TEST_SQLITE:file,
    CORP_TEST_ATOMIC:require.resolve("../integration/coopGameStoreAtomic.cjs"),
    CORP_TEST_SETTLEMENT:require.resolve(
     "../integration/coopPlayerMiningCorporateFillSettlement.cjs"),
    CORP_TEST_CLAIM:JSON.stringify(claim)},
   encoding:"utf8",timeout:20000
  });
  assert.equal(result.status,77,result.stderr||result.stdout);
 }
 function pnl(){
  return createMiningCorporatePnl({
   gameStore,enabled:()=>true,access:{
    isMember:()=>true,canIndustry:()=>true,canWallet:()=>true
   },findOriginalItemById:id=>get("items",id),
   readNativeReleased:async({orderID,cycle})=>
    JSON.parse(fs.readFileSync(witnessFile,"utf8"))[orderID+":"+cycle]
  });
 }
 const managerSession={characterID:8080,corporationID:CORP,
  socket:{destroyed:false}};
 const report=()=>pnl().inspect({
  session:managerSession,corporationID:CORP,operationID:SHIFT
 });
 return {get,close,open,settlement,setClaim,recordTestDoubleRelease,
  crashCommitAndExit,report,dropAck:()=>{dropAck=true},buyerSession:{characterID:BUYER},
  managerSession};
}
test("real SQLite partial sale, separate-process COMMIT crash, P&L and full sale conserve item and ISK",async t=>{
 const x=fixture(t);
 assert.notEqual(x.buyerSession.characterID,x.managerSession.characterID);
 const first=x.settlement().settle({orderID:ORDER,cycle:1});
 assert.equal(first.phase,"GAMESTORE_COMMITTED");
 x.recordTestDoubleRelease(first);
 x.close();x.open();
 const r1=await x.report();
 assert.equal(r1.status,"VERIFIED_REALIZED_MINING_PL");
 assert.equal(r1.realizedRevenueCents,705);
 assert.equal(r1.remainingOreInventoryCostCents,500);
 assert.equal(r1.netOperatingProfitCents,105);
 const snapshot=x.get("characters",BUYER).balance;
 const replay=x.settlement().settle({orderID:ORDER,cycle:1});
 assert.equal(replay.replayed,true);
 assert.equal(x.get("characters",BUYER).balance,snapshot);
 x.setClaim(2,5,5);
 x.close();
 x.crashCommitAndExit();
 x.open();
 const second=x.get("corporationRuntime",
  "coopPlayerMiningCorpFill"+SEP+ORDER+":2");
 assert.equal(second.phase,"GAMESTORE_COMMITTED");
 x.recordTestDoubleRelease(second);
 x.close();x.open();
 const r2=await x.report();
 assert.equal(r2.status,"VERIFIED_REALIZED_MINING_PL");
 assert.equal(r2.totalSoldOreUnits,8);
 assert.equal(r2.totalUnsoldOreUnits,0);
 assert.equal(r2.realizedRevenueCents,1910);
 assert.equal(r2.netOperatingProfitCents,810);
 assert.equal(r2.cashProfitCents,810);
 assert.equal(x.get("characters",BUYER).balance,180);
 assert.equal(x.get("corporationRuntime","corporations"+SEP+CORP)
  .wallet.divisions["1000"].balance,1008.10);
 assert.equal(x.get("items",ITEM).ownerID,BUYER);
 assert.equal(x.get("items",first.deliveredItemID).quantity,3);
 assert.equal(x.get("items",ITEM).quantity,5);
});
test("lost acknowledgement after actual SQLite COMMIT does not cause duplicate charge after restart",t=>{
 const x=fixture(t,{lostCommitAck:true});
 const unclear=x.settlement().settle({orderID:ORDER,cycle:1});
 assert.equal(unclear.reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
 const persisted=x.get("corporationRuntime",
  "coopPlayerMiningCorpFill"+SEP+ORDER+":1");
 assert.equal(persisted.phase,"GAMESTORE_COMMITTED");
 x.close();x.open();
 const balance=x.get("characters",BUYER).balance;
 const replay=x.settlement().settle({orderID:ORDER,cycle:1});
 assert.equal(replay.replayed,true);
 assert.equal(x.get("characters",BUYER).balance,balance);
 assert.equal(x.get("items",persisted.deliveredItemID).quantity,3);
 // Operator recovery still needs independent real Rust claim verification;
 // this backend test deliberately does not mark a Rust release as proven.
});
