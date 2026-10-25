import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStationAuthority}=require("../integration/coopAlifeStationAuthority.cjs");
const O=1000010,S=60000001,SYS=30000142,REG=10000002,T=215,BP=30001,BPI=99901,ORE=1230,M=34;
const clone=x=>structuredClone(x);
function fixture(){
 const state={
  wallet:100,version:1,
  items:[
   {itemID:BPI,typeID:BP,ownerID:O,locationID:S,flagID:4,singleton:1,quantity:1,categoryID:9},
   {itemID:101,typeID:M,ownerID:O,locationID:S,flagID:4,quantity:20,stacksize:20,categoryID:4},
   {itemID:102,typeID:ORE,ownerID:O,locationID:S,flagID:4,quantity:50,stacksize:50,categoryID:25}
  ],jobs:[],escrows:[],book:[],calls:0,delayed:null
 };
 const policy={getCorporation:id=>({corporationID:id,isNPC:true}),
  getCorporationRuntime:id=>({corporationID:id,wallet:{divisions:{"1000":{balance:state.wallet}}}}),
  getStation:id=>id===S?({stationID:id,solarSystemID:SYS,regionID:REG}):null,
  getFacility:id=>({facilityID:id,solarSystemID:SYS,online:true,activities:{1:{}}}),
  listOwnedItems:()=>clone(state.items),listJobs:()=>clone(state.jobs),
  listEscrow:()=>clone(state.escrows),getEscrowItem:id=>clone(state.items.find(i=>i.itemID===id)||null),
  getDefinition:id=>({productTypeID:id,blueprintTypeID:BP}),
  getBlueprintState:()=>({original:true,typeID:BP,jobID:0,materialEfficiency:0}),
  getMaterials:()=>[{typeID:M,quantity:10}],
  getOrders:async(region,type)=>{state.calls++;if(state.delayed)await state.delayed;
   if(region!==REG||type!==T)throw Error("RUST_WRONG_REGION_TYPE");
   return{sells:clone(state.book)};
  },
  getItemVersion:()=>state.version,clock:()=>1000000};
 const authority=()=>createStationAuthority({...policy,products:[{typeID:T,targetStock:100}]});
 const read=()=>authority().read({ownerID:O,stationID:S,systemID:SYS});
 const addEscrow=(quantity=25)=>{
  const orderID=5001,sourceID=1001;
  state.escrows.push({orderId:String(orderID),escrowType:"sell",isCorp:true,
   ownerId:O,stationId:S,typeId:T,sourceItemID:sourceID,coopOperationID:"npc-manufacture:"+"a".repeat(32),
   coopSource:"NATIVE_INDUSTRY",remainingQuantity:quantity,escrowLocationID:9200000000+orderID});
  state.items.push({itemID:sourceID,typeID:T,ownerID:O,
   locationID:9200000000+orderID,flagID:4,singleton:0,quantity,stacksize:quantity,
   customInfo:"coop-industry:v1:998877"});
  state.book.push({source:"coop-npc",order_id:String(orderID),owner_id:String(O),
   station_id:String(S),is_corp:true,bid:false,state:"open",vol_remaining:quantity});
 };
 return {state,policy,authority,read,addEscrow};
}
test("policy target is bounded, one real SDE BPO and native corp station required",()=>{
 const f=fixture();
 assert.throws(()=>createStationAuthority({...f.policy,products:[{typeID:T,targetStock:1000000}]}),/TARGET_POLICY_INVALID/);
 assert.throws(()=>createStationAuthority({...f.policy,products:[{typeID:T,targetStock:10},{typeID:T,targetStock:20}]}),/TARGET_POLICY_INVALID/);
});
test("read-only native manufacturing shortage respects native mineral balance and real wallet",async()=>{
 const f=fixture(),r=await f.read();
 assert.equal(r.authoritativeNative,true);assert.equal(r.productShortage,100);
 assert.equal(r.materialShortage,0);assert.equal(r.mineralStock,20);
 assert.equal(r.oreAtStation,50);assert.equal(r.walletCents,10000);
 assert.equal(r.nativeActiveJobs,0);assert.equal(r.nativeOutputQty,0);
 assert.equal(r.marketOnline,true);assert.equal(f.state.calls,1);
});
test("material shortage is measured against native SDE quantity not virtual mineral credit",async()=>{
 const f=fixture();f.state.items.find(x=>x.typeID===M).quantity=3;
 const r=await f.read();assert.equal(r.materialShortage,7);
 assert.equal(r.mineralStock,3);
});
test("native unfinished installed jobs count against replenishment and prevent duplicate job",async()=>{
 const f=fixture();f.state.jobs=[{jobID:11,ownerID:O,stationID:S,productTypeID:T,
  productQuantity:90,blueprintID:BPI,activityID:1,status:1,
  coopOperationID:"npc-manufacture:"+"b".repeat(32)}];
 const r=await f.read();assert.equal(r.nativeActiveJobs,1);
 assert.equal(r.nativeReadyJobs,0);assert.equal(r.productShortage,10);
});
test("paused native job is reserved stock and never creates a second paid manufacturing intent",async()=>{
 const f=fixture();f.state.jobs=[{jobID:11,ownerID:O,stationID:S,productTypeID:T,
  productQuantity:100,blueprintID:BPI,activityID:1,status:2,
  coopOperationID:"npc-manufacture:"+"c".repeat(32)}];
 const r=await f.read();
 assert.equal(r.authoritativeNative,true);
 assert.equal(r.nativeReadyJobs,0);
 assert.equal(r.nativeActiveJobs,1);
 assert.equal(r.productShortage,0);
});
test("real READY industry job takes precedence in native inventory authority",async()=>{
 const f=fixture();f.state.jobs=[{jobID:11,ownerID:O,stationID:S,productTypeID:T,
  productQuantity:100,blueprintID:BPI,activityID:1,status:3,
  coopOperationID:"npc-manufacture:"+"b".repeat(32)}];
 const r=await f.read();assert.equal(r.nativeReadyJobs,1);assert.equal(r.productShortage,0);
});
test("unlisted physical item manufactured by native job is discoverable but not minted",async()=>{
 const f=fixture();f.state.items.push({itemID:2001,typeID:T,ownerID:O,locationID:S,
  flagID:4,quantity:10,stacksize:10,singleton:0,customInfo:"coop-industry:v1:200"});
 const r=await f.read();assert.equal(r.nativeOutputQty,10);assert.equal(r.productShortage,90);
});
test("matched Rust open corporation sell order consumes verified escrow stock",async()=>{
 const f=fixture();f.addEscrow();const r=await f.read();
 assert.equal(r.authoritativeNative,true);assert.equal(r.products[0].listed,25);
 assert.equal(r.productShortage,75);
});
test("invisible or lost Rust order cannot be counted as available market inventory",async()=>{
 const f=fixture();f.addEscrow();f.state.book=[];
 const r=await f.read();assert.equal(r.authoritativeNative,false);
 assert.equal(r.reason,"NATIVE_RUST_ESCROW_ORDER_NOT_VISIBLE");
});
test("spoofed Rust quantity or duplicated order is blocked",async()=>{
 const f=fixture();f.addEscrow();f.state.book[0].vol_remaining=5;
 assert.equal((await f.read()).reason,"NATIVE_RUST_MARKET_ESCROW_MISMATCH");
 f.state.book[0].vol_remaining=25;f.state.book.push(clone(f.state.book[0]));
 assert.equal((await f.read()).reason,"NATIVE_RUST_MARKET_ESCROW_MISMATCH");
});
test("physical escrow custody mismatch and foreign corporation cannot manufacture or sell",async()=>{
 const f=fixture();f.addEscrow();f.state.items.at(-1).ownerID=99;
 assert.equal((await f.read()).reason,"NATIVE_STATION_ITEM_PROVENANCE_CONFLICT");
 const g=fixture();g.policy.getCorporation=()=>({corporationID:O,isNPC:false});
 assert.equal((await g.read()).reason,"NPC_CORPORATION_STATION_IDENTITY_UNVERIFIED");
});
test("no real BPO or no canonical SDE materials refuses manufacturing intent",async()=>{
 const f=fixture();f.state.items=f.state.items.filter(i=>i.itemID!==BPI);
 assert.equal((await f.read()).reason,"NATIVE_ORIGINAL_BLUEPRINT_QUOTE_UNAVAILABLE");
 const g=fixture();g.policy.getMaterials=()=>null;
 assert.equal((await g.read()).reason,"NATIVE_SDE_MATERIAL_QUOTE_INVALID");
});
test("frozen wallet, realistic ISK zero allowed but an absent wallet is not",async()=>{
 const f=fixture();f.state.wallet=0;
 const r=await f.read();assert.equal(r.authoritativeNative,true);assert.equal(r.walletCents,0);
 f.state.wallet=-1;assert.equal((await f.read()).reason,"NPC_CORPORATION_WALLET_UNVERIFIED");
});
test("a concurrent authority RPC cannot double sample one corporation/station",async()=>{
 const f=fixture();let release;f.state.delayed=new Promise(resolve=>{release=resolve});
 const authority=f.authority(),ctx={ownerID:O,stationID:S,systemID:SYS};
 const pending=authority.read(ctx);
 const concurrent=await authority.read(ctx);
 assert.equal(concurrent.reason,"NATIVE_STATION_AUTHORITY_REFRESH_BUSY");
 release();const done=await pending;assert.equal(done.authoritativeNative,true);
});
test("inventory mutation during market RPC invalidates stale economic decision",async()=>{
 const f=fixture();f.state.delayed=Promise.resolve().then(()=>{f.state.version++});
 assert.equal((await f.read()).reason,"NATIVE_STATION_AUTHORITY_CHANGED_DURING_READ");
});
test("corporation wallet change during market RPC invalidates stale plan",async()=>{
 const f=fixture();f.state.delayed=Promise.resolve().then(()=>{f.state.wallet=99});
 assert.equal((await f.read()).reason,"NATIVE_STATION_AUTHORITY_CHANGED_DURING_READ");
});
test("malformed/slow/unavailable Rust book leaves A-Life blocked, never marketOnline",async()=>{
 const f=fixture();f.policy.getOrders=async()=>{throw Error("RUST_TIMEOUT")};
 assert.equal((await f.read()).reason,"RUST_TIMEOUT");
 const g=fixture();g.state.book=null;
 assert.equal((await g.read()).reason,"NATIVE_RUST_MARKET_BOOK_UNAVAILABLE");
});
test("wrong station context and outsider owner fail closed before Rust reads",async()=>{
 const f=fixture(),a=f.authority();
 const r=await a.read({ownerID:O,stationID:999,systemID:SYS});
 assert.equal(r.reason,"NPC_CORPORATION_STATION_IDENTITY_UNVERIFIED");
 assert.equal(f.state.calls,0);
});
test("every native reading keeps item ownership/currency untouched",async()=>{
 const f=fixture();f.addEscrow();
 const snapshot=clone(f.state);
 const a=await f.read();assert.equal(a.authoritativeNative,true);
 assert.deepEqual(f.state.items,snapshot.items);
 assert.deepEqual(f.state.jobs,snapshot.jobs);
 assert.deepEqual(f.state.escrows,snapshot.escrows);
 assert.equal(f.state.wallet,snapshot.wallet);
});

test("direct GameStore item transfer during Rust read invalidates the snapshot without version bump",async()=>{
 const f=fixture();const originalVersion=f.state.version;
 f.state.delayed=Promise.resolve().then(()=>{f.state.items.find(i=>i.typeID===M).quantity=8});
 const r=await f.read();
 assert.equal(r.reason,"NATIVE_STATION_AUTHORITY_CHANGED_DURING_READ");
 assert.equal(f.state.version,originalVersion);
});
