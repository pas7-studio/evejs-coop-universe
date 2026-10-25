import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createAtomicMiningSettler}=require("../integration/coopNativeMiningAtomic.cjs");
const SEP="\u001f",SYSTEM=30000144,ROCK=41,SHIP=2001,OWNER=17,ORE=34;
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"alife07-sqlite-"));
 const file=path.join(root,"game.sqlite");
 let db=new DatabaseSync(file);
 db.exec("PRAGMA journal_mode = WAL");
 for(const table of ["miningRuntimeState","npcCargo"])
  db.exec('CREATE TABLE "'+table+'" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
 db.prepare('INSERT INTO "npcCargo"(key,json) VALUES (?,?)').run("cargo","{}");
 const previous={...process.env};
 for(const [name,value] of Object.entries({
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
  EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY:"1",
  EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION:"1",
  EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC:"1",
 }))process.env[name]=value;
 t.after(()=>{
  try{db.close()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
  for(const name of ["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY",
    "EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION","EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC"]){
   if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];
  }
 });
 const writer=createSqliteAdapter(()=>db).claimTransactor();
 const read=(table,key)=>{
  const row=db.prepare('SELECT json FROM "'+table+'" WHERE key=?').get(key);
  return row?JSON.parse(row.json):null;
 };
 let nextCargo=900001;
 const gameStore={
  coopAtomicNativeRows:{transact(tables,mutation){return writer.transact(tables,mutation).result;}},
  read(table,p){
   const match=/^\/systems\/(\d+)\/entities\/(\d+)$/.exec(p);
   if(!match||table!=="miningRuntimeState")return{success:false};
   const record=read(table,"systems"+SEP+match[1])?.entities?.[match[2]];
   return{success:!!record,data:record||null};
  }
 };
 const nativeStore={
  allocateCargoID(){return{success:true,data:nextCargo++}},
  listNativeCargoForEntity(id){return Object.values(read("npcCargo","cargo")||{})
    .filter(x=>Number(x.entityID)===id)}
 };
 const asteroid={itemID:ROCK};
 const scene={systemID:SYSTEM,getEntityByID:id=>id===ROCK?asteroid:null};
 const miner={itemID:SHIP,ownerID:OWNER,transient:false,nativeCargoItems:[]};
 let liveState={entityID:ROCK,yieldTypeID:ORE,originalQuantity:100,
  remainingQuantity:100,originalRadius:100,unitVolume:0.1,updatedAtMs:1};
 let visualCount=0;
 const settler=createAtomicMiningSettler({gameStore,nativeStore,
  resolveType:id=>({typeID:id,groupID:465,categoryID:25,name:"Veldspar",volume:0.1})});
 const input={scene,entity:miner,targetEntity:asteroid,
  mineableState:{...liveState},miningResult:{normalQuantity:7,wastedQuantity:1},
  transferredQuantity:7,cycleBoundaryMs:1700000000000,moduleItem:{itemID:99001},
  readState:()=>liveState,
  commitScene:()=>{visualCount++;liveState={...liveState,remainingQuantity:liveState.remainingQuantity-8};
   return{success:true,data:{depleted:false}}}
 };
 return {db:()=>db,file,read,input,settler,gameStore,asteroid,miner,
  setSceneState:state=>liveState={...liveState,...state},
  getSceneState:()=>liveState,visualCount:()=>visualCount,
  reopen:()=>{db.close();db=new DatabaseSync(file);db.exec("PRAGMA journal_mode=WAL");},
  source:()=>read("miningRuntimeState","systems"+SEP+SYSTEM)?.entities?.[ROCK],
  cargo:()=>Object.values(read("npcCargo","cargo")||{}),
  receipts:()=>db.prepare('SELECT key,json FROM "miningRuntimeState" WHERE key LIKE ?').all("coopMiningCycle:%")
 };
}
test("one physical-like SQLite transaction persists source, cargo and immutable receipt",t=>{
 const f=fixture(t),result=f.settler.settle(f.input);
 assert.equal(result.success,true);
 assert.equal(f.source().remainingQuantity,92);
 assert.equal(f.cargo()[0].quantity,7);
 assert.equal(f.receipts().length,1);
 assert.equal(f.miner.nativeCargoItems[0].itemID,f.cargo()[0].cargoID);
 assert.equal(f.db().prepare("PRAGMA synchronous").get().synchronous,2);
});
test("a committed transaction survives close and reopen with same native itemID",t=>{
 const f=fixture(t);assert.equal(f.settler.settle(f.input).success,true);
 const id=f.cargo()[0].cargoID;
 f.reopen();
 assert.equal(f.source().remainingQuantity,92);
 assert.equal(f.cargo()[0].cargoID,id);
 assert.equal(f.receipts().length,1);
});
test("exact same operation replays receipt and never mines a second time",t=>{
 const f=fixture(t);assert.equal(f.settler.settle(f.input).success,true);
 const again=f.settler.settle(f.input);
 assert.equal(again.success,true);assert.equal(again.receipt.replayed,true);
 assert.equal(f.source().remainingQuantity,92);
 assert.equal(f.cargo()[0].quantity,7);
 assert.equal(f.visualCount(),1);
 assert.equal(f.receipts().length,1);
});
test("next real cycle increases original stack and never creates a second cargo ID",t=>{
 const f=fixture(t);assert.equal(f.settler.settle(f.input).success,true);
 f.input.mineableState={...f.getSceneState()};
 f.input.cycleBoundaryMs++;
 assert.equal(f.settler.settle(f.input).success,true);
 assert.equal(f.source().remainingQuantity,84);
 assert.equal(f.cargo().length,1);
 assert.equal(f.cargo()[0].quantity,14);
 assert.equal(f.receipts().length,2);
});
test("SQLite trigger failure rolls back rock, cargo and receipt in one unit",t=>{
 const f=fixture(t);
 f.db().exec('CREATE TRIGGER fail_cargo BEFORE UPDATE ON "npcCargo" WHEN NEW.key="cargo" BEGIN SELECT RAISE(ABORT,"CARGO_FAIL"); END;');
 const result=f.settler.settle(f.input);
 assert.equal(result.success,false);
 assert.equal(f.source(),undefined);
 assert.equal(f.cargo().length,0);
 assert.equal(f.receipts().length,0);
 assert.equal(f.getSceneState().remainingQuantity,100);
});
test("same rock second miner with stale preimage cannot overdraw after first commit",t=>{
 const f=fixture(t);
 assert.equal(f.settler.settle(f.input).success,true);
 const competitor={...f.input,entity:{itemID:SHIP+1,ownerID:OWNER,
  transient:false,nativeCargoItems:[]},moduleItem:{itemID:99002},
  cycleBoundaryMs:f.input.cycleBoundaryMs+1,readState:()=>({...f.getSceneState(),remainingQuantity:100})};
 const result=f.settler.settle(competitor);
 assert.equal(result.success,false);
 assert.equal(f.source().remainingQuantity,92);
 assert.equal(f.cargo().length,1);
});
test("transient NPC never receives persistent cargo without restartable identity",t=>{
 const f=fixture(t);f.miner.transient=true;
 const r=f.settler.settle(f.input);
 assert.equal(r.success,false);assert.equal(r.reason,"ALIFE07_PERSISTENT_NPC_REQUIRED");
 assert.equal(f.source(),undefined);assert.equal(f.cargo().length,0);
});
test("missing flags abort before original cargo allocator or SQLite writes",t=>{
 const f=fixture(t);delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 const r=f.settler.settle(f.input);
 assert.equal(r.success,false);
 assert.equal(f.source(),undefined);assert.equal(f.cargo().length,0);
});
test("source preimage changes in SQLite cannot be overwritten by stale scene snapshot",t=>{
 const f=fixture(t);
 f.db().prepare('INSERT INTO "miningRuntimeState" (key,json) VALUES (?,?)')
   .run("systems"+SEP+SYSTEM,JSON.stringify({entities:{[ROCK]:{
     ...f.input.mineableState,remainingQuantity:55}}}));
 const r=f.settler.settle(f.input);
 assert.equal(r.success,false);
 assert.equal(f.source().remainingQuantity,55);
 assert.equal(f.cargo().length,0);
});
test("owner mismatch in original cargo is never rewritten",t=>{
 const f=fixture(t);
 f.miner.nativeCargoItems=[{itemID:900001,ownerID:OWNER,locationID:SHIP,
  moduleID:0,typeID:ORE,quantity:3,stacksize:3}];
 f.db().prepare('UPDATE "npcCargo" SET json=? WHERE key="cargo"').run(JSON.stringify({
  900001:{cargoID:900001,entityID:SHIP,ownerID:999,typeID:ORE,moduleID:0,
    quantity:3,transient:false}
 }));
 const r=f.settler.settle(f.input);
 assert.equal(r.success,false);
 assert.equal(f.cargo()[0].ownerID,999);
 assert.equal(f.source(),undefined);
});

test("all-waste cycle atomically depletes source without a zero-quantity cargo stack",t=>{
 const f=fixture(t);
 f.input.miningResult={normalQuantity:0,wastedQuantity:8};
 f.input.transferredQuantity=0;
 const result=f.settler.settle(f.input);
 assert.equal(result.success,true);
 assert.equal(f.source().remainingQuantity,92);
 assert.equal(f.cargo().length,0);
 assert.equal(f.miner.nativeCargoItems.length,0);
 assert.equal(f.receipts().length,1);
 const replay=f.settler.settle(f.input);
 assert.equal(replay.success,true);
 assert.equal(replay.receipt.replayed,true);
 assert.equal(f.cargo().length,0);
});
test("same operation cannot change the immutable yield fingerprint",t=>{
 const f=fixture(t);
 assert.equal(f.settler.settle(f.input).success,true);
 const sameCycleChangedYield={...f.input,
  miningResult:{normalQuantity:6,wastedQuantity:2},transferredQuantity:6};
 const result=f.settler.settle(sameCycleChangedYield);
 assert.equal(result.success,false);
 assert.equal(f.source().remainingQuantity,92);
 assert.equal(f.cargo()[0].quantity,7);
});
