import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makeBinding,routeGate,installServerAuthority,inspect}=require("../integration/coopEscortNativeBinding.cjs");
const old=Object.fromEntries(["EVEJS_COOP_ESCORT_CONTRACTS","EVEJS_COOP_ESCORT_ROUTE_GATE",
"EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_ESCORT_WALLET",
"EVEJS_COOP_NATIVE_HAUL_MANIFEST","EVEJS_COOP_ESCORT_REFUNDS",
"EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY"].map(k=>[k,process.env[k]]));
for(const k of Object.keys(old))process.env[k]="1";
const key="30000144-77-1000000";
const booking={contractID:"escort-native-01",manifestKey:key,
 systemID:30000144,fleetID:77,haulerID:901,stationID:60001,
 corporationID:10001,characters:[701,702],amountISK:20000};
const route={manifestKey:key,systemID:30000144,fleetID:77,
 stationID:60001,corporationID:10001,haulerIDs:[901]};
const full={status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",key,
 cargoIDs:[5001],stacks:1,quantity:5};
const delivery={manifestKey:key,trip:{manifestID:key,systemID:30000144,
 fleetID:77,stationID:60001,corporationID:10001,haulers:{"901":{}}},
 terminalProof:{status:"DELIVERED",terminal:true,nativeFullManifestProof:full}};
