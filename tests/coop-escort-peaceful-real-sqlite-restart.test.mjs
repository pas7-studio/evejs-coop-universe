import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createEscortNativeFunds,ESCROW_KEY}=require("../integration/coopEscortNativeFunds.cjs");
const {createPeacefulEscortSettlement}=require("../integration/coopEscortPeacefulSettlement.cjs");

// Disposable node:sqlite, actual COOP GameStore atomic writer and actual
// Escort dual-credit authority. Physical pilot/warehouse proof is a trusted
// fixture here; NOT an authenticated two-client full-game acceptance test.
const flags=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_ESCORT_WALLET",
 "EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT"];
const prev=flags.map(k=>process.env[k]);
for(const k of flags)process.env[k]="1";
const key="30000144-77-5501";
const contract={contractID:"escort-30000144-77-5501",manifestKey:key,
 corporationID:10001,amountISK:20000,characters:[701,702]};
const booking={...contract,systemID:30000144,fleetID:77,haulerID:901,
 stationID:60001,playerFleetID:44};
const stock={status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",key,
 stationID:60001,haulerIDs:[901],cargoIDs:[5501,5502],stacks:2,quantity:50};
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-escort-peaceful-db-"));
 const filename=path.join(dir,"game.sqlite");
 let db=new DatabaseSync(filename),writer;
 const init=()=>{
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  writer=createSqliteAdapter(()=>db).claimTransactor();
 };
 db.exec('CREATE TABLE "corporationRuntime"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 db.exec('CREATE TABLE "characters"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,value)=>db.prepare('INSERT INTO "'+t+'" (key,json) VALUES(?,?)')
  .run(String(k),JSON.stringify(value));
 put("corporationRuntime","corporations\u001f10001",{wallet:{divisions:{"1000":{
  key:1000,balance:50000,journal:[],transactions:[]}}}});
 for(const id of [701,702])put("characters",id,{
  characterID:id,balance:500,balanceChange:0,walletJournal:[]});
 init();
 let proof=true;
 const atomicRows={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(tables,fn)=>writer.transact(tables,fn).result};
 const funds=()=>createEscortNativeFunds({atomicRows,
  isNpcCorporation:id=>id===10001,clock:()=>2000000});
 const service=(authority=funds())=>createPeacefulEscortSettlement({
  nativeFunds:authority,
  readFlight:()=>({status:"READY",phase:"DELIVERED",booking,
   delivery:{status:"DELIVERED",terminal:true,nativeFullManifestProof:stock}}),
  readNativeDelivery:()=>proof?{status:"DELIVERED",terminal:true,
   nativeFullManifestProof:stock}:{status:"DELIVERY_NOT_FOUND"},
  verifyService:()=>proof?{status:"VERIFIED_NATIVE_ESCORT_SERVICE",
   characters:[701,702],fleetID:44,haulerID:901,systemID:30000144}:
   {status:"NATIVE_SERVICE_NOT_VERIFIED"}
 });
 const read=(t,k)=>{
  const row=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(String(k));
  return row?JSON.parse(row.json):null;
 };
 const snapshot=()=>({
  corp:read("corporationRuntime","corporations\u001f10001"),
  escrow:read("corporationRuntime",ESCROW_KEY),
  a:read("characters",701),b:read("characters",702)
 });
 return {funds,service,snapshot,setProof:v=>{proof=v},
  restart:()=>{db.close();db=new DatabaseSync(filename);init()},
  close:()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
function run(fn){const f=fixture();try{fn(f)}finally{f.close()}}
test("actual native SQLite reserve and both pilot credits survive real DB reopen without second payout",()=>run(f=>{
 f.funds().reserveAtomic(contract);
 assert.equal(f.snapshot().corp.wallet.divisions["1000"].balance,30000);
 assert.equal(f.service().settle(key,null).status,"NATIVE_PEACEFUL_ESCORT_PAID");
 const first=f.snapshot();
 assert.equal(first.a.balance,10500);
 assert.equal(first.b.balance,10500);
 assert.equal(first.escrow.byContract[contract.contractID].status,"SETTLED");
 f.restart();
 assert.equal(f.service().settle(key,null).status,"ALREADY_NATIVE_PAID");
 assert.deepEqual(f.snapshot(),first);
 assert.equal(30000+10500+10500,50000+500+500);
}));
test("SQLite COMMIT followed by lost settlement ACK only reports ALREADY_NATIVE_PAID",()=>run(f=>{
 const actual=f.funds();actual.reserveAtomic(contract);
 const lostAck={...actual,settleAtomic:request=>{
  actual.settleAtomic(request);throw Error("ACK_LOST_AFTER_SQLITE_COMMIT");
 }};
 assert.equal(f.service(lostAck).settle(key,null).status,"ALREADY_NATIVE_PAID");
 const first=f.snapshot();f.restart();
 assert.equal(f.service().settle(key,null).status,"ALREADY_NATIVE_PAID");
 assert.deepEqual(f.snapshot(),first);
}));
test("absent native warehouse/service proof never spends genuinely reserved escrow",()=>run(f=>{
 f.funds().reserveAtomic(contract);
 const before=f.snapshot();f.setProof(false);
 assert.notEqual(f.service().settle(key,null).status,"NATIVE_PEACEFUL_ESCORT_PAID");
 assert.deepEqual(f.snapshot(),before);
 f.restart();assert.deepEqual(f.snapshot(),before);
}));
test("wallet flag disabled denies even an otherwise payable durable flight",()=>run(f=>{
 f.funds().reserveAtomic(contract);const before=f.snapshot();
 process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET="0";
 try{
  assert.equal(f.service().settle(key,null).status,"NATIVE_FUNDS_NOT_ATOMIC");
  assert.deepEqual(f.snapshot(),before);
 }finally{process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET="1"}
}));
process.on("exit",()=>{flags.forEach((k,i)=>{
 if(prev[i]===undefined)delete process.env[k];else process.env[k]=prev[i];
})});
