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

test("native follower arrival requires matching accepted order, same ships, same destination",()=>{
 const start=Date.parse("2026-10-25T12:00:00Z");
 const row=(event,at,details)=>JSON.stringify({
  event,at:new Date(start+at*1000).toISOString(),...details
 });
 const order={status:"NATIVE_WARP_ORDER_ACCEPTED",
  commanderCharacterID:2001,commanderShipID:90001,
  followerCharacterID:2002,followerShipID:90002,
  systemID:30000144,targetEntityID:44221,arrivalVerified:false};
 const arrived={status:"NATIVE_FLEET_FOLLOWER_ARRIVAL_VERIFIED",
  arrivalVerified:true,actualFollowerWarpObserved:true,
  commanderCharacterID:2001,commanderShipID:90001,
  followerCharacterID:2002,followerShipID:90002,
  systemID:30000144,targetEntityID:44221,
  reason:"NATIVE_SHIPS_AT_DESTINATION",teammateDistanceMeters:2200};
 const accepted=row("coop-fleet-warp-native-order",0,order);
 const arrival=row("coop-fleet-warp-physical-arrival",35,arrived);
 const opts={now:start+40000};
 const good=summarize([accepted,arrival].join("\n"),opts);
 assert.equal(good.fleetWarpArrivalVerified,true);
 assert.equal(good.nativeFleetWarpPhysicalArrivalsVerified,1);
 assert.equal(good.lastNativeFleetWarpOrders[0].arrivalVerified,true);
 assert.equal(good.clientRenderingVerified,false);
 assert.equal(summarize(arrival,opts).fleetWarpArrivalVerified,false);
 const mismatch=row("coop-fleet-warp-physical-arrival",35,{
  ...arrived,targetEntityID:44222});
 assert.equal(summarize([accepted,mismatch].join("\n"),opts).fleetWarpArrivalVerified,false);
 const clone=row("coop-fleet-warp-physical-arrival",35,{
  ...arrived,followerShipID:99002});
 assert.equal(summarize([accepted,clone].join("\n"),opts).fleetWarpArrivalVerified,false);
 const falseArrival=row("coop-fleet-warp-physical-arrival",35,{
  ...arrived,actualFollowerWarpObserved:false});
 assert.equal(summarize([accepted,falseArrival].join("\n"),opts).fleetWarpArrivalVerified,false);
});
test("native fleet warp physical timeout does not imply both players arrived",()=>{
 const origin=Date.parse("2026-10-25T12:00:00Z");
 const base={commanderCharacterID:2001,commanderShipID:90001,
  followerCharacterID:2002,followerShipID:90002,
  systemID:30000144,targetEntityID:44221};
 const events=[
  {event:"coop-fleet-warp-native-order",status:"NATIVE_WARP_ORDER_ACCEPTED",
   at:new Date(origin).toISOString(),...base},
  {event:"coop-fleet-warp-physical-arrival",status:"NATIVE_FLEET_FOLLOWER_ARRIVAL_UNVERIFIED",
   arrivalVerified:false,reason:"NATIVE_ARRIVAL_TIMEOUT",
   at:new Date(origin+120000).toISOString(),...base}
 ];
 const r=summarize(events.map(x=>JSON.stringify(x)).join("\n"),
  {now:origin+150000});
 assert.equal(r.nativeFleetWarpOrdersAccepted,1);
 assert.equal(r.fleetWarpArrivalVerified,false);
 assert.equal(r.nativeFleetWarpArrivalsUnverified,1);
 assert.equal(r.lastUnverifiedFleetArrivals[0].reason,"NATIVE_ARRIVAL_TIMEOUT");
});
