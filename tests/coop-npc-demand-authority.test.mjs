import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {calculateNativeDemand}=require("../integration/coopNpcDemandAuthority.cjs");
const context={ownerID:10,stationID:20,typeID:215,base:100,maxStock:500,now:200000};
const event=(source,receiptID,quantity,extra={})=>({
 source,receiptID,quantity,ownerID:10,stationID:20,typeID:215,
 authoritativeNative:true,at:199999,...extra
});
test("purchase and market fill are ownership transfers, not consumption",()=>{
 const receipts=[event("NATIVE_MARKET_FILL","fill:1",50),
  event("NATIVE_NPC_PURCHASE","buy:1",50)];
 const result=calculateNativeDemand({...context,receipts});
 assert.equal(result.target,100);
 assert.equal(result.marketFill,50);assert.equal(result.npcPurchased,50);
});
test("one weapon debit boosts target once, even when purchase was observed",()=>{
 const receipts=[event("NATIVE_MARKET_FILL","fill:1",50),
  event("NATIVE_NPC_PURCHASE","buy:1",50),
  event("NATIVE_WEAPON_CONSUMPTION","ammo:1",50)];
 assert.equal(calculateNativeDemand({...context,receipts}).target,150);
});
test("bounded demand cannot grow forever from a flood of spent ammo",()=>{
 assert.equal(calculateNativeDemand({...context,
  receipts:[event("NATIVE_WEAPON_CONSUMPTION","ammo:1",5000)]}).target,300);
});
test("stale physical consumption is not current demand",()=>{
 assert.equal(calculateNativeDemand({...context,receipts:[
  event("NATIVE_WEAPON_CONSUMPTION","old",50,{at:200000-86400001})
 ]}).target,100);
});
test("duplicate receipt and duplicate canonical debit both fail closed",()=>{
 const a=event("NATIVE_WEAPON_CONSUMPTION","a",10,{consumptionID:"physical-1"});
 assert.throws(()=>calculateNativeDemand({...context,receipts:[a,a]}),/REPLAY/);
 const b=event("NATIVE_WEAPON_CONSUMPTION","b",10,{consumptionID:"physical-1"});
 assert.throws(()=>calculateNativeDemand({...context,receipts:[a,b]}),/REPLAY/);
});
test("future and unverified receipts cannot create demand",()=>{
 assert.throws(()=>calculateNativeDemand({...context,receipts:[
  event("NATIVE_MARKET_FILL","f",10,{at:200001})
 ]}),/UNVERIFIED/);
 assert.throws(()=>calculateNativeDemand({...context,receipts:[
  event("NATIVE_WEAPON_CONSUMPTION","x",10,{authoritativeNative:false})
 ]}),/UNVERIFIED/);
});
