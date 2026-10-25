import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {decideNativeEconomy}=require("../integration/coopAlifeEconomy.cjs");
const {readEconomySnapshot}=require("../integration/coopAlifeEconomySensor.cjs");
const O=1000010,S=60000001,SYS=30000142,AT=1000000;
const economy=(owner=O,extra={})=>({ownerID:owner,stationID:S,systemID:SYS,
 authoritativeNative:true,oreAtStation:10,mineralStock:20,materialShortage:0,
 productShortage:30,nativeOutputQty:0,nativeReadyJobs:0,nativeOreToRefine:0,
 nativeActiveJobs:0,factoryOnline:true,marketOnline:true,walletCents:5000,...extra});
const pilot=(owner=O,extra={})=>({pilotID:"coop-pilot-101",entityID:400001,systemID:SYS,
 role:"trader",nativeVerified:true,playerControlled:false,health:1,
 underAttack:false,inWarp:false,activeNativeOrder:false,cargoOreQuantity:0,
 cargoAmmoQuantity:0,stationID:S,atStation:true,ownerID:owner,...extra});
const choose=p=>decideNativeEconomy({authoritativeNative:true,systemID:SYS,observedAt:AT,
 stations:[{stationID:S,systemID:SYS,nativeVerified:true,
  economy:economy(9999999)}],pilots:[p]},{now:AT});
test("verified NPC pilot binds economic plan to its own corp and station",()=>{
 const r=choose(pilot(O,{economy:economy()}));
 assert.equal(r.intents.length,1);assert.equal(r.intents[0].stage,"MANUFACTURE");
});
test("another NPC corp's station finances cannot be reused",()=>{
 const r=choose(pilot(O,{economy:economy(O+1)}));
 assert.equal(r.intents.length,0);
 assert.equal(r.blockers[0].reason,"NATIVE_OWNER_STATION_AUTHORITY_MISMATCH");
});
test("a trusted station aggregate must not be used without an exact pilot-corps binding",()=>{
 const r=choose(pilot());
 assert.equal(r.intents.length,0);
 assert.equal(r.blockers[0].reason,"NATIVE_FACTORY_MARKET_PROOF_REQUIRED");
});
test("wrong native station or solar system is rejected before manufacturing",()=>{
 const r=choose(pilot(O,{economy:economy(O,{stationID:S+1})}));
 assert.equal(r.blockers[0].reason,"NATIVE_OWNER_STATION_AUTHORITY_MISMATCH");
});
test("empty native division-1000 wallet never grants free manufacturing",()=>{
 const r=choose(pilot(O,{economy:economy(O,{walletCents:0})}));
 assert.equal(r.intents.length,0);
 assert.equal(r.blockers[0].reason,"NPC_CORPORATION_FUNDS_UNVERIFIED_OR_EMPTY");
});
test("precise Rust escrow failure reaches A-Life blocker news without made-up success",()=>{
 const r=choose(pilot(O,{economy:{authoritativeNative:false,
  reason:"NATIVE_RUST_ESCROW_ORDER_NOT_VISIBLE"}}));
 assert.equal(r.intents.length,0);
 assert.equal(r.blockers[0].reason,"NATIVE_RUST_ESCROW_ORDER_NOT_VISIBLE");
});
test("native itemStore ownerID is propagated into A-Life pilot context",()=>{
 const ship={kind:"ship",nativeNpc:true,itemID:400001,hpRatio:1,
  position:{x:0,y:0,z:0}};
 const scene={systemID:SYS,staticEntities:[{kind:"station",itemID:S,
  position:{x:0,y:0,z:0},radius:500}],
  getEntityByID:id=>id===400001?ship:null};
 const snap=readEconomySnapshot({
  systemID:SYS,scene,links:[{pilotID:"coop-pilot-101",entityID:400001,systemID:SYS}],
  roles:new Map([["coop-pilot-101","trader"]]),
  getController:id=>({entityID:id,systemID:SYS,currentTargetID:0}),
  getStation:id=>({stationID:id,solarSystemID:SYS}),
  getNativeEntity:id=>({entityID:id,systemID:SYS,ownerID:O}),
  listNativeCargo:()=>[],clock:()=>AT
 });
 assert.equal(snap.authoritativeNative,true);
 assert.equal(snap.pilots[0].ownerID,O);
});
test("source-linked market or SDE rejection remains an explicit read-only blocker",()=>{
 const r=choose(pilot(O,{economy:{authoritativeNative:false,reason:"NATIVE_SDE_MATERIAL_QUOTE_INVALID"}}));
 assert.equal(r.blockers[0].reason,"NATIVE_SDE_MATERIAL_QUOTE_INVALID");
 assert.equal(r.intents.length,0);
});
