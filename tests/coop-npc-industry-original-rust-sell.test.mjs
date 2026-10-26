import test, {after} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
const require=createRequire(import.meta.url);
const {createOriginalNpcRustSellStage}=require("../integration/coopNpcIndustryOriginalRustSell.cjs");
const {createNpcPendingMarketEscrow,ESCROW_BASE}=require("../integration/coopNpcPendingMarketEscrow.cjs");
const OP="npc-manufacture:"+"a".repeat(32),OWNER=1000035,
 STATION=60010001,TYPE=215,ITEM=1990000200,JOB=970000000000000;
const FLAGS={EVEJS_COOP_NATIVE_NPC_ECONOMY:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_NATIVE_NPC_TX_PROOF:"1",
 EVEJS_COOP_NATIVE_NPC_MANUAL_FACTORY_PROOF:"1",
 EVEJS_COOP_NATIVE_NPC_MARKET_PENDING:"1"};
 // The existing COOP-034 adapter deliberately checks process.env itself.
 // Tests must set its original flags, rather than only injecting a new env
 // into the LW-04C3 wrapper. Restore state after this isolated test file.
 const originalFlags=Object.fromEntries(Object.keys(FLAGS)
  .map(k=>[k,process.env[k]]));
 for(const [key,value] of Object.entries(FLAGS))process.env[key]=value;
 after(()=>{for(const [key,value] of Object.entries(originalFlags)){
  if(value===undefined)delete process.env[key];else process.env[key]=value;
 }});

