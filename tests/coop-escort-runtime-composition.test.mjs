import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);
const {createEscortRuntime}=require("../integration/coopEscortRuntime.cjs");
const old=Object.fromEntries(["EVEJS_COOP_ESCORT_CONTRACTS",
 "EVEJS_COOP_ESCORT_ROUTE_GATE","EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_NATIVE_ESCORT_WALLET","EVEJS_COOP_ESCORT_REFUNDS"].map(k=>[k,process.env[k]]));
for(const k of Object.keys(old))process.env[k]="1";
function fixture(fn,{duo=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-escort-e2e-"));
 const record={key:"30000144-77-1000000",systemID:30000144,fleetID:77,
  stationID:60001,corporationID:10001,haulerIDs:[901],
  cargo:[{cargoID:5501,haulerID:901,typeID:34,quantity:8,fromMinerID:303}]};
 const manifest={status:"READY",record};
 const full={status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",key:record.key,
  stationID:60001,haulerIDs:[901],cargoIDs:[5501],stacks:1,
  quantity:8,convoySaved:false,paidReward:false};
 const c={contractID:"escort-test-01",manifestKey:record.key,systemID:30000144,
  fleetID:77,haulerID:901,stationID:60001,corporationID:10001,
  pirateID:202,incidentKey:"30000144:202:901",fleetDuoID:33,
  characters:[701,702],amountISK:20000};
 const clone=x=>JSON.parse(JSON.stringify(x));
 let db={corporationRuntime:{"corporations\u001f10001":{
  wallet:{divisions:{"1000":{key:1000,balance:50000,journal:[],transactions:[]}}}}},
  characters:{"701":{characterID:701,balance:500,balanceChange:0,walletJournal:[]},
   "702":{characterID:702,balance:500,balanceChange:0,walletJournal:[]}}};
 let transactions=0,verified=false;
 const atomicRows={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(_tables,fn)=>{transactions++;
   const before=clone(db);
   const tx={get:(t,k)=>db[t][k]?clone(db[t][k]):null,
    put:(t,k,v)=>{db[t][k]=clone(v)}};
   try{return fn(tx)}catch(e){db=before;throw e}
  }};
 const runtime=createEscortRuntime({root,clock:()=>1000000,atomicRows,
  isNpcCorporation:id=>id===10001,
  authorizeBooking:m=>({status:"AUTHORIZED_NATIVE_ESCORT_BOOKING",...m,
   playerFleetID:33,contractID:c.contractID,characters:[701,702],amountISK:20000}),
  verifyNativeDuo:()=>duo?{status:"VERIFIED_NATIVE_DUO_FLEET",
   fleetID:33,characters:[701,702]}:{status:"NOT_AUTHENTIC"},
  authorizeOffer:x=>({status:"AUTHORIZED_NATIVE_ESCORT",...x}),
  readManifest:()=>manifest,verifyManifest:()=>full,
  readIncidents:()=>({status:"READY",incidents:[{
   key:c.incidentKey,systemID:30000144,targetID:901,pirateID:202,
   targetRole:"hauler",duoFleetID:33,characters:[701,702],
   status:"PIRATE_WRECK_CONFIRMED",closed:true,nativeWreckID:999}]}),
  readOutcomes:()=>({status:"READY",outcomes:[{
   key:c.incidentKey,haulerNativeWreckID:0,verifiedWarehouseStacks:[{
    cargoID:5501,itemID:9911,typeID:34,quantity:8,stationID:60001,ownerID:10001}]}]}),
  readNativeFailure:()=>null});
 const route={manifestKey:record.key,systemID:30000144,fleetID:77,
  stationID:60001,corporationID:10001,haulerIDs:[901]};
 const terminal={manifestKey:record.key,
  trip:{manifestID:record.key,systemID:30000144,fleetID:77,stationID:60001,
   corporationID:10001,haulers:{"901":{arrivedAt:1000000}}},
  terminalProof:{status:"DELIVERED",terminal:true,nativeFullManifestProof:full}};
 try{fn({runtime,db:()=>db,c,route,terminal,transactions:()=>transactions})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("full native path: escrow before warp, exact arrival, actual duo pirate, two real credits",()=>fixture(x=>{
 assert.equal(x.runtime.fundBeforeWarp(x.route).status,"FUNDED_BEFORE_WARP");
 assert.equal(x.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,30000);
 assert.equal(x.runtime.recordDelivery(x.terminal).status,"DURABLE_NATIVE_DELIVERY_RECORDED");
 const paid=x.runtime.finishAfterRaid(x.c);
 assert.equal(paid.status,"SETTLED");
 assert.equal(x.db().characters["701"].balance,10500);
 assert.equal(x.db().characters["702"].balance,10500);
 assert.equal(x.runtime.readContract(x.c.contractID).phase,"SETTLED");
 assert.equal(x.runtime.proof(x.c).status,"NATIVE_ESCORT_EVIDENCE_VERIFIED");
 assert.equal(x.runtime.proof(x.c).nativeWreckID,999);
}));
test("a second paid settlement never grants two more player credits",()=>fixture(x=>{
 x.runtime.fundBeforeWarp(x.route);x.runtime.recordDelivery(x.terminal);
 x.runtime.finishAfterRaid(x.c);
 assert.equal(x.runtime.finishAfterRaid(x.c).status,"CONTRACT_NOT_SETTLEABLE");
 assert.equal(x.db().characters["701"].balance,10500);
}));
test("real native duo failure prevents even pre-warp NPC corporation debit",()=>fixture(x=>{
 assert.equal(x.runtime.fundBeforeWarp(x.route).status,"FLIGHT_BOOKING_NOT_AUTHORIZED");
 assert.equal(x.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50000);
},{duo:false}));
test("no terminal delivery means no payout, no buyer wallet mutation",()=>fixture(x=>{
 x.runtime.fundBeforeWarp(x.route);
 assert.notEqual(x.runtime.finishAfterRaid(x.c).status,"SETTLED");
 assert.equal(x.db().characters["701"].balance,500);
}));
test("feature OFF prevents native ISK mutation",()=>fixture(x=>{
 process.env.EVEJS_COOP_ESCORT_ROUTE_GATE="0";
 try{assert.equal(x.runtime.fundBeforeWarp(x.route).status,"DISABLED");
  assert.equal(x.db().corporationRuntime["corporations\u001f10001"].wallet.divisions["1000"].balance,50000)}
 finally{process.env.EVEJS_COOP_ESCORT_ROUTE_GATE="1"}
}));
process.on("exit",()=>{for(const [k,v] of Object.entries(old))
 if(v===undefined)delete process.env[k];else process.env[k]=v});
