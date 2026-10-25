import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verifiedHaulerLoss}=require("../integration/coopEscortNativeBootstrap.cjs");
const c={contractID:"escort-30000144-77-5501",
 manifestKey:"30000144-77-1000000",
 corporationID:10001,systemID:30000144,
 pirateID:202,haulerID:901,incidentKey:"30000144:202:901"};
const trueWreck={key:c.incidentKey,systemID:c.systemID,pirateID:c.pirateID,
 targetID:c.haulerID,status:"HAULER_NATIVE_LOSS_VERIFIED",
 haulerNativeWreckID:88001,verifiedWarehouseStacks:[]};
test("actual zero-delivered native hauler wreck is a durable loss witness",()=>{
 const got=verifiedHaulerLoss({contract:c,readOutcomes:()=>({
  status:"READY",outcomes:[trueWreck]})});
 assert.equal(got.status,"DURABLE_NATIVE_CONVOY_TERMINAL_FAILURE");
 assert.equal(got.failureWitnessID,88001);
 assert.equal(got.contractID,c.contractID);
 assert.equal(got.manifestKey,c.manifestKey);
});
test("fake in-memory missing ship is never sufficient for native refund",()=>{
 const got=verifiedHaulerLoss({contract:c,readOutcomes:()=>({
  status:"READY",outcomes:[]})});
 assert.equal(got.status,"NATIVE_FAILURE_NOT_VERIFIED");
});
test("hauler wreck with real stock already delivered cannot assert full cargo loss",()=>{
 const got=verifiedHaulerLoss({contract:c,readOutcomes:()=>({
  status:"READY",outcomes:[{...trueWreck,
   status:"PARTIAL_STOCK_DELIVERED_THEN_HAULER_LOST",
   verifiedWarehouseStacks:[{cargoID:5501}]}]})});
 assert.equal(got.status,"NATIVE_FAILURE_NOT_VERIFIED");
});
test("a wreck for another hauler or pirate cannot refund this contract",()=>{
 const got=verifiedHaulerLoss({contract:c,readOutcomes:()=>({
  status:"READY",outcomes:[{...trueWreck,targetID:999}]})});
 assert.equal(got.status,"NATIVE_FAILURE_NOT_VERIFIED");
});
test("ambiguous duplicate native loss witnesses fail closed",()=>{
 const got=verifiedHaulerLoss({contract:c,readOutcomes:()=>({
  status:"READY",outcomes:[trueWreck,trueWreck]})});
 assert.equal(got.status,"NATIVE_FAILURE_NOT_VERIFIED");
});
test("unknown or corrupt native outcome journal fails closed",()=>{
 const got=verifiedHaulerLoss({contract:c,readOutcomes:()=>({
  status:"OUTCOME_JOURNAL_CORRUPT",outcomes:[trueWreck]})});
 assert.equal(got.status,"NATIVE_FAILURE_NOT_VERIFIED");
});
