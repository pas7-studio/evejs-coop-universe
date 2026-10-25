import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);
const {createSalvagePendingMarket}=require("../integration/coopSalvageNpcPendingMarket.cjs");
const {ESCROW_BASE}=require("../integration/coopNpcPendingMarketEscrow.cjs");
const env=["EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_NATIVE_NPC_MARKET_PENDING",
 "EVEJS_COOP_SALVAGE_NATIVE_MARKET"];
const before=env.map(k=>process.env[k]);
for(const k of env)process.env[k]="1";
const wreckItemID=9001,manifestKey="30000144-77-1000000";
function fixture(fn,options={}){
 let db={
  items:{"100000":{itemID:100000,ownerID:10001,locationID:60001,
   flagID:4,typeID:34,quantity:5,stacksize:5,singleton:0,
   customInfo:"coop-salvage-rival:v1:9001:5501"}},
  npcCargo:{cargo:{}},marketEscrow:{},
  corporationRuntime:{coopSalvageRivalMoves:{version:1,moves:{
   "9001":{v:1,state:"NPC_STOCK_DELIVERED",wreckID:8001,
    manifestKey,sourceCargoID:5501,wreckItemID,npcCargoID:2001,
    entityID:801,corporationID:10001,stationID:60001,nativeItemID:100000}
  }}}
 };
 let commits=0,attempts=0,hook=null,delay=()=>{},counters={reserve:0,activate:0,get:0};
 const atomic={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(tables,mutation)=>{
   attempts++;
   if(hook)hook(db,attempts);
   const copy=structuredClone(db);
   const tx={get:(t,k)=>copy[t]?.[k]??null,
    put:(t,k,value)=>{copy[t][k]=value},
    scan:t=>Object.entries(copy[t]||{}).map(([key,value])=>({key,value}))};
   const result=mutation(tx);
   db=copy;commits++;return result;
  }};
 const order=state=>({operation_id:currentOp,
  source_item_id:"100000",order_id:"456",owner_id:10001,
  station_id:60001,type_id:34,quantity:5,price:12,
  bid:false,is_corp:true,source:"coop-npc",vol_remaining:5,state});
 let currentOp=null;
 const call=async(method,p)=>{
  if(method==="ReserveNpcSellOrder"){
   counters.reserve++;currentOp=p.operation_id;
   if(options.reserveThrows)throw Error("RPC_TIMEOUT");
   if(options.badPending)return {...order("pending"),quantity:500};
   return order("pending");
  }
  if(method==="ActivateNpcSellOrder"){
   counters.activate++;
   if(options.activateThrows)throw Error("RPC_ACK_LOST");
   return order("open");
  }
  if(method==="GetNpcSellOrder"){counters.get++;return order("open")}
  throw Error("UNEXPECTED_MARKET_RPC");
 };
 const adapter=createSalvagePendingMarket({atomic,call,
  getItem:id=>db.items[String(id)]||null,
  getEscrow:id=>db.marketEscrow[String(id)]||null,
  readJournal:()=>structuredClone(db.corporationRuntime.coopSalvageRivalMoves),
  readWitness:()=>({status:"READY",record:{manifestKey,wreckID:8001,
   corporationID:10001,stationID:60001,
   rows:[{cargoID:5501,wreckItemID,typeID:34,quantity:5}]}}),
  isNpcCorporation:id=>id===10001,
  verifyStation:(station,owner)=>station===60001&&owner===10001,
  resolvePriceCents:()=>1200,clock:()=>1761400000000});
 return fn({adapter,db:()=>structuredClone(db),mutate:edit=>edit(db),
  onTransaction:cb=>hook=cb,counters,commits:()=>commits,
  attempts:()=>attempts,options});
}
test("source-attested salvage creates one pending Rust sale, atomic escrow and open order",async()=>fixture(async f=>{
 const r=await f.adapter.listOnce(wreckItemID);
 assert.equal(r.status,"NATIVE_SALVAGE_MARKET_LISTED");
 assert.equal(r.walletCredited,false);
 assert.equal(r.nativeEscrowVerified,true);
 assert.equal(r.orderID,456);
 assert.equal(f.db().items["100000"].locationID,ESCROW_BASE+456);
 assert.equal(f.db().marketEscrow["456"].coopSource,"NATIVE_SALVAGE");
 assert.equal(f.db().marketEscrow["456"].coopOperationID,r.operationID);
 assert.equal(f.db().corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"LISTED");
 assert.deepEqual(f.counters,{reserve:1,activate:1,get:1});
 assert.equal(f.commits(),3);
}));
test("same salvage source cannot be listed twice or mint another escrow",async()=>fixture(async f=>{
 assert.equal((await f.adapter.listOnce(wreckItemID)).status,"NATIVE_SALVAGE_MARKET_LISTED");
 const r=await f.adapter.listOnce(wreckItemID);
 assert.equal(r.status,"BLOCKED");
 assert.equal(f.counters.reserve,1);
 assert.equal(Object.keys(f.db().marketEscrow).length,1);
}));
test("missing original durable pickup witness prevents any RPC",async()=>fixture(async f=>{
 f.mutate(db=>{delete db.corporationRuntime.coopSalvageRivalMoves.moves["9001"]});
 assert.equal((await f.adapter.listOnce(wreckItemID)).status,"BLOCKED");
 assert.equal(f.counters.reserve,0);
 assert.equal(f.commits(),0);
}));
test("wrong corporation owner or warehouse prevents market reservation",async()=>fixture(async f=>{
 f.mutate(db=>{db.items["100000"].ownerID=999});
 assert.equal((await f.adapter.listOnce(wreckItemID)).status,"BLOCKED");
 assert.equal(f.counters.reserve,0);
}));
test("extra forged original marker item is detected inside the GameStore transaction",async()=>fixture(async f=>{
 f.mutate(db=>{db.items["100001"]={...db.items["100000"],itemID:100001}});
 const r=await f.adapter.listOnce(wreckItemID);
 assert.equal(r.reason,"SALVAGE_MARKET_PREPARE_UNCERTAIN");
 assert.equal(f.counters.reserve,0);
 assert.equal(f.commits(),0);
}));
test("cargo source still on NPC and warehouse is a duplicate: no Rust RPC",async()=>fixture(async f=>{
 f.mutate(db=>{db.npcCargo.cargo["2001"]={cargoID:2001,sourceWreckItemID:9001}});
 const r=await f.adapter.listOnce(wreckItemID);
 assert.equal(r.reason,"SALVAGE_MARKET_PREPARE_UNCERTAIN");
 assert.equal(f.counters.reserve,0);
 assert.equal(f.commits(),0);
}));
test("stale inventory after Rust pending order leaves one locked intent and no activation",async()=>fixture(async f=>{
 f.onTransaction((db,n)=>{
  if(n===2)db.items["100000"].quantity=4;
 });
 const r=await f.adapter.listOnce(wreckItemID);
 assert.equal(r.status,"SALVAGE_MARKET_RECONCILIATION_REQUIRED");
 assert.equal(r.phase,"ESCROW_COMMIT_UNKNOWN");
 assert.equal(f.db().items["100000"].locationID,60001);
 assert.equal(Object.keys(f.db().marketEscrow).length,0);
 assert.equal(f.db().corporationRuntime.coopSalvageMarketOps.bySource["9001"].phase,"PREPARED");
 assert.equal(f.counters.activate,0);
 assert.equal((await f.adapter.listOnce(wreckItemID)).status,"BLOCKED");
 assert.equal(f.counters.reserve,1);
}));
test("lost Rust Reserve ACK is not retried with another order",async()=>fixture(async f=>{
 const first=await f.adapter.listOnce(wreckItemID);
 assert.equal(first.phase,"RUST_RESERVE_UNKNOWN");
 const second=await f.adapter.listOnce(wreckItemID);
 assert.equal(second.status,"SALVAGE_MARKET_RECONCILIATION_REQUIRED");
 assert.equal(f.counters.reserve,1);
 assert.equal(f.counters.activate,0);
},{reserveThrows:true}));
test("unverified Rust pending order never creates native escrow",async()=>fixture(async f=>{
 const result=await f.adapter.listOnce(wreckItemID);
 assert.equal(result.phase,"RUST_RESERVE_NOT_VERIFIED");
 assert.equal(Object.keys(f.db().marketEscrow).length,0);
 assert.equal(f.counters.activate,0);
},{badPending:true}));
test("lost Rust activation ACK keeps exactly one native item and escrow",async()=>fixture(async f=>{
 const first=await f.adapter.listOnce(wreckItemID);
 assert.equal(first.phase,"RUST_ACTIVATION_UNKNOWN");
 assert.equal(f.db().items["100000"].locationID,ESCROW_BASE+456);
 assert.equal(Object.keys(f.db().marketEscrow).length,1);
 const second=await f.adapter.listOnce(wreckItemID);
 assert.equal(second.status,"BLOCKED");
 assert.equal(f.counters.reserve,1);
 assert.equal(f.counters.activate,1);
},{activateThrows:true}));
test("existing market escrow for source is denied even when item looks warehoused",async()=>fixture(async f=>{
 f.mutate(db=>{db.marketEscrow["900"]={sourceItemID:100000,coopOperationID:"legacy"}});
 const first=await f.adapter.listOnce(wreckItemID);
 assert.equal(first.reason,"SALVAGE_MARKET_PREPARE_UNCERTAIN");
 assert.equal(f.counters.reserve,0);
}));
test("default OFF rejects without invoking native GameStore or Rust",async()=>fixture(async f=>{
 process.env.EVEJS_COOP_SALVAGE_NATIVE_MARKET="0";
 try{
  const r=await f.adapter.listOnce(wreckItemID);
  assert.equal(r.reason,"SALVAGE_MARKET_DISABLED");
  assert.equal(f.counters.reserve,0);
  assert.equal(f.attempts(),0);
 }finally{process.env.EVEJS_COOP_SALVAGE_NATIVE_MARKET="1"}
}));
process.on("exit",()=>env.forEach((k,i)=>{
 if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];
}));


