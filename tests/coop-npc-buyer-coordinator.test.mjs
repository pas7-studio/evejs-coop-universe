import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcBuyerCoordinator}=require("../integration/coopNpcBuyerCoordinator.cjs");
const BUYER=1000010,SELLER=90000001,STATION=60000001,TYPE=215,ORDER=456;
const FLAGS={EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1"};
const ACTOR={nativeVerified:true,isNpc:true,role:"trader",corporationID:BUYER,
 stationID:STATION,playerControlled:false,inWarp:false,underAttack:false,
 activeNativeOrder:false};
const ASK={verifiedNative:true,orderID:ORDER,stationID:STATION,typeID:TYPE,
 sellerOwnerID:SELLER,unitPriceCents:125,remainingQuantity:20,state:"open"};
const PROOF={authoritativeNative:true,ownerID:BUYER,stationID:STATION,typeID:TYPE,
 walletCents:100000,targetStock:20,physicalOwned:0,incomingStock:0,
 outstandingBuys:0,asks:[ASK]};
const CONTEXT={actorID:99,buyerCorpID:BUYER,stationID:STATION,typeID:TYPE,
 maxUnitPriceCents:125,maxSpendCents:10000,minReserveCents:10000};
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop048-coordinator-")),
  file=path.join(dir,"purchase-journal.json");
 let actor={...ACTOR},proof={...PROOF},rustState="open",orderPrice=1.25,
  outcomeUnknown=false,calls=0,successful=false,history=[];
 let gate=null,unlock=null;
 const buyer={mode:"RUST_CLAIM_PLAYER_FULL_ESCROW",
  purchaseOnce:async request=>{
   calls++;history.push({...request});
   if(gate)await gate;
   if(!successful){successful=true;rustState="filled";
    if(outcomeUnknown){outcomeUnknown=false;throw Error("LOST_NATIVE_BUY_ACK");}}
   return {status:"NPC_PURCHASED_PLAYER_GOODS",fillID:930000000000001,itemID:1990000200};
  }};
 const deps={file,env:{...FLAGS},buyer,clock:()=>1761390000000,
  resolveActor:async()=>actor,
  readProof:async()=>proof,
  getOrder:async()=>({source:"player",state:rustState,is_corp:false,
   bid:false,order_id:String(ORDER),owner_id:String(SELLER),
   station_id:STATION,type_id:TYPE,vol_remaining:rustState==="open"?20:0,
   price:orderPrice})};
 const create=()=>createNpcBuyerCoordinator(deps);
 const close=()=>fs.rmSync(dir,{recursive:true,force:true});
 return {file,deps,create,close,
  get calls(){return calls},get history(){return history},
  actor:v=>{actor=v},proof:v=>{proof=v},repricing:v=>{orderPrice=v},
  failOnce:()=>{outcomeUnknown=true},
  stall:()=>{gate=new Promise(r=>{unlock=r});return()=>{unlock();gate=null}},
  state:()=>rustState};
}
async function run(fn){
 const f=fixture();
 try{return await fn(f)}finally{f.close()}
}
test("source-backed A-Life decision commits one native NPC purchase and durable record",()=>run(async f=>{
 const r=await f.create().tick(CONTEXT);
 assert.equal(r.status,"NPC_PLAYER_PURCHASE_SETTLED");
 assert.equal(f.calls,1);
 const rows=f.create().inspect().entries;
 assert.equal(Object.keys(rows).length,1);
 const entry=rows[BUYER+":"+ORDER];
 assert.equal(entry.phase,"SETTLED");
 assert.equal(entry.fillID,930000000000001);
 assert.match(entry.claimKey,/^npc-corpbuy:[0-9a-f]{32}$/);
}));
test("lost native acknowledgement remains PREPARED until operator-approved recovery",()=>run(async f=>{
 f.failOnce();
 await assert.rejects(f.create().tick(CONTEXT),/LOST_NATIVE_BUY_ACK/);
 const journal=f.create().inspect(),before=journal.entries[BUYER+":"+ORDER];
 assert.equal(before.phase,"PREPARED");
 const blocked=await f.create().tick(CONTEXT);
 assert.equal(blocked.status,"BLOCKED");
 assert.equal(blocked.reason,"NPC_BUY_PENDING_OPERATOR_RECOVERY");
 assert.equal(f.calls,1);
 assert.equal(f.create().inspect().entries[BUYER+":"+ORDER].claimKey,
  before.claimKey);
}));
test("fresh Rust price change cannot spend NPC money after stale planning",()=>run(async f=>{
 f.repricing(3);
 assert.equal((await f.create().tick(CONTEXT)).reason,"NPC_BUY_FRESH_RUST_ORDER_CHANGED");
 assert.equal(f.calls,0);
}));
test("untrusted, player-controlled or endangered actor cannot buy",()=>run(async f=>{
 f.actor({...ACTOR,playerControlled:true});
 assert.equal((await f.create().tick(CONTEXT)).reason,"NPC_BUY_ACTOR_UNVERIFIED");
 f.actor({...ACTOR,underAttack:true});
 assert.equal((await f.create().tick(CONTEXT)).reason,"NPC_BUY_ACTOR_UNVERIFIED");
 assert.equal(f.calls,0);
}));
test("unverified stock/wallet sources are never used for native ISK spending",()=>run(async f=>{
 f.proof({...PROOF,authoritativeNative:false});
 assert.equal((await f.create().tick(CONTEXT)).reason,"NPC_BUY_NATIVE_PROOF_MISSING");
 assert.equal(f.calls,0);
}));
test("native purchase with no affordable ask never claims Rust stock",()=>run(async f=>{
 f.proof({...PROOF,walletCents:1});
 const r=await f.create().tick(CONTEXT);
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.reason,"NPC_BUY_NO_SPENDABLE_ISK");
 assert.equal(f.calls,0);
}));
test("second simultaneous station tick is fenced by cross-process durable lock",()=>run(async f=>{
 const release=f.stall();
 const first=f.create().tick(CONTEXT);
 for(let i=0;i<6&&f.calls===0;i++)await Promise.resolve();
 assert.equal(f.calls,1);
 assert.equal((await f.create().tick(CONTEXT)).reason,"NPC_BUY_COORDINATOR_LOCKED");
 release();
 assert.equal((await first).status,"NPC_PLAYER_PURCHASE_SETTLED");
 assert.equal(f.calls,1);
}));
test("already settled order never produces a second paid native claim",()=>run(async f=>{
 assert.equal((await f.create().tick(CONTEXT)).status,"NPC_PLAYER_PURCHASE_SETTLED");
 const next=await f.create().tick(CONTEXT);
 assert.equal(next.reason,"NPC_BUY_ORDER_ALREADY_HANDLED");
 assert.equal(f.calls,1);
}));
test("feature flags keep all native writes and journals OFF by default",()=>run(async f=>{
 delete f.deps.env.EVEJS_COOP_NPC_BUY_PLAYER_ASK;
 assert.equal((await f.create().tick(CONTEXT)).status,"DISABLED");
 assert.equal(f.calls,0);
 assert.equal(fs.existsSync(f.file),false);
}));
test("corrupted durable purchase journal fails closed",()=>run(async f=>{
 fs.writeFileSync(f.file,"{invalid-json");
 await assert.rejects(f.create().tick(CONTEXT));
 assert.equal(f.calls,0);
}));
