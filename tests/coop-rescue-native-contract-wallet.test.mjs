import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRescueContracts}=require("../integration/coopRescueContracts.cjs");
const old=process.env.EVEJS_COOP_RESCUE_CONTRACTS;
process.env.EVEJS_COOP_RESCUE_CONTRACTS="1";
const id="convoy-30000144-77-5501",key="30000144-77-1000000";
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-rescue-money-"));
 let wreck=true,validCargo=true,amount=20000;
 let escrow=0,corp=50000,paid=0,refunded=0;
 let stock=[],rivalCargo=[];
 const c={systemID:30000144,fleetID:77,stationID:60001,
  corporationID:10001,haulerID:901,playerFleetID:33,
  manifestKey:key,characters:[701,702]};
 const funds={
  reserveAtomic:()=>{if(escrow)throw Error("DUPLICATE_RESERVE");
   escrow=1;corp-=20000;return {status:"RESERVED"}},
  verifyReservation:()=>({status:escrow===1?"RESERVED":escrow?"NOT_RESERVED":"NOT_FOUND"}),
  verifySettlement:c=>({status:escrow===2?"SETTLED":escrow?"NOT_SETTLED":"NOT_FOUND",
   nativeDurable:escrow===2,contractID:c.contractID,corporationID:c.corporationID,
   amountISK:c.amountISK,credits:escrow===2?c.characters.map(
    characterID=>({characterID,amountISK:c.amountISK/2})):[]}),
  settleAtomic:()=>{if(escrow!==1)throw Error("ESCROW_NOT_RESERVED");
   escrow=2;paid+=20000;return {status:"SETTLED"}},
  verifyRefund:contract=>({status:escrow===3?"REFUNDED":escrow?"NOT_REFUNDED":"NOT_FOUND",
   nativeDurable:escrow===3,contractID:contract.contractID,
   corporationID:contract.corporationID,amountISK:contract.amountISK}),
  refundRescueAtomic:contract=>{
   const witness=get().verifyRivalLoss(contract);
   if(witness.status!=="DURABLE_NATIVE_RESCUE_RIVAL_FAILURE"||escrow!==1)
    throw Error("RIVAL_CUSTODY_REQUIRED");
   escrow=3;corp+=20000;refunded++;return {status:"REFUNDED"}
  }
 };
 let engine;
 function get(){
  if(engine)return engine;
  engine=createRescueContracts({root,clock:()=>1000000,
   amountISK:amount,readEvent:()=>({status:"READY",event:{
    type:"CONVOY",stage:"PREPARING",outcome:"DEPARTED",
    linkedTripID:key,entityID:901,systemID:30000144}}),
   readFlight:()=>({status:"READY",phase:"FUNDED",booking:c}),
   readManifest:()=>({status:"READY",record:{key,...c,
    cargo:[{cargoID:5501,typeID:34,quantity:8}]}}),
   readOutcomes:()=>({status:"READY",outcomes:[{
    systemID:30000144,targetID:901,status:"HAULER_NATIVE_LOSS_VERIFIED",
    haulerNativeWreckID:8001}]}),
   getWreck:()=>wreck?{wreckID:8001,sourceEntityID:901,systemID:30000144}:null,
   getWreckItems:()=>validCargo&&wreck?[{
    wreckItemID:8201,wreckID:8001,sourceKind:"cargo",
    sourceCargoID:5501,sourceOriginalQuantity:8,typeID:34,quantity:8}]:[],
   readWarehouseItems:()=>stock,readNativeNpcCargo:()=>rivalCargo,
   readVolunteer:()=>({status:"VERIFIED_NATIVE_DUO_VOLUNTEER",
    fleetID:33,pilots:[{characterID:701},{characterID:702}]}),
   isNpcCorporation:()=>true,nativeFunds:funds});
  return engine;
 }
 const pilot=characterID=>({characterID,socket:{destroyed:false}});
 const a=()=>get().accept({session:pilot(701),eventID:id});
 const b=()=>get().accept({session:pilot(702),eventID:id});
 try{fn({get,a,b,pilot,root,
  state:()=>({corp,escrow,paid,refunded}),
  loseWreck:()=>wreck=false,invalid:()=>validCargo=false,
  deliver:q=>stock=[{ownerID:10001,locationID:60001,flagID:4,
   typeID:34,quantity:q,customInfo:
    "coop-rescue:v1:wreck:8001:item:8201:cargo:5501"}],
  rival:()=>rivalCargo=[{coopRescueRivalSalvage:true,
   cargoID:9901,sourceCargoID:5501,sourceWreckID:8001,
   sourceWreckItemID:8201,typeID:34,ownerID:20002,quantity:8}]
 })}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("first pilot accepts with zero NPC funds movement",()=>fixture(f=>{
 assert.equal(f.a().status,"RESCUE_WAITING_FOR_OTHER_PILOT");
 assert.equal(f.state().corp,50000);
}));
test("two real pilots independently reserve original native NPC corporation money",()=>fixture(f=>{
 f.a();assert.equal(f.b().status,"RESCUE_NATIVE_FUNDED");
 assert.equal(f.state().corp,30000);
 assert.equal(f.a().status,"RESCUE_NATIVE_FUNDED");
 assert.equal(f.state().corp,30000);
}));
test("native payout requires original quantity in correct owner station",()=>fixture(f=>{
 f.a();f.b();f.deliver(4);
 assert.equal(f.get().claim({session:f.pilot(701),eventID:id}).status,
  "RESCUE_NATIVE_FULL_CARGO_DELIVERY_NOT_VERIFIED");
 assert.equal(f.state().paid,0);
}));
test("after true salvage transfer emptied wreck, the quote survives restart",()=>fixture(f=>{
 f.a();f.b();f.loseWreck();
 assert.equal(f.get().offer(id).status,"READY");
 f.deliver(8);
 assert.equal(f.get().claim({session:f.pilot(701),eventID:id}).status,
  "RESCUE_NATIVE_PAID");
 assert.equal(f.state().paid,20000);
 assert.equal(f.get().claim({session:f.pilot(702),eventID:id}).status,
  "RESCUE_ALREADY_PAID");
 assert.equal(f.state().paid,20000);
}));
test("rescue personal history reads native paid wallet; no chat-reward score",()=>fixture(f=>{
 f.a();f.b();f.deliver(8);
 f.get().claim({session:f.pilot(701),eventID:id});
 const h=f.get().history({characterID:701});
 assert.equal(h.status,"READY");
 assert.equal(h.history[0]?.outcome,"PAID");
 assert.equal(h.reputation.earnedISK,10000);
 assert.equal(h.reputation.score,5);
 assert.equal(f.get().history({characterID:999}).history.length,0);
}));
test("third character cannot claim the two-person native escrow",()=>fixture(f=>{
 f.a();f.b();f.deliver(8);
 assert.equal(f.get().claim({session:f.pilot(999),eventID:id}).status,
  "RESCUE_CLAIM_UNAUTHORIZED");
 assert.equal(f.state().paid,0);
}));
test("NPC rival original cargo capture refunds corporate escrow but pays nobody",()=>fixture(f=>{
 f.a();f.b();f.rival();
 assert.equal(f.get().claim({session:f.pilot(701),eventID:id}).status,
  "RESCUE_NATIVE_RIVAL_REFUNDED");
 assert.equal(f.state().corp,50000);
 assert.equal(f.state().paid,0);
 assert.equal(f.get().cancel({session:f.pilot(702),eventID:id}).status,
  "RESCUE_ALREADY_REFUNDED");
 assert.equal(f.state().refunded,1);
}));
test("unverified original source cannot publish NPC bounty",()=>fixture(f=>{
 f.invalid();
 assert.equal(f.get().offer(id).status,"RESCUE_NATIVE_ORIGINAL_CARGO_UNVERIFIED");
 assert.equal(f.state().corp,50000);
}));
process.on("exit",()=>{if(old===undefined)delete process.env.EVEJS_COOP_RESCUE_CONTRACTS;
 else process.env.EVEJS_COOP_RESCUE_CONTRACTS=old});