function fixture({env=FLAGS,ackLost=false,mutateRust=null}={}){
 const items=new Map([[String(ITEM),{itemID:ITEM,ownerID:OWNER,locationID:STATION,
  flagID:4,typeID:TYPE,quantity:30,stacksize:30,singleton:0,
  customInfo:"coop-industry:v1:"+JOB}]]);
 const escrow=new Map(),orders=new Map();let nextOrder=500;
 let reserveCalls=0,activationCalls=0,backendCalls=0;
 const entry={operationID:OP,phase:"DELIVERED",ownerID:OWNER,stationID:STATION,
  typeID:TYPE,itemID:ITEM,quantity:30,jobID:JOB,
  plan:{ownerID:OWNER,stationID:STATION,productTypeID:TYPE,outputQuantity:30}};
 const journal={version:1,entries:{[OP]:entry},history:{}};
 const raw=(state,id=500)=>({operation_id:OP,source_item_id:String(ITEM),
  owner_id:OWNER,station_id:STATION,type_id:TYPE,quantity:30,
  order_id:String(id),price:12.5,source:"coop-npc",
  vol_remaining:30,state,bid:false,is_corp:true});
 const rpc=async(op,params)=>{
  backendCalls++;
  if(op==="ReserveNpcSellOrder"){
   reserveCalls++;
   if(!orders.has(OP))orders.set(OP,raw("pending",nextOrder++));
   return {...orders.get(OP)};
  }
  if(op==="ActivateNpcSellOrder"){
   activationCalls++;
   orders.set(OP,{...orders.get(OP),state:"open"});
   if(ackLost)throw Error("NATIVE_RUST_ACK_LOST_AFTER_ACTIVATION");
   return {...orders.get(OP)};
  }
  if(op==="GetNpcSellOrder"){
   const row=orders.get(OP);
   return row?{...row}:null;
  }
  throw Error("UNEXPECTED_RUST_NATIVE_RPC:"+op);
 };
 const tx={get:(table,key)=>(table==="items"?items:escrow).get(key)??null,
  put:(table,key,val)=>(table==="items"?items:escrow).set(key,structuredClone(val)),
  del:(table,key)=>(table==="items"?items:escrow).delete(key),
  scan:()=>[]};
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,["items","marketEscrow"]);
  const a=[...items].map(([k,v])=>[k,structuredClone(v)]);
  const c=[...escrow].map(([k,v])=>[k,structuredClone(v)]);
  try{return fn(tx)}catch(e){items.clear();escrow.clear();
   for(const [k,v] of a)items.set(k,v);
   for(const [k,v] of c)escrow.set(k,v);
   throw e;}
 }}};
 const pending=createNpcPendingMarketEscrow({call:rpc,gameStore,
  getNativeItem:id=>items.get(String(id))||null,
  getNativeEscrow:id=>escrow.get(String(id))||null,
  verifyNativeCorporation:owner=>owner===OWNER,
  verifyStation:(st,owner)=>st===STATION&&owner===OWNER,
  resolvePrice:()=>12.5,clock:()=>100000});
 let directorTicks=0;
 const director={mode:"NATIVE_AUTHORITIES_ONLY",supportsLiveRuntime:false,
  inspect:()=>structuredClone(journal),
  tick:async scope=>{
   directorTicks++;
   if(scope.ownerID!==OWNER||scope.stationID!==STATION)throw Error("OWNER");
   assert.equal(entry.phase,"DELIVERED");
   entry.phase="LIST_UNKNOWN";
   try{
    const out=await pending.listOnce({operationID:OP,ownerID:OWNER,
     stationID:STATION,itemID:ITEM,typeID:TYPE,quantity:30});
    if(out?.status!=="LISTED")return {status:"BLOCKED",reason:"UNKNOWN_OUTCOME"};
    entry.phase="LISTED";entry.orderID=out.orderID;
    // Mirrors the real original director, which fsyncs the validated
    // market ASK on the durable LISTED transition.
    entry.priceCents=1250;
    return {status:"LISTED",operationID:OP,orderID:out.orderID};
   }catch(error){return {status:"BLOCKED",reason:String(error.message)}}
  }};
 const manufacturing={mode:"MANUAL_ORIGINAL_GAMESTORE_PROOF_ONLY",
  supportsLiveRuntime:false,
  inspect:()=>({status:"ORIGINAL_DELIVERY_ATTESTED",jobID:JOB,itemID:ITEM,quantity:30})};
 const readRustOrder=async()=>{const row=await rpc("GetNpcSellOrder",{operation_id:OP});
  return mutateRust&&row?mutateRust({...row}):row};
 const create=()=>createOriginalNpcRustSellStage({
  director,manufacturing,readRustOrder,
  getOriginalItem:id=>items.get(String(id))||null,
  getOriginalEscrow:id=>escrow.get(String(id))||null,
  verifyNativeSeller:({ownerID,stationID})=>ownerID===OWNER&&stationID===STATION,
  env,clock:()=>100000
 });
 const scope={ownerID:OWNER,stationID:STATION,operationID:OP};
 return {items,escrow,orders,journal,entry,scope,create,raw,
  get reserveCalls(){return reserveCalls},
  get activationCalls(){return activationCalls},
  get directorTicks(){return directorTicks},
  get backendCalls(){return backendCalls}};
}
test("uses existing genuine pending Rust adapter and atomic original escrow once",async()=>{
 const f=fixture(),stage=f.create();const result=await stage.listDelivered(f.scope);
 assert.equal(result.status,"LISTED");
 assert.equal(result.settlementVerified,false);
 assert.equal(f.reserveCalls,1);assert.equal(f.activationCalls,1);
 assert.equal(f.directorTicks,1);
 assert.equal(f.items.get(String(ITEM)).locationID,ESCROW_BASE+500);
 assert.equal(f.escrow.get("500").sourceItemID,ITEM);
 assert.equal(f.entry.phase,"LISTED");
 const second=await stage.listDelivered(f.scope);
 assert.equal(second.reason,"LW04C3_NATIVE_JOURNAL_ALREADY_ADVANCED");
 assert.equal(f.reserveCalls,1);assert.equal(f.directorTicks,1);
 assert.equal((await stage.observe(f.scope)).status,"NATIVE_SELL_ORDER_ATTESTED");
});
test("Rust ACK lost after original activation leaves one order and repair-only path",async()=>{
 const f=fixture({ackLost:true}),stage=f.create();
 assert.equal((await stage.listDelivered(f.scope)).reason,
  "LW04C3_LIST_OUTCOME_NOT_CONFIRMED");
 assert.equal(f.entry.phase,"LIST_UNKNOWN");
 assert.equal(f.items.get(String(ITEM)).locationID,ESCROW_BASE+500);
 const result=await stage.observe(f.scope);
 assert.equal(result.status,"OPERATOR_RECONCILIATION_REQUIRED");
 assert.equal(result.orderID,500);
 const again=await stage.listDelivered(f.scope);
 assert.equal(again.reason,"LW04C3_NATIVE_JOURNAL_ALREADY_ADVANCED");
 assert.equal(f.reserveCalls,1);
 assert.equal(f.activationCalls,1);
});
test("read-only reconciliation never issues Reserve or Activate",async()=>{
 const f=fixture();f.entry.phase="LIST_UNKNOWN";f.entry.orderID=500;
 f.orders.set(OP,f.raw("open"));
 f.items.get(String(ITEM)).locationID=ESCROW_BASE+500;
 f.escrow.set("500",{orderId:"500",escrowType:"sell",isCorp:true,
  ownerId:OWNER,stationId:STATION,typeId:TYPE,sourceItemID:ITEM,
  coopOperationID:OP,escrowLocationID:ESCROW_BASE+500,
  remainingQuantity:30,coopSource:"NATIVE_INDUSTRY"});
 const proof=await f.create().observe(f.scope);
 assert.equal(proof.status,"OPERATOR_RECONCILIATION_REQUIRED");
 assert.equal(f.reserveCalls,0);assert.equal(f.activationCalls,0);
});
test("no original output stack blocks Rust before Reserve",async()=>{
 const f=fixture();f.items.get(String(ITEM)).quantity=29;
 const result=await f.create().listDelivered(f.scope);
 assert.equal(result.reason,"LW04C3_ORIGINAL_DELIVERY_NOT_ATTESTED"===result.reason?
  "LW04C3_ORIGINAL_DELIVERY_NOT_ATTESTED":"LW04C3_SOURCE_ITEM_NOT_AT_STATION");
 assert.equal(f.reserveCalls,0);
});
test("manufacturing delivery is never sale settlement or wallet credit",async()=>{
 const f=fixture();const result=await f.create().listDelivered(f.scope);
 assert.equal(result.status,"LISTED");
 assert.equal(result.settlementVerified,false);
 assert.equal(f.entry.phase,"LISTED");
});
test("Rust seller order with wrong original operation, owner or source is denied",async()=>{
 for(const mutateRust of [
  x=>({...x,operation_id:"npc-manufacture:"+"b".repeat(32)}),
  x=>({...x,owner_id:OWNER+1}),
  x=>({...x,source:"player"}),
  x=>({...x,price:0.004}),
  x=>({...x,vol_remaining:20}),
  x=>({...x,state:"filled",vol_remaining:0})]){
  const f=fixture({mutateRust});
  const result=await f.create().listDelivered(f.scope);
  assert.equal(result.reason,"LW04C3_LIST_READBACK_NOT_ATTESTED");
  assert.equal(f.entry.phase,"LISTED");
 }
});
test("altered original ItemStore escrow receipt cannot prove a Rust listing",async()=>{
 const f=fixture(),s=f.create();
 assert.equal((await s.listDelivered(f.scope)).status,"LISTED");
 f.escrow.get("500").ownerId=OWNER+1;
 assert.match((await s.observe(f.scope)).reason,/READONLY_RECOVERY_UNAVAILABLE/);
});
test("partial or fully filled original Rust order is not a wallet payment receipt",async()=>{
 const f=fixture();const s=f.create();await s.listDelivered(f.scope);
 const old=f.orders.get(OP);
 f.orders.set(OP,{...old,state:"filled",vol_remaining:0});
 assert.match((await s.observe(f.scope)).reason,/READONLY_RECOVERY_UNAVAILABLE/);
});
test("another active original job blocks wrong-operation director tick",async()=>{
 const f=fixture();f.journal.entries["npc-manufacture:"+"b".repeat(32)]={
  ...f.entry,operationID:"npc-manufacture:"+"b".repeat(32),phase:"INSTALLED"};
 const result=await f.create().listDelivered(f.scope);
 assert.match(result.reason,/MANUAL_LISTING_UNAVAILABLE/);
 assert.equal(f.directorTicks,0);assert.equal(f.reserveCalls,0);
});
test("original manual stage flags default OFF and no independent market writer",async()=>{
 for(const flag of Object.keys(FLAGS)){
  const env={...FLAGS,[flag]:"0"},f=fixture({env});
  assert.equal((await f.create().listDelivered(f.scope)).reason,
   "LW04C3_MANUAL_RUST_LISTING_DISABLED");
  assert.equal(f.reserveCalls,0);
 }
 for(const flag of ["EVEJS_COOP_ALIFE_ECONOMY_ACT",
  "EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER","EVEJS_COOP_NATIVE_NPC_MARKET"]){
  const f=fixture({env:{...FLAGS,[flag]:"1"}});
  assert.equal((await f.create().listDelivered(f.scope)).reason,
   "LW04C3_MANUAL_RUST_LISTING_DISABLED");
 }
});
test("only original operation IDs and corporate station scope accepted",async()=>{
 const f=fixture();
 assert.equal((await f.create().listDelivered({...f.scope,ownerID:22})).status,"BLOCKED");
 assert.equal((await f.create().listDelivered({...f.scope,operationID:"fake"})).status,"BLOCKED");
 assert.equal(f.reserveCalls,0);
});
test("no new clock, native SQLite writer, wallet or shadow market implemented",()=>{
 const code=fs.readFileSync(new URL("../integration/coopNpcIndustryOriginalRustSell.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(code,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(code,/\.transact\(|\.installOnce\(|\.grantItem\(/);
});


test("original Rust SELL read-only audit refuses repriced listing against durable ASK",async()=>{
 const f=fixture(),stage=f.create();
 assert.equal((await stage.listDelivered(f.scope)).status,"LISTED");
 assert.equal(f.entry.priceCents,1250);
 const authentic=f.orders.get(OP);
 for(const price of [12.49,12.51,15]){
  f.orders.set(OP,{...authentic,price});
  const result=await stage.observe(f.scope);
  assert.equal(result.status,"BLOCKED");
  assert.match(result.reason,/LW04C3_RUST_SELL_IDENTITY_INVALID/);
  assert.equal(result.nativeMutation,false);
 }
 f.orders.set(OP,authentic);
 const valid=await stage.observe(f.scope);
 assert.equal(valid.status,"NATIVE_SELL_ORDER_ATTESTED");
 assert.equal(valid.priceCents,1250);
});
test("missing durable original ASK cannot attest a LISTED native sell order",async()=>{
 const f=fixture(),stage=f.create();
 assert.equal((await stage.listDelivered(f.scope)).status,"LISTED");
 delete f.entry.priceCents;
 const result=await stage.observe(f.scope);
 assert.equal(result.status,"BLOCKED");
 assert.match(result.reason,/LW04C3_RUST_SELL_IDENTITY_INVALID/);
});
