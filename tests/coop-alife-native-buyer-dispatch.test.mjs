import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {dispatchAlifeNativeBuyer}=require("../integration/coopAlifeNativeBuyerDispatch.cjs");
const SYS=30000142,STATION=60000001,OWNER=1000010,AT=1000000;
const flags={EVEJS_COOP_ALIFE:"1",EVEJS_COOP_ALIFE_ECONOMY:"1",
 EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY:"1",EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",
 EVEJS_COOP_ALIFE_NATIVE_BUYER:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1",EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER:"1"};
const material=()=>({typeID:34,required:80,available:10,shortage:70});
const pilot=(id=100,extra={})=>({pilotID:"coop-pilot-"+id,entityID:id,
 role:"trader",systemID:SYS,ownerID:OWNER,stationID:STATION,
 nativeVerified:true,playerControlled:false,health:1,underAttack:false,
 inWarp:false,activeNativeOrder:false,atStation:true,
 economy:{authoritativeNative:true,ownerID:OWNER,stationID:STATION,systemID:SYS,
  materialNeeds:[material()]},...extra});
const sample=(ps=[pilot()])=>({authoritativeNative:true,systemID:SYS,
 observedAt:AT,pilots:ps,stations:[{stationID:STATION,nativeVerified:true}]});
const makeIntent=p=>({stage:"BUY_SUPPLIES",pilotID:p.pilotID,entityID:p.entityID,
 stationID:p.stationID,systemID:SYS,
 resource:"station:"+p.stationID+":supplies",intentID:SYS+":"+AT+":"+p.entityID+":BUY_SUPPLIES",
 provenance:"NATIVE_READ_ONLY",nativeMutation:false});
const decision=ps=>({status:"OBSERVED",systemID:SYS,observedAt:AT,
 intents:ps.map(makeIntent)});
function runner({snapshot=sample(),dec=decision([pilot()]),
 state={status:"NPC_PLAYER_PURCHASE_SETTLED",fillID:930000000000001,itemID:1990000300},
 overrides={}}={}){
 let calls=0,request=null;
 const buyer={mode:"ALIFE_NATIVE_RUST_GAMESTORE_BUYER",
  maxUnitPriceCents:1000,maxSpendCents:10000,minReserveCents:2000,
  tick:async args=>{calls++;request=args;return state}};
 const run=()=>dispatchAlifeNativeBuyer({snapshot,decision:dec,
  env:flags,now:AT,resolveBuyer:async()=>buyer,...overrides});
 return {run,get calls(){return calls},get request(){return request},buyer};
}
test("A-Life BUY_SUPPLIES buys exact native SDE material rather than fabricated product",async()=>{
 const f=runner(),r=await f.run();
 assert.equal(r.status,"ALIFE_BUY_DISPATCHED");
 assert.equal(r.nativeMutation,true);assert.equal(f.calls,1);
 assert.equal(f.request.typeID,34);
 assert.equal(f.request.buyerCorpID,OWNER);
 assert.equal(f.request.actorID,100);
 assert.equal(f.request.minReserveCents,2000);
});
test("disabled native Rust flag prevents all NPC trade",async()=>{
 const f=runner({overrides:{env:{...flags,EVEJS_COOP_RUST_NPC_CORP_BUY_PLAYER:"0"}}});
 assert.equal((await f.run()).status,"DISABLED");assert.equal(f.calls,0);
});
test("owner mismatch in station proof blocks before native buy",async()=>{
 const p=pilot(100,{economy:{...pilot().economy,ownerID:2}});
 const f=runner({snapshot:sample([p]),dec:decision([p])});
 assert.equal((await f.run()).reason,"ALIFE_BUY_INTENT_OR_OWNER_UNATTESTED");
 assert.equal(f.calls,0);
});
test("physical NPC under attack cannot execute an economic intent",async()=>{
 const p=pilot(100,{underAttack:true});
 const f=runner({snapshot:sample([p]),dec:decision([p])});
 assert.equal((await f.run()).status,"BLOCKED");assert.equal(f.calls,0);
});
test("forged intent resource, ID or mutating stage is rejected",async()=>{
 const p=pilot();
 for(const patch of [{resource:"station:other"},{nativeMutation:true},
  {intentID:"fake"},{provenance:"VIRTUAL"}]){
  const f=runner({dec:{...decision([p]),intents:[{...makeIntent(p),...patch}]}});
  assert.equal((await f.run()).reason,"ALIFE_BUY_INTENT_OR_OWNER_UNATTESTED");
  assert.equal(f.calls,0);
 }
});
test("two traders of same station cannot create a second paid buyer action",async()=>{
 const a=pilot(100),b=pilot(101);
 const f=runner({snapshot:sample([a,b]),dec:decision([a,b])});
 const r=await f.run();
 assert.equal(r.purchases.length,1);assert.equal(f.calls,1);
});
test("unknown or stale economic snapshot blocks real Rust purchase",async()=>{
 const f=runner({overrides:{now:AT+40000}});
 assert.equal((await f.run()).reason,"ALIFE_BUY_INTENT_SNAPSHOT_MISMATCH");
 assert.equal(f.calls,0);
});
test("aggregate shortage without concrete SDE material is not purchasable",async()=>{
 const p=pilot(100,{economy:{...pilot().economy,materialNeeds:[]}});
 const f=runner({snapshot:sample([p]),dec:decision([p])});
 assert.equal((await f.run()).reason,"ALIFE_BUY_NO_CONCRETE_MATERIAL");
});
test("max purchases cap refuses unbounded station acquisitions",async()=>{
 const f=runner({overrides:{maxPurchases:10}});
 assert.equal((await f.run()).reason,"ALIFE_BUY_INTENT_SNAPSHOT_MISMATCH");
});
test("buy failure is never presented as completed native mutation",async()=>{
 const f=runner({state:{status:"BLOCKED",reason:"NPC_BUY_NO_SPENDABLE_ISK"}});
 const r=await f.run();
 assert.equal(r.nativeMutation,false);
 assert.equal(r.purchases[0].status,"BLOCKED");
});
test("material shortage can only come from true required minus owned",async()=>{
 const p=pilot(100,{economy:{...pilot().economy,
  materialNeeds:[{typeID:34,required:80,available:10,shortage:99}]}});
 const f=runner({snapshot:sample([p]),dec:decision([p])});
 assert.equal((await f.run()).reason,"ALIFE_BUY_SDE_MATERIAL_NEEDS_INVALID");
});
