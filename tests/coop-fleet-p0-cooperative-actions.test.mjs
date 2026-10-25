import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {membership,inSpaceParty}=require("../integration/coopNativeFleetParty.cjs");
const {check}=require("../integration/coopFleetTradeSafety.cjs");
const {prepare,finish}=require("../integration/coopFleetMissionTurnin.cjs");

function fixture(){
 const alice={characterID:101,activeShipID:801,
  socket:{destroyed:false},_space:{initialStateSent:true,
   systemID:30000144,shipID:801}};
 const bob={characterID:102,activeShipID:802,
  socket:{destroyed:false},_space:{initialStateSent:true,
   systemID:30000144,shipID:802}};
 const fleet={fleetID:45,members:new Map([[101,{charID:101}],
  [102,{charID:102}]])};
 const fleetRuntime={
  getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(f,id)=>f.members.get(id)||null};
 const ships=new Map([[801,{itemID:801,kind:"ship",
  position:{x:0,y:0,z:0}}],[802,{itemID:802,kind:"ship",
  position:{x:500,y:0,z:0}}]]);
 const scene={systemID:30000144,
  sessions:new Map([[101,alice],[102,bob]]),
  getShipEntityForSession:s=>ships.get(s._space.shipID),
  getEntityByID:id=>ships.get(id)};
 const spaceRuntime={getSceneForSession:s=>scene.sessions.get(s.characterID)===s?
  scene:null};
 const station=new Map([[101,60000011],[102,60000011]]);
 const getDockedLocationID=s=>station.get(s.characterID)||0;
 const trade={status:"open",tradeContainerID:910000000001,
  dockedLocationID:60000011,traders:[101,102],moneyOffers:[0,0]};
 const items=new Map([[7001,{itemID:7001,ownerID:101,
  locationID:910000000001,typeID:1234}]]);
 const tradeOptions={trade,session:alice,peerSession:bob,
  items:[items.get(7001)],getItem:id=>items.get(id),
  isTradable:()=>true,containedItems:()=>[],
  fleetRuntime,getDockedLocationID};
 const missionRecords=new Map([
  [101,{agentID:50,contentID:9000,missionTemplateID:"rescueConvoy",
   objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:true,gmCompleted:false,missionSequence:10}],
  [102,{agentID:50,contentID:9000,missionTemplateID:"rescueConvoy",
   objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:true,gmCompleted:false,missionSequence:20}]
 ]);
 const completed=[];
 const missionRuntime={
  getMissionRecord:(id,agent)=>agent===50?missionRecords.get(id)||null:null,
  doAgentAction:(id,agent,action)=>{
   if(agent!==50||![6,7].includes(action))return {success:false};
   const record=missionRecords.get(id);
   if(!record?.objectiveCompleted)return {success:false};
   missionRecords.delete(id);completed.push(id);
   return {success:true};
  }};
 const missionOptions={session:alice,agentID:50,actionID:6,
  fleetRuntime,missionRuntime,sessions:[alice,bob],getDockedLocationID};
 return {alice,bob,fleet,fleetRuntime,scene,ships,spaceRuntime,station,
  trade,items,tradeOptions,missionRecords,completed,missionRuntime,missionOptions,
  getDockedLocationID};
}
test("a real EveJS fleet with two separate ship owners is eligible",()=>{
 const f=fixture();
 assert.equal(membership({leaderSession:f.alice,peerSession:f.bob,
  fleetRuntime:f.fleetRuntime}).ok,true);
 const s=inSpaceParty({leaderSession:f.alice,peerSession:f.bob,
  fleetRuntime:f.fleetRuntime,spaceRuntime:f.spaceRuntime});
 assert.equal(s.ok,true);assert.equal(s.fleetID,45);
});
test("invited but not accepted fleet member cannot share actions",()=>{
 const f=fixture();f.fleet.members.delete(102);
 assert.equal(membership({leaderSession:f.alice,peerSession:f.bob,
  fleetRuntime:f.fleetRuntime}).ok,false);
 assert.equal(prepare(f.missionOptions).ok,false);
 assert.equal(check(f.tradeOptions).ok,false);
});
test("no fake co-op party across systems, ghost clients, or far-apart ships",()=>{
 const f=fixture();f.bob._space.systemID=30000142;
 assert.equal(inSpaceParty({leaderSession:f.alice,peerSession:f.bob,
  fleetRuntime:f.fleetRuntime,spaceRuntime:f.spaceRuntime}).ok,false);
 f.bob._space.systemID=30000144;
 f.ships.get(802).position.x=300000;
 assert.equal(inSpaceParty({leaderSession:f.alice,peerSession:f.bob,
  fleetRuntime:f.fleetRuntime,spaceRuntime:f.spaceRuntime}).reason,
  "TOO_FAR_FROM_TEAMMATE");
 f.ships.get(802).position.x=500;
 f.scene.sessions.set(103,{...f.bob});
 assert.equal(inSpaceParty({leaderSession:f.alice,peerSession:f.bob,
  fleetRuntime:f.fleetRuntime,spaceRuntime:f.spaceRuntime}).reason,
  "STALE_OR_DUPLICATE_SESSION");
});
test("valid inactive ship can be gifted only through stock docked native trade",()=>{
 const f=fixture();
 assert.equal(check(f.tradeOptions).status,"NATIVE_DOCKED_FLEET_TRADE_READY");
 f.items.get(7001).typeID=670;
 assert.equal(check(f.tradeOptions).ok,true);
});
test("active ship is never tradable by a co-op fleet offer",()=>{
 const f=fixture();
 f.items.set(801,{...f.items.get(7001),itemID:801});
 assert.equal(check({...f.tradeOptions,items:[f.items.get(801)]}).reason,
  "STALE_OR_UNTRADABLE_NATIVE_ITEM");
});
test("stale ownership and duplicated cargo are rejected before either accepts",()=>{
 const f=fixture();
 f.items.get(7001).ownerID=333;
 assert.equal(check(f.tradeOptions).reason,"STALE_OR_UNTRADABLE_NATIVE_ITEM");
 f.items.get(7001).ownerID=101;
 assert.equal(check({...f.tradeOptions,items:[f.items.get(7001),f.items.get(7001)]}).reason,
  "INVALID_OR_DUPLICATED_TRADE_ITEM");
 assert.equal(check({...f.tradeOptions,containedItems:()=>[
  {itemID:7002,ownerID:102}]}).reason,"INVALID_NESTED_SHIP_OWNERSHIP");
});
test("trade recipient must actually be docked in same station",()=>{
 const f=fixture();f.station.set(102,60000012);
 assert.equal(check(f.tradeOptions).reason,"NOT_DOCKED_TOGETHER");
});
test("non-atomic mixed ISK plus item transfer fails closed",()=>{
 const f=fixture();f.trade.moneyOffers=[10,0];
 assert.equal(check(f.tradeOptions).reason,"MIXED_MONEY_TRADE_NOT_ATOMIC");
});
test("one actual completed mission dialogue credits both separately once",()=>{
 const f=fixture(),ticket=prepare(f.missionOptions);
 assert.equal(ticket.ok,true);
 assert.equal(f.missionRuntime.doAgentAction(101,50,6).success,true);
 const result=finish({ticket,missionRuntime:f.missionRuntime,
  fleetRuntime:f.fleetRuntime,getDockedLocationID:f.getDockedLocationID});
 assert.equal(result.status,"TWO_NATIVE_MISSIONS_COMPLETED");
 assert.deepEqual(f.completed,[101,102]);
 assert.equal(f.missionRecords.size,0);
 assert.notEqual(finish({ticket,missionRuntime:f.missionRuntime,
  fleetRuntime:f.fleetRuntime,getDockedLocationID:f.getDockedLocationID}).status,
  "TWO_NATIVE_MISSIONS_COMPLETED");
 assert.deepEqual(f.completed,[101,102]);
});
test("when leader native turn-in failed the peer receives no reward",()=>{
 const f=fixture(),ticket=prepare(f.missionOptions);
 assert.equal(ticket.ok,true);
 const result=finish({ticket,missionRuntime:f.missionRuntime,
  fleetRuntime:f.fleetRuntime,getDockedLocationID:f.getDockedLocationID});
 assert.equal(result.status,"LEADER_NATIVE_MISSION_NOT_COMPLETED");
 assert.deepEqual(f.completed,[]);
});
test("incomplete, different or GM-finished mission never yields peer credit",()=>{
 const f=fixture();
 f.missionRecords.get(102).objectiveCompleted=false;
 assert.equal(prepare(f.missionOptions).reason,"NATIVE_MISSIONS_NOT_BOTH_COMPLETED");
 f.missionRecords.get(102).objectiveCompleted=true;
 f.missionRecords.get(102).contentID=999;
 assert.equal(prepare(f.missionOptions).ok,false);
 f.missionRecords.get(102).contentID=9000;
 f.missionRecords.get(102).gmCompleted=true;
 assert.equal(prepare(f.missionOptions).ok,false);
});
test("peer disconnects or leaves the fleet before finish: no second native payout",()=>{
 const f=fixture(),ticket=prepare(f.missionOptions);
 f.missionRuntime.doAgentAction(101,50,6);
 f.bob.socket.destroyed=true;
 const result=finish({ticket,missionRuntime:f.missionRuntime,
  fleetRuntime:f.fleetRuntime,getDockedLocationID:f.getDockedLocationID});
 assert.notEqual(result.status,"TWO_NATIVE_MISSIONS_COMPLETED");
 assert.deepEqual(f.completed,[101]);
});
test("stale/replaced peer mission after owner turn-in is not completed",()=>{
 const f=fixture(),ticket=prepare(f.missionOptions);
 f.missionRuntime.doAgentAction(101,50,6);
 f.missionRecords.get(102).missionSequence=21;
 assert.equal(finish({ticket,missionRuntime:f.missionRuntime,
  fleetRuntime:f.fleetRuntime,getDockedLocationID:f.getDockedLocationID}).status,
  "PEER_NATIVE_OBJECTIVE_NOT_READY");
 assert.deepEqual(f.completed,[101]);
});
test("other agent categories and unrelated mission actions are not auto-turned in",()=>{
 const f=fixture();f.missionOptions.actionID=3;
 assert.equal(prepare(f.missionOptions).ok,false);
 f.missionOptions.actionID=6;f.missionRecords.get(102).objectiveMode="transport";
 assert.equal(prepare(f.missionOptions).ok,false);
});
