import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSalvageOffers}=require("../integration/coopSalvageNativeOffers.cjs");
const {createSalvageConsent}=require("../integration/coopSalvageNativeConsent.cjs");
const {createSalvageGameAuthority}=require("../integration/coopSalvageGameAuthority.cjs");
const eventID="convoy-30000144-77-5501",manifestKey="30000144-77-1000000";
const original={cargoID:5501,wreckItemID:9001,typeID:34,quantity:6};
const characterIds=[701,702];
const event={status:"READY",event:{type:"CONVOY",stage:"PREPARING",
 outcome:"DEPARTED",linkedTripID:manifestKey,systemID:30000144,entityID:901}};
const row={key:manifestKey,systemID:30000144,stationID:60001,
 fleetID:77,corporationID:10001,haulerIDs:[901],
 cargo:[{cargoID:5501,typeID:34,haulerID:901,quantity:8}]};
const proof={manifestKey,systemID:30000144,haulerID:901,
 stationID:60001,corporationID:10001,wreckID:8001,rows:[original]};
const volunteers={status:"VERIFIED_NATIVE_DUO_VOLUNTEER",eventID,fleetID:33,
 pilots:[{characterID:701,shipID:1701},{characterID:702,shipID:1702}]};
const losses={status:"READY",outcomes:[{systemID:30000144,targetID:901,
 haulerNativeWreckID:8001,status:"HAULER_NATIVE_LOSS_VERIFIED"}]};
const session=id=>({characterID:id,socket:{destroyed:false},
 _space:{initialStateSent:true,shipID:1701,systemID:30000144}});
