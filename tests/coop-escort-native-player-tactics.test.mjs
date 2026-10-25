import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeTacticalGame}=require("../integration/coopEscortTacticalGame.cjs");
const old=process.env.EVEJS_COOP_ESCORT_TACTICS;
process.env.EVEJS_COOP_ESCORT_TACTICS="1";
const eventID="convoy-30000144-77-5501";
function fixture(fn){
 let now=1000000;
 const ship={kind:"ship",nativeNpc:true,itemID:901,mode:"WARP"};
 const controller={entityID:901,systemID:30000144,manualOrder:null};
 const scene={systemID:30000144,getEntityByID:id=>id===901?ship:null};
 const pilots=[701,702].map((characterID,i)=>({characterID,
  socket:{destroyed:false},_space:{shipID:1701+i,
   initialStateSent:true,systemID:30000144}}));
 const members=new Map([[701,{}],[702,{}]]);
 const fleet={fleetID:33,members};
 let stopped=0,continued=0,retreated=0;
 const game=createNativeTacticalGame({
  clock:()=>now,
  readEvent:()=>({status:"READY",event:{id:eventID,type:"CONVOY",
   stage:"PREPARING",phase:"RESOLVED",outcome:"DEPARTED",
   linkedTripID:"30000144-77-1000000",
   entityID:901,systemID:30000144,stationID:60001}}),
  readVolunteer:()=>({status:"VERIFIED_NATIVE_DUO_VOLUNTEER",
   eventID,systemID:30000144,entityID:901,fleetID:33,
   pilots:pilots.map(p=>({characterID:p.characterID,shipID:p._space.shipID}))}),
  readFlight:()=>({status:"READY",phase:"FUNDED",booking:{
   manifestKey:"30000144-77-1000000",systemID:30000144,fleetID:77,
   playerFleetID:33,haulerID:901,stationID:60001,
   contractID:"escort-30000144-77-5501"}}),
  readManifest:()=>({status:"READY",record:{
   key:"30000144-77-1000000",cargo:[{cargoID:5501}]}}),
  getScene:()=>scene,getSessions:()=>pilots,
  fleetRuntime:{getFleetForCharacter:()=>fleet,
   getMemberRecord:(f,id)=>f.members.get(id)},
  npcRuntime:{resolveNpcContext:()=>({success:true,data:{systemID:30000144}}),
   stop:()=>{stopped++;ship.mode="STOP";controller.manualOrder={type:"stop"};
    return {success:true}},
   resumeBehavior:()=>{continued++;controller.manualOrder=null;return {success:true}},
   issueOrder:(_,order)=>{retreated++;controller.manualOrder=order;return {success:true}}},
  npcService:{getControllerByEntityID:()=>controller}
 });
 fn({game,pilots,ship,controller,now:v=>now=v,
  counts:()=>({stopped,continued,retreated})});
}
test("genuine two-player commander changes native NPC to STOP",()=>fixture(f=>{
 assert.equal(f.game.command({session:f.pilots[0],eventID,mode:"HOLD"}).status,
  "NATIVE_CONVOY_TACTIC_VERIFIED");
 assert.equal(f.ship.mode,"STOP");assert.equal(f.controller.manualOrder.type,"stop");
}));
test("second pilot or stranger cannot impersonate the designated commander",()=>fixture(f=>{
 assert.equal(f.game.command({session:f.pilots[1],eventID,mode:"HOLD"}).status,
  "NATIVE_COMMANDER_NOT_AUTHORIZED");
 assert.equal(f.counts().stopped,0);
}));
test("CONTINUE clears stock NPC manual stop and returns control to native AI",()=>fixture(f=>{
 assert.equal(f.game.command({session:f.pilots[0],eventID,mode:"HOLD"}).status,
  "NATIVE_CONVOY_TACTIC_VERIFIED");
 assert.equal(f.game.command({session:f.pilots[0],eventID,mode:"CONTINUE"}).status,
  "NATIVE_CONVOY_TACTIC_VERIFIED");
 assert.equal(f.controller.manualOrder,null);
 assert.equal(f.counts().continued,1);
}));
test("RETREAT commands real stock returnHome behavior without teleport",()=>fixture(f=>{
 assert.equal(f.game.command({session:f.pilots[0],eventID,mode:"RETREAT"}).status,
  "NATIVE_CONVOY_TACTIC_VERIFIED");
 assert.equal(f.controller.manualOrder.type,"returnHome");
 assert.equal(f.counts().retreated,1);
}));
test("cooldown prevents repeating same NPC command each chat message",()=>fixture(f=>{
 f.game.command({session:f.pilots[0],eventID,mode:"RETREAT"});
 assert.equal(f.game.command({session:f.pilots[0],eventID,mode:"RETREAT"}).status,
  "TACTICAL_COOLDOWN");
 assert.equal(f.counts().retreated,1);
}));
test("native tactical dispatch is default OFF",()=>fixture(f=>{
 process.env.EVEJS_COOP_ESCORT_TACTICS="0";
 try{assert.equal(f.game.command({session:f.pilots[0],eventID,mode:"HOLD"}).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_ESCORT_TACTICS="1"}
}));
process.on("exit",()=>{if(old===undefined)delete process.env.EVEJS_COOP_ESCORT_TACTICS;
 else process.env.EVEJS_COOP_ESCORT_TACTICS=old});