test("salvage pending-market loads the real local .cjs escrow sibling",()=>{
 assert.equal(typeof createSalvagePendingMarket,"function");
 assert.equal(ESCROW_BASE,9200000000);
});
test("deployed JS-only salvage market resolves the native escrow sibling",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"salvage-market-overlay-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const original=fs.readFileSync(new URL("../integration/coopSalvageNpcPendingMarket.cjs",import.meta.url),"utf8");
 fs.writeFileSync(path.join(root,"coopSalvageNpcPendingMarket.js"),original);
 fs.writeFileSync(path.join(root,"coopNpcPendingMarketEscrow.js"),
  "module.exports={ESCROW_BASE:9200000000};");
 const native=createRequire(path.join(root,"index.cjs"))("./coopSalvageNpcPendingMarket.js");
 assert.equal(typeof native.createSalvagePendingMarket,"function");
 assert.equal(fs.existsSync(path.join(root,"coopNpcPendingMarketEscrow.cjs")),false);
});
test("broken deployed escrow transitive import is not swallowed by source fallback",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"salvage-market-overlay-broken-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const original=fs.readFileSync(new URL("../integration/coopSalvageNpcPendingMarket.cjs",import.meta.url),"utf8");
 fs.writeFileSync(path.join(root,"coopSalvageNpcPendingMarket.js"),original);
 fs.writeFileSync(path.join(root,"coopNpcPendingMarketEscrow.js"),
  "require('./real-missing-salvage-escrow-implementation');");
 assert.throws(()=>createRequire(path.join(root,"index.cjs"))("./coopSalvageNpcPendingMarket.js"),
  /real-missing-salvage-escrow-implementation/);
});
