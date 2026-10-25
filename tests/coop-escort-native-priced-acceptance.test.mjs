import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createPricedOffers}=require("../integration/coopEscortPricedOffers.cjs");
const flag=process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT;
process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT="1";
const eventID="convoy-30000144-77-5501";
const quoteRoute={systemID:30000144,fleetID:77,stationID:60001,
 corporationID:10001,haulerID:901,cargoIDs:[5501,5502]};
const acceptedRoute={manifestKey:"30000144-77-1000000",
 systemID:30000144,fleetID:77,stationID:60001,
 corporationID:10001,haulerID:901};
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-native-price-"));
 let now=1000000,validQuote=true,verified=true,sourceCargo=[5501,5502];
 const sessions=[701,702].map((characterID,i)=>({characterID,
  _space:{shipID:1701+i,systemID:30000144,initialStateSent:true},
  socket:{destroyed:false}}));
 const pilots=sessions.map(s=>({characterID:s.characterID,shipID:s._space.shipID}));
 const deps={root,clock:()=>now,
  readEvent:id=>({status:"READY",event:{id,type:"CONVOY",stage:"PREPARING",
   phase:"ACTIVE",systemID:30000144,entityID:901,stationID:60001,
   expiresAt:8000000}}),
  authorizeNativeQuote:({event,route})=>validQuote?{
   status:"AUTHORIZED_NATIVE_CORPORATION_ESCORT_QUOTE",
   eventID:event.event.id,contractID:"escort-30000144-77-5501",
   systemID:route.systemID,fleetID:route.fleetID,
   stationID:route.stationID,corporationID:route.corporationID,
   haulerID:route.haulerID,cargoIDs:route.cargoIDs.slice().sort((a,b)=>a-b),
   amountISK:20000,nativeCorporationBalanceVerified:true}:{
   status:"UNFUNDED_CORPORATION"},
  readDuoVolunteers:id=>verified?{
   status:"VERIFIED_NATIVE_DUO_VOLUNTEER",eventID:id,systemID:30000144,
   entityID:901,fleetID:33,pilots}:{
   status:"NOT_AUTHENTIC"},
  verifyLiveAcceptingPilot:({session})=>({
   status:"VERIFIED_NATIVE_ESCORT_ACCEPTOR",
   characterID:session.characterID,shipID:session._space.shipID,
   systemID:30000144,fleetID:33}),
  readManifest:key=>({status:"READY",record:{key,
   systemID:30000144,fleetID:77,stationID:60001,
   corporationID:10001,haulerIDs:[901],
   cargo:sourceCargo.map(cargoID=>({cargoID}))}})};
 const api=()=>createPricedOffers(deps);
 try{fn({api,now:value=>now=value,unfund:()=>validQuote=false,
  notVolunteers:()=>verified=false,cargo:ids=>sourceCargo=ids,
  sessions,root})}finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("server-only corporate quote is durable and exact, no wallet writes",()=>fixture(f=>{
 const r=f.api().quoteFromNative({eventID,route:quoteRoute});
 assert.equal(r.status,"NATIVE_QUOTE_DURABLY_PREPARED");
 assert.equal(r.quote.amountISK,20000);
 assert.equal(r.quote.contractID,"escort-30000144-77-5501");
 assert.equal(f.api().readQuote(eventID).quote.amountISK,20000);
}));
test("source retry cannot create a second offer with the same real native cargo",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});
 assert.equal(f.api().quoteFromNative({eventID,route:quoteRoute}).status,"NATIVE_QUOTE_READY");
 assert.equal(f.api().quoteFromNative({eventID,route:{...quoteRoute,corporationID:10002}}).status,
  "NATIVE_QUOTE_ROUTE_CONFLICT");
}));
test("an unfunded NPC corporation cannot mint its own advertised price",()=>fixture(f=>{
 f.unfund();
 assert.equal(f.api().quoteFromNative({eventID,route:quoteRoute}).status,
  "NATIVE_CORPORATE_QUOTE_NOT_AUTHORIZED");
}));
test("one real player accepting the price cannot book a two-player payment",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});
 assert.equal(a.accept(f.sessions[0],eventID).status,"WAITING_FOR_OTHER_PAID_ACCEPTOR");
 assert.equal(a.acceptedForManifest(acceptedRoute).status,"PAID_DUO_ACCEPTANCE_NOT_COMPLETE");
}));
test("both distinct real pilots explicitly accept the SAME fixed ISK quote",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});
 assert.equal(a.accept(f.sessions[0],eventID).status,"WAITING_FOR_OTHER_PAID_ACCEPTOR");
 const accepted=f.api().accept(f.sessions[1],eventID);
 assert.equal(accepted.status,"DURABLE_TWO_PILOT_PAID_ACCEPTANCE");
 assert.deepEqual(accepted.characters,[701,702]);assert.equal(accepted.amountISK,20000);
 const approved=f.api().acceptedForManifest(acceptedRoute);
 assert.equal(approved.status,"AUTHORIZED_NATIVE_ESCORT_BOOKING");
 assert.equal(approved.playerFleetID,33);
 assert.equal(approved.contractID,"escort-30000144-77-5501");
}));
test("already accepted priced contract survives process restart and cannot double-book a new quote",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});
 a.accept(f.sessions[0],eventID);a.accept(f.sessions[1],eventID);
 assert.equal(f.api().readAccepted(eventID).status,"DURABLE_TWO_PILOT_PAID_ACCEPTANCE");
 assert.equal(f.api().accept(f.sessions[0],eventID).status,"DURABLE_TWO_PILOT_PAID_ACCEPTANCE");
}));
test("a previously accepted quote remains read-only auditable after its deadline",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});
 a.accept(f.sessions[0],eventID);a.accept(f.sessions[1],eventID);
 f.now(8000001);
 const evidence=f.api().acceptedForManifest(acceptedRoute);
 assert.equal(evidence.status,"AUTHORIZED_NATIVE_ESCORT_BOOKING");
 assert.equal(evidence.quoteExpiresAt,8000000);
 // Separate native runtime MUST reject FIRST reserve at or after this time.
}));
test("native manifest with different cargo is NOT authorized by real player acceptance",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});
 a.accept(f.sessions[0],eventID);a.accept(f.sessions[1],eventID);
 f.cargo([5501,9999]);
 assert.equal(f.api().acceptedForManifest(acceptedRoute).status,"ACCEPTED_QUOTE_SOURCE_MISMATCH");
}));
test("expiry denies new acceptance and future native corporate debit",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});
 f.now(8000001);
 assert.equal(a.accept(f.sessions[0],eventID).status,"NATIVE_PRICED_OFFER_EXPIRED");
 assert.equal(a.acceptedForManifest(acceptedRoute).status,"PAID_DUO_ACCEPTANCE_NOT_COMPLETE");
}));
test("a user cannot accept any price without verified two-player volunteer receipt",()=>fixture(f=>{
 const a=f.api();a.quoteFromNative({eventID,route:quoteRoute});f.notVolunteers();
 assert.equal(a.accept(f.sessions[0],eventID).status,"PAID_ACCEPT_NEEDS_VERIFIED_NATIVE_DUO");
}));
test("paid acceptance remains default OFF",()=>fixture(f=>{
 process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT="0";
 try{assert.equal(f.api().quoteFromNative({eventID,route:quoteRoute}).status,"DISABLED");
  assert.equal(f.api().accept(f.sessions[0],eventID).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT="1"}
}));
process.on("exit",()=>{if(flag===undefined)delete process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT;
 else process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT=flag});
