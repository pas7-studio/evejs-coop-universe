import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createTactics}=require("../integration/coopEscortNativeTactics.cjs");
const {createRescue}=require("../integration/coopEscortNativeRescue.cjs");
const oldT=process.env.EVEJS_COOP_ESCORT_TACTICS,oldR=process.env.EVEJS_COOP_ESCORT_RESCUE;
process.env.EVEJS_COOP_ESCORT_TACTICS="1";process.env.EVEJS_COOP_ESCORT_RESCUE="1";
function tactics(){
 let called=0,apply=true;
 const session={characterID:701,socket:{destroyed:false},
  _space:{systemID:30000144,shipID:1901,initialStateSent:true}};
 const scene={systemID:30000144,getEntityByID:id=>id===901?{kind:"ship",nativeNpc:true,itemID:901}:null};
 const t=createTactics({
  readVolunteers:()=>({status:"VERIFIED_NATIVE_DUO_VOLUNTEER",
   eventID:"convoy-30000144-77-1234",fleetID:77,systemID:30000144,
   entityID:901,pilots:[{characterID:701,shipID:1901},{characterID:702,shipID:1902}]}),
  readRoute:()=>({status:"NATIVE_CONVOY_EN_ROUTE",systemID:30000144,
   fleetID:77,entityID:901}),
  getScene:()=>scene,
  authorizeCommander:()=>({status:"AUTHORIZED_NATIVE_CONVOY_COMMANDER",characterID:701,fleetID:77}),
  issueNativeCommand:({shipID})=>{called++;return {status:"NATIVE_COMMAND_ACCEPTED",entityID:shipID}},
  observeNativeCommand:({shipID,mode})=>apply?{status:"NATIVE_COMMAND_APPLIED",entityID:shipID,mode}:null,
  clock:()=>1000000});
 return {t,session,scene,call:()=>called,deny:()=>apply=false};
}
const eventID="convoy-30000144-77-1234";
test("authorized native commander can issue physical HOLD after ack+observed effect",()=>{
 const f=tactics();
 assert.equal(f.t.command({session:f.session,eventID,mode:"HOLD"}).status,
  "NATIVE_CONVOY_TACTIC_VERIFIED");
 assert.equal(f.call(),1);
});
test("spam of the same tactical order is blocked for a cooldown",()=>{
 const f=tactics();f.t.command({session:f.session,eventID,mode:"HOLD"});
 assert.equal(f.t.command({session:f.session,eventID,mode:"HOLD"}).status,
  "TACTICAL_COOLDOWN");
 assert.equal(f.call(),1);
});
test("native command acknowledgement alone cannot fake tactical movement",()=>{
 const f=tactics();f.deny();
 assert.equal(f.t.command({session:f.session,eventID,mode:"RETREAT"}).status,
  "NATIVE_TACTICAL_EFFECT_UNVERIFIED");
});
test("disconnected character cannot send convoy controls",()=>{
 const f=tactics();f.session.socket.destroyed=true;
 assert.equal(f.t.command({session:f.session,eventID,mode:"HOLD"}).status,
  "UNAUTHENTICATED_NATIVE_PILOT");
});
test("unknown tactical orders are denied before touching scene",()=>{
 const f=tactics();
 assert.equal(f.t.command({session:f.session,eventID,mode:"TELEPORT"}).status,
  "INVALID_TACTICAL_ORDER");assert.equal(f.call(),0);
});
function rescue(){
 const manifest={status:"READY",record:{key:"30000144-77-1234",systemID:30000144,
  stationID:60001,corporationID:10001,haulerIDs:[901],
  cargo:[{cargoID:5501,haulerID:901,typeID:34,quantity:9}]}};
 const survivor={sourceCargoID:5501,typeID:34,itemID:44001,quantity:6};
 let genuine=true,warehouse=false,link=true;
 const witness=createRescue({
  readManifest:()=>manifest,
  readNativeWreck:()=>genuine?{status:"NATIVE_WRECK_VERIFIED",wreckID:80001,
   destroyedHaulerID:901,systemID:30000144}:null,
  readHaulerOutcome:()=>genuine?{status:"NATIVE_HAULER_LOSS_VERIFIED",
   nativeWreckID:80001,haulerID:901}:null,
  readWreckContents:()=>({status:"NATIVE_WRECK_CONTENTS_VERIFIED",wreckID:80001,
   rows:[{...survivor,sourceCargoID:link?5501:0}]}),
  verifyNativeWarehouse:()=>warehouse?{status:"NATIVE_RESCUE_STOCK_VERIFIED",
   stationID:60001,ownerID:10001,
   items:[{sourceWreckItemID:44001,sourceCargoID:5501,typeID:34,
    quantity:6,nativeWarehouseItemID:99444}]}:null});
 return {witness,fail:()=>genuine=false,deliver:()=>warehouse=true,breakLink:()=>link=false};
}
const rescueArgs={manifestKey:"30000144-77-1234",haulerID:901,systemID:30000144,
 stationID:60001,corporationID:10001,nativeWreckID:80001};
test("real surviving native cargo offers rescue with zero unearned rewards",()=>{
 const f=rescue();const p=f.witness.proof(rescueArgs);
 assert.equal(p.status,"NATIVE_RESCUE_AVAILABLE");
 assert.equal(p.survivingQuantity,6);
 assert.equal(p.rewardISK,0);assert.equal(p.paid,false);
});
test("only actual native itemStore warehouse receipt proves completed rescue",()=>{
 const f=rescue();f.deliver();
 assert.equal(f.witness.proof(rescueArgs).status,"NATIVE_RESCUE_CARGO_DELIVERED");
});
test("missing actual native hauler wreck rejects an invented rescue",()=>{
 const f=rescue();f.fail();
 assert.equal(f.witness.proof(rescueArgs).status,"RESCUE_WRECK_PROVENANCE_UNVERIFIED");
});
test("same item type without original cargo provenance is not rescuable",()=>{
 const f=rescue();f.breakLink();
 assert.equal(f.witness.proof(rescueArgs).status,"NATIVE_CARGO_ALL_LOST_NO_RESCUE");
});
test("both tactical and rescue gates stay off until owner-verified deployment",()=>{
 const t=tactics(),r=rescue();
 process.env.EVEJS_COOP_ESCORT_TACTICS="0";
 process.env.EVEJS_COOP_ESCORT_RESCUE="0";
 try{assert.equal(t.t.command({session:t.session,eventID,mode:"HOLD"}).status,"DISABLED");
  assert.equal(r.witness.proof(rescueArgs).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_TACTICS="1";process.env.EVEJS_COOP_ESCORT_RESCUE="1"}
});
process.on("exit",()=>{
 if(oldT===undefined)delete process.env.EVEJS_COOP_ESCORT_TACTICS;
 else process.env.EVEJS_COOP_ESCORT_TACTICS=oldT;
 if(oldR===undefined)delete process.env.EVEJS_COOP_ESCORT_RESCUE;
 else process.env.EVEJS_COOP_ESCORT_RESCUE=oldR;
});
