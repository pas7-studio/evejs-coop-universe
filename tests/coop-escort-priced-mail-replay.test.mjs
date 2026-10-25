import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../integration/coopEscortPricedOffers.cjs",import.meta.url),"utf8");
const prepared={eventID:"convoy-30000144-77-123",
 contractID:"escort-30000144-77-123",
 systemID:30000144,fleetID:77,corporationID:1000152,
 stationID:60000001,haulerID:901,
 cargoIDs:[123],amountISK:600000,expiresAt:9999999999999};
function fixture(status,enabled=true){
 const sent=[];
 const module={exports:{}};
 const native={
  quoteFromNative:()=>({status,quote:prepared}),
  readQuote:()=>({status:"READY",quote:prepared}),
  accept:()=>({status:"NOT_ACCEPTING"}),
  readAccepted:()=>({status:"NOT_FOUND"}),
  acceptedForManifest:()=>({status:"NOT_FOUND"})
 };
 const proc={env:{
  EVEJS_COOP_ESCORT_PAID_ACCEPT:"1",
  EVEJS_COOP_NATIVE_JOB_AGENT:enabled?"1":"0",
  EVEJS_COOP_OPPORTUNITY_MAIL:"1"
 }};
 const load=n=>{
  if(n==="node:fs")return fs;
  if(n==="node:path")return path;
  if(n==="./coopNativeJobNotifications")return {
   notifyNativeQuote:q=>{sent.push(q);return {status:"NATIVE_AGENT_MAIL_DISPATCHED",sent:1}}
  };
  throw new Error("UNEXPECTED_IMPORT "+n);
 };
 vm.runInNewContext(source,{module,require:load,process:proc,Buffer});
 assert.equal(module.exports.installServerAuthority(native).status,
  "PRICED_ESCORT_NATIVE_AUTHORITY_INSTALLED");
 return {send:()=>module.exports.offerFromNative({eventID:prepared.eventID}),
  sent,proc};
}
test("fresh source-verified quote dispatches native agent EVEmail hook",()=>{
 const f=fixture("NATIVE_QUOTE_DURABLY_PREPARED");
 assert.equal(f.send().status,"NATIVE_QUOTE_DURABLY_PREPARED");
 assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].contractID,prepared.contractID);
});
test("replayed original persisted quote can dispatch missed mail after restart",()=>{
 const f=fixture("NATIVE_QUOTE_READY");
 assert.equal(f.send().status,"NATIVE_QUOTE_READY");
 assert.equal(f.sent.length,1);
});
test("no dispatch for malformed, untrusted or rejected native quotes",()=>{
 for(const status of ["DISABLED","NATIVE_PREPARING_EVENT_UNVERIFIED",
  "NATIVE_QUOTE_ROUTE_CONFLICT","PERSISTED_RECORD_CORRUPT"]){
  const f=fixture(status);
  assert.equal(f.send().status,status);
  assert.equal(f.sent.length,0);
 }
});
test("feature flag OFF leaves existing native quote and no unsolicited mail",()=>{
 const f=fixture("NATIVE_QUOTE_READY",false);
 assert.equal(f.send().status,"NATIVE_QUOTE_READY");
 assert.equal(f.sent.length,0);
});
test("no client-generated offer when native trusted authority absent",()=>{
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:n=>n==="node:fs"?fs:path,
  process:{env:{EVEJS_COOP_NATIVE_JOB_AGENT:"1",
   EVEJS_COOP_OPPORTUNITY_MAIL:"1"}},Buffer});
 assert.equal(module.exports.offerFromNative({eventID:prepared.eventID}).status,
  "PRICED_ESCORT_NATIVE_AUTHORITY_UNAVAILABLE");
});