function fixture(fn){
 let intact=true,offerEvent=event,offerDuo=volunteers,payments=0,deliveries=0;
 let escrow="RESERVED";
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-salvage-quote-"));
 const getWreckItems=()=>intact?[{...original,sourceCargoID:5501,
  sourceKind:"cargo",wreckID:8001}]:[];
 const offers=createSalvageOffers({
  readManifest:()=>({status:"READY",record:row}),
  readWitness:()=>({status:"READY",record:proof}),
  readEvent:()=>offerEvent,readVolunteers:()=>offerDuo,
  readOutcomes:()=>losses,isNpcCorporation:()=>true,
  getWreckItems
 });
 const consent=createSalvageConsent({root,clock:()=>1000000,
  readQuote:offers.readOffer,
  verifyPilot:s=>({status:"SALVAGE_AUTHENTIC_PILOT",characterID:s.characterID})});
 const authority=createSalvageGameAuthority({
  readEvent:()=>offerEvent,
  readFlight:()=>({status:"READY",phase:"FUNDED",booking:{
   manifestKey,haulerID:901,fleetID:77,playerFleetID:33,
   stationID:60001,corporationID:10001,characters:characterIds}}),
  readManifest:()=>({status:"READY",record:row}),
  readVolunteers:()=>offerDuo,readOutcomes:()=>losses,
  ledger:{read:()=>({status:"READY",record:proof}),
   witness:()=>({status:"SALVAGE_ORIGIN_DURABLE"})},
  createTransfer:()=>({deliver:()=>{deliveries++;
   return {status:"ATOMIC_NATIVE_ITEM_MOVED",nativeDurable:true,
    sourceDebited:true,destinationCredited:true}}}),
  readScene:()=>null,readPlayerShip:()=>({itemID:1701,ownerID:701,locationID:60001}),
  readDockedStation:()=>60001,getSessions:()=>[session(701),session(702)],
  readSalvageOffer:offers.readOffer,acceptSalvage:()=>({status:"VERIFIED_DUO_SALVAGE_ACCEPT"}),
  reserveSalvage:()=>({status:"SALVAGE_NATIVE_CORP_ESCROW_RESERVED"}),
  verifyEscrow:()=>({status:escrow,nativeDurable:true,amountISK:30}),
  settleSalvage:()=>{payments++;escrow="SETTLED";
   return {status:"SALVAGE_NATIVE_DUO_PAID",contractID:"salvage-"+manifestKey,amountISK:30}},
  refundSalvage:()=>({status:"SALVAGE_ESCROW_NOT_REFUNDABLE"})
 });
 try{fn({offers,consent,authority,removeWreck:()=>intact=false,
  tamperEvent:()=>offerEvent={status:"NOT_FOUND"},
  tamperDuo:()=>offerDuo={status:"NOT_FOUND"},
  counts:()=>({payments,deliveries}),paid:()=>escrow="SETTLED"})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
function accepted(f){
 assert.equal(f.consent.accept(session(701),manifestKey).status,
  "SALVAGE_WAITING_FOR_OTHER_ACCEPTOR");
 assert.equal(f.consent.accept(session(702),manifestKey).status,
  "VERIFIED_DUO_SALVAGE_ACCEPT");
}
test("fresh salvage offers require original untouched native wreck stock",()=>fixture(f=>{
 assert.equal(f.offers.readOffer(manifestKey).status,"SALVAGE_NATIVE_OFFER_READY");
 f.removeWreck();
 assert.equal(f.offers.readOffer(manifestKey).status,"SALVAGE_OFFER_SOURCE_ALREADY_RECOVERED");
}));
test("original verified contract terms remain readable only via explicit historical mode",()=>fixture(f=>{
 f.removeWreck();
 assert.equal(f.offers.readOffer(manifestKey,{allowStarted:true}).status,
  "SALVAGE_NATIVE_OFFER_READY");
 assert.equal(f.offers.readOffer(manifestKey).status,
  "SALVAGE_OFFER_SOURCE_ALREADY_RECOVERED");
}));
test("both fsynced authenticated consent receipts survive native stock pickup",()=>fixture(f=>{
 accepted(f);f.removeWreck();
 const existing=f.consent.readDuo(manifestKey);
 assert.equal(existing.status,"VERIFIED_DUO_SALVAGE_ACCEPT");
 assert.deepEqual(existing.characters,characterIds);
}));
test("new acceptance fails closed after wreck content has been removed",()=>fixture(f=>{
 f.removeWreck();
 assert.equal(f.consent.accept(session(701),manifestKey).status,
  "SALVAGE_NATIVE_OFFER_NOT_VERIFIED");
}));
test("historical mode never bypasses invalid original event or volunteer evidence",()=>fixture(f=>{
 f.removeWreck();f.tamperEvent();
 assert.equal(f.offers.readOffer(manifestKey,{allowStarted:true}).status,
  "SALVAGE_OFFER_NATIVE_LOSS_OR_DUO_UNVERIFIED");
}));
test("native funded PICKUP -> DELIVER -> wallet SETTLED allowed after source debit",()=>fixture(f=>{
 accepted(f);f.removeWreck();
 const r=f.authority.command({session:session(701),eventID,cargoID:5501,
  action:"DELIVER"});
 assert.equal(r.status,"ATOMIC_NATIVE_ITEM_MOVED");
 assert.equal(r.payoutStatus,"SALVAGE_NATIVE_DUO_PAID");
 assert.deepEqual(f.counts(),{payments:1,deliveries:1});
}));
test("post-pickup OFFER and ACCEPT still cannot create or reserve fresh contract",()=>fixture(f=>{
 accepted(f);f.removeWreck();
 assert.equal(f.authority.command({session:session(701),eventID,cargoID:5501,
  action:"OFFER"}).status,"SALVAGE_NATIVE_OFFER_NOT_VERIFIED");
 assert.equal(f.authority.command({session:session(701),eventID,cargoID:5501,
  action:"ACCEPT"}).status,"SALVAGE_NATIVE_OFFER_NOT_VERIFIED");
 assert.deepEqual(f.counts(),{payments:0,deliveries:0});
}));
test("replayed terminal DELIVER never submits a second wallet settlement",()=>fixture(f=>{
 accepted(f);f.removeWreck();f.paid();
 const r=f.authority.command({session:session(701),eventID,cargoID:5501,
  action:"DELIVER"});
 assert.equal(r.status,"ATOMIC_NATIVE_ITEM_MOVED");
 assert.deepEqual(f.counts(),{payments:0,deliveries:1});
}));
