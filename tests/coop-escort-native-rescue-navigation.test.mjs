import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRescueNavigation}=require("../integration/coopEscortRescueNavigation.cjs");
const old=process.env.EVEJS_COOP_ESCORT_RESCUE_NAV;
process.env.EVEJS_COOP_ESCORT_RESCUE_NAV="1";
const eventID="convoy-30000144-77-5501",key="30000144-77-1000000";
function fixture(fn){
 let distance=300000,validCargo=true,validWreck=true,now=1000000;
 let warps=0,approaches=0;
 const session={characterID:701,socket:{destroyed:false},
  _space:{shipID:1701,systemID:30000144,initialStateSent:true}};
 const game=createRescueNavigation({
  clock:()=>now,
  readEvent:()=>({status:"READY",event:{type:"CONVOY",stage:"PREPARING",
   outcome:"DEPARTED",linkedTripID:key,systemID:30000144,entityID:901}}),
  readFlight:()=>({status:"READY",phase:"FUNDED",booking:{manifestKey:key,
   systemID:30000144,fleetID:77,stationID:60001,corporationID:10001,
   haulerID:901,playerFleetID:33,characters:[701,702]}}),
  readManifest:()=>({status:"READY",record:{key,systemID:30000144,
   fleetID:77,stationID:60001,corporationID:10001,
   cargo:[{cargoID:5501,typeID:34,quantity:8}]}}),
  readOutcomes:()=>({status:"READY",outcomes:[{
   systemID:30000144,targetID:901,status:"HAULER_NATIVE_LOSS_VERIFIED",
   haulerNativeWreckID:8001,verifiedWarehouseStacks:[]}]}),
  readVolunteer:()=>({status:"VERIFIED_NATIVE_DUO_VOLUNTEER",fleetID:33,
   pilots:[{characterID:701,shipID:1701},{characterID:702,shipID:1702}]}),
  getWreck:()=>({wreckID:8001,sourceEntityID:validWreck?901:902,
   systemID:30000144,position:{x:0,y:0,z:0}}),
  getWreckItems:()=>[{wreckID:8001,wreckItemID:9201,
   sourceCargoID:validCargo?5501:9999,typeID:34,quantity:6}],
  getScene:()=>({systemID:30000144,getEntityByID:id=>
   id===8001?{itemID:8001,nativeNpcWreck:true,position:{x:0,y:0,z:0}}:
   id===1701?{itemID:1701,position:{x:distance,y:0,z:0}}:null}),
  warpPlayer:()=>{warps++;return {success:true}},
  followPlayer:()=>{approaches++;return true}
 });
 fn({game,session,setDistance:d=>distance=d,
  wrongCargo:()=>validCargo=false,wrongWreck:()=>validWreck=false,
  now:t=>now=t,counts:()=>({warps,approaches})});
}
test("true remote wreck warps authentic EVE pilot, never grants loot/ISK",()=>fixture(f=>{
 const r=f.game.navigate(f.session,eventID);
 assert.equal(r.status,"RESCUE_NATIVE_WARP_ACKNOWLEDGED");
 assert.equal(r.inventoryTransferVerified,false);
 assert.equal(r.rewardISK,0);assert.equal(f.counts().warps,1);
}));
test("near real wreck issues stock FollowBall instead of impossible short warp",()=>fixture(f=>{
 f.setDistance(40000);
 assert.equal(f.game.navigate(f.session,eventID).status,
  "RESCUE_NATIVE_APPROACH_ACKNOWLEDGED");
 assert.deepEqual(f.counts(),{warps:0,approaches:1});
}));
test("same type without original sourceCargoID cannot create rescue",()=>fixture(f=>{
 f.wrongCargo();
 assert.equal(f.game.navigate(f.session,eventID).status,
  "RESCUE_NO_PROVEN_ORIGINAL_CARGO");
 assert.deepEqual(f.counts(),{warps:0,approaches:0});
}));
test("native wreck destroyed by another NPC blocks player navigation",()=>fixture(f=>{
 f.wrongWreck();
 assert.equal(f.game.navigate(f.session,eventID).status,
  "RESCUE_NATIVE_WRECK_NOT_PRESENT");
}));
test("unauthorized character cannot take rescue assignment",()=>fixture(f=>{
 assert.equal(f.game.navigate({...f.session,characterID:888},eventID).status,
  "RESCUE_CONTRACT_AND_DUO_NOT_VERIFIED");
 assert.equal(f.counts().warps,0);
}));
test("rescue movement cooldown prevents duplicate commands",()=>fixture(f=>{
 f.game.navigate(f.session,eventID);
 assert.equal(f.game.navigate(f.session,eventID).status,"RESCUE_NATIVE_WARP_COOLDOWN");
 assert.equal(f.counts().warps,1);
}));
test("rescue controls default disabled",()=>fixture(f=>{
 process.env.EVEJS_COOP_ESCORT_RESCUE_NAV="0";
 try{assert.equal(f.game.navigate(f.session,eventID).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_RESCUE_NAV="1"}
}));
process.on("exit",()=>{if(old===undefined)delete process.env.EVEJS_COOP_ESCORT_RESCUE_NAV;
 else process.env.EVEJS_COOP_ESCORT_RESCUE_NAV=old});
