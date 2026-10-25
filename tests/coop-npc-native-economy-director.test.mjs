import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createDirector}=require("../integration/coopNpcNativeEconomyDirector.cjs");
const OWNER=1000010,STATION=60000001,TYPE=215,BPO=91;
function fixture({target=100}={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-economy-"));
 let now=1000000,wallet=1000,elapsed=false,order=null,sales=[],produced=null,job=null,ordersCreated=0,installCalls=0,demands=[],debit=null;
 const snapshot=()=>({authoritativeNative:true,ownerID:OWNER,stationID:STATION,
  items:produced&&!order?[{typeID:TYPE,quantity:produced.quantity,ownerID:OWNER,stationID:STATION}]:[],
  orders:order?[{typeID:TYPE,quantity:order.remainingQuantity,ownerID:OWNER,stationID:STATION}]:[],
  jobs:job&&job.status!==4?[{jobID:job.jobID,status:job.status,activityID:1,typeID:TYPE,quantity:100,ownerID:OWNER,stationID:STATION}]:[],
  targets:{[TYPE]:target},demandReceipts:demands});
 const plan={ownerID:OWNER,stationID:STATION,facilityID:STATION,blueprintItemID:BPO,productTypeID:TYPE,outputQuantity:100};
 const planner={plan:()=>({status:"PLAN_READY",jobs:[plan]})};
 const native={
  quote:p=>({verifiedNative:true,totalCost:10,ownerID:OWNER,blueprintID:BPO,productTypeID:TYPE,facilityID:STATION}),
  installOnce:(p,q,id)=>{installCalls++;if(job)throw Error("DUP_INSTALL");wallet-=10;
    debit={verifiedNative:true,jobID:970000000000000,ownerID:OWNER,amountCents:1000};
    job={jobID:970000000000000,ownerID:OWNER,coopOperationID:id,productTypeID:TYPE,blueprintID:BPO,status:1};
    return{status:"INSTALLED",jobID:job.jobID}},
  markReadyOnce:id=>{if(!elapsed)return{status:"BLOCKED",error:"NATIVE_JOB_NOT_YET_READY"};job.status=3;return{status:"READY"}},
  deliverOnce:id=>{if(job.status!==3)throw Error("NOT_READY");job.status=4;job.coopDelivery={itemID:1990000200,quantity:100};
    produced={itemID:1990000200,typeID:TYPE,ownerID:OWNER,locationID:STATION,quantity:100,
      customInfo:"coop-industry:v1:"+job.jobID};
    return{status:"DELIVERED",itemID:1990000200,quantity:100}},
  getJob:id=>job,getItem:id=>produced&&produced.itemID===id?produced:null,getIndustryDebit:jobID=>debit};
 const market={
  listOnce:({itemID,quantity})=>{if(order)throw Error("DUP_LIST");ordersCreated++;
    order={orderID:101,ownerID:OWNER,stationID:STATION,typeID:TYPE,sourceItemID:itemID,originalQuantity:quantity,
      remainingQuantity:quantity,price:12,nativeEscrowVerified:true};return{status:"LISTED",orderID:101}},
  getOrder:id=>order?.orderID===id?order:null,getSaleEvidence:id=>sales,
  getWalletEntry:id=>{const sale=sales.find(x=>x.transactionID===id);
    return sale?{verifiedNative:true,transactionID:id,ownerID:OWNER,orderID:101,
      amountCents:Math.round(sale.price*sale.quantity*100)}:null}};
 const observe={getOwner:id=>id===OWNER?{corporationID:OWNER,isNpc:true}:null,
  getStation:id=>id===STATION?{stationID:STATION,solarSystemID:30000142}:null,snapshot};
 const create=(opts={})=>createDirector({file:path.join(root,"director.json"),planner,native,market,observe,clock:()=>now,...opts});
 return {root,create,native,market,observe,planner,
  get balance(){return wallet},get installs(){return installCalls},get listings(){return ordersCreated},
  setElapsed:v=>elapsed=v,setNow:v=>now=v,
  addDemand:(quantity=20)=>demands.push({receiptID:"native:"+demands.length,source:"NATIVE_WEAPON_CONSUMPTION",
    typeID:TYPE,quantity,authoritativeNative:true,at:now,ownerID:OWNER,stationID:STATION}),
  sell:(qty,price=12)=>{order.remainingQuantity-=qty;sales.push({orderID:101,ownerID:OWNER,typeID:TYPE,quantity:qty,
    transactionID:100+sales.length,price,nativeWalletSettled:true});wallet+=price*qty},
  close(){fs.rmSync(root,{recursive:true,force:true})}};
}
function run(fn,options){const f=fixture(options),old=process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
 process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY="1";
 try{return fn(f)}finally{if(old===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
  else process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY=old;f.close()}}
const ctx={ownerID:OWNER,stationID:STATION,productTypeIDs:[TYPE]};
test("native ownership bounded plan, ISK debit, real timer, escrow sale and replenishment",()=>run(f=>{
 const d=f.create();const first=d.tick(ctx);assert.equal(first.status,"PREPARED");
 assert.equal(d.tick(ctx).status,"INSTALLED");assert.equal(f.balance,990);assert.equal(f.installs,1);
 assert.equal(d.tick(ctx).status,"WAITING_FOR_NATIVE_TIMER");
 f.setElapsed(true);assert.equal(d.tick(ctx).status,"READY");
 assert.equal(d.tick(ctx).status,"DELIVERED");assert.equal(d.tick(ctx).status,"LISTED");assert.equal(f.listings,1);
 assert.equal(d.tick(ctx).status,"LISTED_AWAITING_BUYER");
 f.sell(50);assert.equal(d.tick(ctx).status,"PARTIALLY_SOLD");f.sell(50);
 const sold=d.tick(ctx);assert.equal(sold.status,"SOLD");assert.equal(sold.revenueCents,120000);
 assert.equal(sold.productionCostCents,1000);assert.equal(f.balance,2190);
 assert.equal(d.tick(ctx).status,"NPC_ECONOMY_REORDER_COOLDOWN");
 f.setNow(1100000);assert.equal(d.tick(ctx).status,"PREPARED");
}));
test("default OFF never constructs a manufacturing operation",()=>run(f=>{
 delete process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
 assert.equal(f.create().tick(ctx).status,"NPC_ECONOMY_DISABLED");assert.equal(f.installs,0);
 assert.equal(fs.existsSync(path.join(f.root,"director.json")),false);
}));
test("physically owned station stock prevents unnecessary factory jobs",()=>run(f=>{
 const d=f.create(),snap=f.observe.snapshot;
 f.observe.snapshot=()=>({...snap(),items:[{ownerID:OWNER,stationID:STATION,typeID:TYPE,quantity:100}]});
 assert.equal(d.tick(ctx).status,"SUFFICIENT_NATIVE_STOCK");assert.equal(f.installs,0);
}));
test("in-progress native industry quantity reduces shortage",()=>run(f=>{
 const d=f.create(),snap=f.observe.snapshot;
 f.observe.snapshot=()=>({...snap(),jobs:[{jobID:970000000000077,status:1,activityID:1,ownerID:OWNER,stationID:STATION,typeID:TYPE,quantity:100}]});
 assert.equal(d.tick(ctx).status,"SUFFICIENT_NATIVE_STOCK");
}));
test("native already-delivered job status 4 never permanently blocks replenishment",()=>run(f=>{
 const d=f.create(),old=f.observe.snapshot;
 f.observe.snapshot=()=>({...old(),jobs:[{jobID:970000000000099,status:4,activityID:1,
  ownerID:OWNER,stationID:STATION,typeID:TYPE,quantity:100}]});
 const r=d.tick(ctx);
 assert.equal(r.status,"PREPARED");
 assert.equal(r.shortage,100);
}));
test("native READY job still counts as outstanding supply before first delivery",()=>run(f=>{
 const d=f.create(),old=f.observe.snapshot;
 f.observe.snapshot=()=>({...old(),jobs:[{jobID:970000000000099,status:3,activityID:1,
  ownerID:OWNER,stationID:STATION,typeID:TYPE,quantity:100}]});
 assert.equal(d.tick(ctx).status,"SUFFICIENT_NATIVE_STOCK");
}));
test("missing or invalid native job status/owner/location cannot authorize a job",()=>run(f=>{
 const d=f.create(),old=f.observe.snapshot;
 for(const bad of [
  {jobID:970000000000099,activityID:1,ownerID:OWNER,stationID:STATION,typeID:TYPE,quantity:100},
  {jobID:970000000000099,status:2,activityID:1,ownerID:OWNER,stationID:STATION,typeID:TYPE,quantity:100},
  {jobID:970000000000099,status:1,activityID:1,ownerID:OWNER+1,stationID:STATION,typeID:TYPE,quantity:100}
 ]){
  f.observe.snapshot=()=>({...old(),jobs:[bad]});
  assert.throws(()=>d.tick(ctx),/JOB_PROVENANCE_UNVERIFIED/);
 }
 assert.equal(f.installs,0);
}));
test("unverified stock snapshot refuses phantom demand",()=>run(f=>{
 const d=f.create(),snap=f.observe.snapshot;f.observe.snapshot=()=>({...snap(),authoritativeNative:false});
 assert.throws(()=>d.tick(ctx),/SNAPSHOT_UNVERIFIED/);
}));
test("over-cap target or negative physical stock fails closed",()=>run(f=>{
 const d=f.create(),snap=f.observe.snapshot;
 f.observe.snapshot=()=>({...snap(),targets:{[TYPE]:50001}});
 assert.throws(()=>d.tick(ctx),/TARGET_INVALID/);
 f.observe.snapshot=()=>({...snap(),items:[{typeID:TYPE,quantity:-1,ownerID:OWNER,stationID:STATION}]});
 assert.throws(()=>d.tick(ctx),/NEGATIVE_QUANTITY/);
}));
test("noncanonical quote never spends minerals or ISK",()=>run(f=>{
 const d=f.create();assert.equal(d.tick(ctx).status,"PREPARED");
 f.native.quote=()=>({verifiedNative:false,totalCost:1});
 assert.equal(d.tick(ctx).reason,"UNVERIFIED_CANONICAL_QUOTE");assert.equal(f.balance,1000);
 assert.equal(Object.values(d.inspect().entries)[0].phase,"PREPARED");
}));
test("lost install acknowledgment persists and never double-charges after restart",()=>run(f=>{
 const d=f.create();d.tick(ctx);
 const old=f.native.installOnce;f.native.installOnce=(...a)=>{old(...a);throw Error("LOST_INSTALL_ACK")};
 assert.throws(()=>d.tick(ctx),/LOST_INSTALL_ACK/);assert.equal(f.balance,990);
 f.native.installOnce=old;
 assert.equal(f.create().tick(ctx).reason,"OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION");assert.equal(f.installs,1);
}));
test("lost delivery acknowledgment prevents second native item issuance",()=>run(f=>{
 const d=f.create();d.tick(ctx);d.tick(ctx);f.setElapsed(true);d.tick(ctx);
 const old=f.native.deliverOnce;f.native.deliverOnce=(...a)=>{old(...a);throw Error("LOST_DELIVERY_ACK")};
 assert.throws(()=>d.tick(ctx),/LOST_DELIVERY_ACK/);
 assert.equal(f.create().tick(ctx).reason,"OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION");
}));
test("duplicated market transaction receipts cannot declare a completed sale",()=>run(f=>{
 const d=f.create();d.tick(ctx);d.tick(ctx);f.setElapsed(true);d.tick(ctx);d.tick(ctx);d.tick(ctx);
 f.sell(50);f.sell(50);const sales=f.market.getSaleEvidence(101);
 sales[1].transactionID=sales[0].transactionID;
 assert.equal(d.tick(ctx).reason,"NATIVE_MARKET_QUANTITY_NOT_CONSERVED");
}));
test("foreign owner or station cannot debit assets",()=>run(f=>{
 const d=f.create();assert.equal(d.tick({...ctx,ownerID:999}).reason,"NPC_OWNER_OR_STATION_UNVERIFIED");
 assert.equal(d.tick({...ctx,stationID:999}).reason,"NPC_OWNER_OR_STATION_UNVERIFIED");
}));
test("corrupt journal refuses automatic restart replay",()=>run(f=>{
 const d=f.create();d.tick(ctx);fs.writeFileSync(path.join(f.root,"director.json"),"{bad-json");
 assert.throws(()=>f.create().tick(ctx));assert.equal(f.installs,0);
}));
test("verified native ammo consumption raises target but does not mint stock",()=>run(f=>{
 f.addDemand(30);assert.equal(f.create().tick(ctx).shortage,130);
}));
test("replayed demand receipts block auto manufacturing",()=>run(f=>{
 f.addDemand(30);f.addDemand(20);const snap=f.observe.snapshot;
 f.observe.snapshot=()=>{const s=snap();s.demandReceipts[1].receiptID=s.demandReceipts[0].receiptID;return s};
 assert.throws(()=>f.create().tick(ctx),/DEMAND_RECEIPT_REPLAY/);
}));
test("missing native debit receipt fences job after install",()=>run(f=>{
 const d=f.create();d.tick(ctx);f.native.getIndustryDebit=()=>null;
 assert.equal(d.tick(ctx).reason,"NATIVE_INDUSTRY_ISK_DEBIT_UNVERIFIED");
 assert.equal(f.create().tick(ctx).reason,"OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION");
}));
test("missing native market wallet credit prevents phantom profit",()=>run(f=>{
 const d=f.create();d.tick(ctx);d.tick(ctx);f.setElapsed(true);d.tick(ctx);d.tick(ctx);d.tick(ctx);
 f.sell(100);f.market.getWalletEntry=()=>null;
 assert.throws(()=>d.tick(ctx),/NATIVE_SALE_WALLET_NOT_SETTLED/);
 assert.equal(Object.values(d.inspect().entries)[0].phase,"LISTED");
}));

test("async Rust market RPC retains station journal lock until receipt",async()=>{
 const f=fixture(),old=process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
 process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY="1";
 try{
  const d=f.create();d.tick(ctx);d.tick(ctx);f.setElapsed(true);d.tick(ctx);d.tick(ctx);
  const original=f.market.listOnce;let resolveRPC;
  f.market.listOnce=request=>new Promise(resolve=>{resolveRPC=()=>resolve(original(request))});
  const pending=d.tick(ctx);assert.equal(typeof pending?.then,"function");
  assert.equal(d.tick(ctx).status,"ECONOMY_LOCKED");
  resolveRPC();assert.equal((await pending).status,"LISTED");
  assert.equal(f.listings,1);
 }finally{if(old===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
  else process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY=old;f.close()}
});
test("lost Rust market RPC acknowledgment cannot list the same item twice",async()=>{
 const f=fixture(),old=process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
 process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY="1";
 try{
  const d=f.create();d.tick(ctx);d.tick(ctx);f.setElapsed(true);d.tick(ctx);d.tick(ctx);
  const original=f.market.listOnce;
  f.market.listOnce=request=>{original(request);return Promise.reject(Error("LOST_MARKET_ACK"))};
  await assert.rejects(d.tick(ctx),/LOST_MARKET_ACK/);
  assert.equal(f.create().tick(ctx).reason,"OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION");
  assert.equal(f.listings,1);
 }finally{if(old===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
  else process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY=old;f.close()}
});