function fixture(options={}){
 let payments=0,reserves=0,deliveryCalls=0,incidents=[];
 const runtime={
  nativeFunds:{capabilities:()=>({nativeDurable:true,atomicDualCredit:true}),
   verifySettlement:c=>payments?{
    status:"SETTLED",contractID:c.contractID,corporationID:c.corporationID,
    amountISK:c.amountISK,nativeDurable:true,
    credits:c.characters.map(characterID=>({characterID,amountISK:c.amountISK/2}))
   }:{status:"NOT_SETTLED"},
   verifyRefund:()=>({status:"NOT_REFUNDED"})},
  fundBeforeWarp:x=>{reserves++;return {status:"FUNDED_BEFORE_WARP",contractID:booking.contractID,manifestKey:x.manifestKey}},
  recordDelivery:x=>{deliveryCalls++;return {status:"DURABLE_NATIVE_DELIVERY_RECORDED",manifestKey:x.manifestKey}},
  finishAfterRaid:c=>{payments++;return {status:"SETTLED",contractID:c.contractID}},
  refundProvenLoss:()=>({status:"REFUNDED"}),
  refundWreckedFlight:()=>({status:"REFUNDED",contractID:booking.contractID,amountISK:20000}),
  readFlight:k=>({status:"READY",phase:options.notDelivered?"FUNDED":"DELIVERED",booking}),
  inspectRefundRecovery:()=>({status:"NO_REFUND_RECOVERY_PENDING"}),
  listDeliveredFlights:()=>({status:"READY",manifestKeys:[key]})};
 return {runtime,readNativeIncident:()=>({status:"READY",incidents}),
  incidents,counts:()=>({payments,reserves,deliveryCalls})};
}
test("station forwarding has stable object identity across calls",()=>{
 assert.strictEqual(routeGate(),routeGate());
});
test("missing native binding blocks the physical route even with all flags ON",()=>{
 assert.equal(routeGate().fundBeforeWarp(route).status,"ESCORT_NATIVE_RUNTIME_NOT_INSTALLED");
 assert.equal(routeGate().recordDelivered(delivery).status,"ESCORT_NATIVE_RUNTIME_NOT_INSTALLED");
});
test("real binding accepts only exact one-hauler native route and terminal identity",()=>{
 const f=fixture(),b=makeBinding(f);
 assert.equal(b.fundBeforeWarp(route).status,"FUNDED_BEFORE_WARP");
 assert.equal(b.fundBeforeWarp({...route,haulerIDs:[901,902]}).status,"NATIVE_PREWARP_ROUTE_UNVERIFIED");
 assert.equal(b.recordDelivered({...delivery,manifestKey:"30000144-77-9999"}).status,"NATIVE_TERMINAL_ROUTE_UNVERIFIED");
 assert.equal(b.recordDelivered(delivery).status,"DURABLE_NATIVE_DELIVERY_RECORDED");
 assert.deepEqual(f.counts(),{payments:0,reserves:1,deliveryCalls:1});
});
test("only one exact genuine incident with matching two pilots can settle",()=>{
 const f=fixture(),b=makeBinding(f);
 assert.equal(b.settleVerifiedNativeRaid(key).status,"NO_VERIFIED_NATIVE_RAID_TO_SETTLE");
 f.incidents.push({systemID:30000144,targetID:901,pirateID:202,targetRole:"hauler",
  key:"30000144:202:901",duoFleetID:33,characters:[701,702],
  status:"PIRATE_WRECK_CONFIRMED",closed:true,nativeWreckID:9001});
 assert.equal(b.settleVerifiedNativeRaid(key).status,"SETTLED");
 assert.equal(f.counts().payments,1);
});
test("late pirate after delivery is paid by durable journal replay exactly once",()=>{
 const f=fixture(),b=makeBinding(f);
 const before=b.reconcilePendingDeliveries({systemID:30000144,maxTrips:4});
 assert.equal(before.status,"NATIVE_RECONCILE_CHECKED");
 assert.equal(before.pending,1);assert.equal(f.counts().payments,0);
 f.incidents.push({systemID:30000144,targetID:901,pirateID:202,
  targetRole:"hauler",key:"30000144:202:901",duoFleetID:33,
  characters:[701,702],status:"PIRATE_WRECK_CONFIRMED",
  closed:true,nativeWreckID:9001});
 const paid=b.reconcilePendingDeliveries({systemID:30000144,maxTrips:4});
 assert.equal(paid.status,"NATIVE_RECONCILE_CHECKED");
 assert.equal(paid.paid,1);
 assert.equal(f.counts().payments,1);
 const replay=makeBinding(f).reconcilePendingDeliveries({
  systemID:30000144,maxTrips:4});
 assert.equal(replay.alreadyPaid,1);
 assert.equal(f.counts().payments,1);
});
test("native settlement recovery stays disabled without separate opt-in flag",()=>{
 const f=fixture(),b=makeBinding(f);
 process.env.EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY="0";
 try{assert.equal(b.reconcilePendingDeliveries({}).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY="1"}
});
test("invalid source scan cannot trigger arbitrary native wallet payouts",()=>{
 const f=fixture(),b=makeBinding(f);
 assert.equal(b.reconcilePendingDeliveries({maxTrips:999}).status,
  "NATIVE_RECONCILE_LIMIT_INVALID");
 assert.equal(b.reconcilePendingDeliveries({systemID:-4}).status,
  "NATIVE_RECONCILE_SYSTEM_INVALID");
 assert.equal(f.counts().payments,0);
});
test("fake single-player, wrong fleet or missing wreck never authorizes payout",()=>{
 const f=fixture(),b=makeBinding(f);
 f.incidents.push({systemID:30000144,targetID:901,pirateID:202,targetRole:"hauler",
  key:"30000144:202:901",duoFleetID:33,characters:[701],
  status:"PIRATE_WRECK_CONFIRMED",closed:true,nativeWreckID:9001});
 assert.equal(b.settleVerifiedNativeRaid(key).status,"NO_VERIFIED_NATIVE_RAID_TO_SETTLE");
 assert.equal(f.counts().payments,0);
});
test("two different matching pirates are an ambiguous payout source and blocked",()=>{
 const f=fixture(),b=makeBinding(f);
 for(const pirateID of [202,203])f.incidents.push({
  systemID:30000144,targetID:901,pirateID,targetRole:"hauler",
  key:"30000144:"+pirateID+":901",duoFleetID:33,characters:[701,702],
  status:"PIRATE_WRECK_CONFIRMED",closed:true,nativeWreckID:9000+pirateID});
 assert.equal(b.settleVerifiedNativeRaid(key).status,"NATIVE_INCIDENT_AMBIGUOUS");
 assert.equal(f.counts().payments,0);
});
test("unrecorded terminal station delivery blocks payout",()=>{
 const f=fixture({notDelivered:true}),b=makeBinding(f);
 assert.equal(b.settleVerifiedNativeRaid(key).status,"NATIVE_FLIGHT_DELIVERY_NOT_RECORDED");
});
test("actual native binding requires real-loss proof gate for corporate refund",()=>{
 const f=fixture(),b=makeBinding(f);
 assert.equal(b.refundNativeWreck(key).status,"REFUNDED");
 assert.equal(b.refundNativeWreck("bad").status,"NATIVE_REFUND_MANIFEST_KEY_INVALID");
 process.env.EVEJS_COOP_ESCORT_REFUNDS="0";
 try{assert.equal(b.refundNativeWreck(key).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_REFUNDS="1"}
});
test("native bank feature OFF blocks route and money",()=>{
 const f=fixture(),b=makeBinding(f);
 process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET="0";
 try{assert.equal(b.fundBeforeWarp(route).status,"DISABLED");
  assert.equal(b.settleVerifiedNativeRaid(key).status,"DISABLED");
  assert.equal(f.counts().reserves,0)}
 finally{process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET="1"}
});
test("explicit binding requires authoritative native wallet features",()=>{
 const f=fixture();f.runtime.nativeFunds.capabilities=()=>({nativeDurable:false});
 assert.throws(()=>makeBinding(f),/ESCORT_NATIVE_BINDING_AUTHORITIES_REQUIRED/);
});
test("one-time server mount enables previously created physical route forwarder",()=>{
 const gate=routeGate(),f=fixture();
 assert.equal(installServerAuthority(f).status,"ESCORT_NATIVE_RUNTIME_BOUND");
 assert.strictEqual(gate,routeGate());
 assert.equal(gate.fundBeforeWarp(route).status,"FUNDED_BEFORE_WARP");
 assert.equal(gate.recordDelivered(delivery).status,"DURABLE_NATIVE_DELIVERY_RECORDED");
 assert.equal(installServerAuthority(f).status,"ESCORT_RUNTIME_ALREADY_BOUND");
 assert.equal(inspect().backend,"IN_PROCESS_NATIVE_ONLY");
});
process.on("exit",()=>{for(const [k,v] of Object.entries(old)){
 if(v===undefined)delete process.env[k];else process.env[k]=v
}});
