import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {summarize}=require("../scripts/coop-party-report.cjs");
const now=Date.parse("2026-10-25T12:00:00.000Z");
const event=(event,details={})=>JSON.stringify({event,at:new Date(now-60000).toISOString(),...details});
test("fleet follower native warp command is reported as order, never arrival",()=>{
 const log=event("coop-fleet-warp-native-order",{
  status:"NATIVE_WARP_ORDER_ACCEPTED",commanderCharacterID:2001,
  followerCharacterID:2002,followerShipID:90002,systemID:30000142,
  targetEntityID:123456,arrivalVerified:false
 });
 const r=summarize(log,{now});
 assert.equal(r.nativeFleetWarpOrdersAccepted,1);
 assert.equal(r.nativeFleetWarpOrdersFailed,0);
 assert.equal(r.fleetWarpArrivalVerified,false);
 assert.equal(r.clientRenderingVerified,false);
 assert.equal(r.status,"NO_ACTIVE_PILOT_EVIDENCE");
 assert.equal(r.lastNativeFleetWarpOrders[0].followerShipID,90002);
});
test("failed native fleet warp is not presented as an accepted warp",()=>{
 const log=event("coop-fleet-warp-native-order",{
  status:"NATIVE_WARP_ORDER_FAILED",commanderCharacterID:2001,
  followerCharacterID:2002,systemID:30000142,error:"SCRAMBLED"
 });
 const r=summarize(log,{now});
 assert.equal(r.nativeFleetWarpOrdersAccepted,0);
 assert.equal(r.nativeFleetWarpOrdersFailed,1);
 assert.equal(r.lastNativeFleetWarpFailures[0].error,"SCRAMBLED");
});
test("same-scene safety skip is explicit and cannot establish player rendezvous",()=>{
 const log=event("coop-fleet-warp-skip",{
  characterID:2001,followerCharacterID:2002,reason:"SPACE_NOT_READY"
 });
 const r=summarize(log,{now});
 assert.equal(r.nativeFleetWarpFollowersSkipped,1);
 assert.equal(r.nativeFleetWarpOrdersAccepted,0);
 assert.equal(r.lastNativeFleetWarpSkips[0].reason,"SPACE_NOT_READY");
 assert.equal(r.serverMutualVisibility,false);
});
