import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCloneGuard,HOUR}=require("../integration/coopCloneNativeGuard.cjs");
const NOW="134000000000000000";
function fixture(){
 const one={characterID:101,userid:201,stationID:300,socket:{destroyed:false}},
  two={characterID:102,userid:202,stationID:300,socket:{destroyed:false}};
 const sessions=[one,two];
 const records=Object.fromEntries([[101,201,501,800],[102,202,502,810]].map(([characterID,accountId,activeShipID,jumpCloneID])=>
  [characterID,{characterID,accountId,activeShipID,stationID:300,homeStationID:300,
   cloneStationID:300,timeLastCloneJump:"0",nextRemoteHomeStationChangeTime:"0",
   implants:[],boosters:[],jumpClones:[{jumpCloneID,ownerID:characterID,locationID:400,
    locationKind:"station",implants:[]}]}]));
 const ships={501:{itemID:501,ownerID:101,typeID:670,locationID:300,flagID:4},
  502:{itemID:502,ownerID:102,typeID:670,locationID:300,flagID:4},
  503:{itemID:503,ownerID:101,typeID:1000,locationID:300,flagID:4}};
 const items={601:{itemID:601,ownerID:101,typeID:701,locationID:300},
  602:{itemID:602,ownerID:102,typeID:701,locationID:300},
  603:{itemID:603,ownerID:101,typeID:702,locationID:300}};
 const stations={300:{stationID:300,solarSystemID:30001},400:{stationID:400,solarSystemID:30002},
  500:{stationID:500,solarSystemID:30003}},structures={600:{structureID:600,solarSystemID:30004}};
 let access=true,online=true,limit=4,hours=24,wallet=100000,admin=false,implantOkay=true,
  boosterOkay=true,candidates=[300,400,500],installFee=10000,jumpFee=500;
 const guard=createCloneGuard({getSessions:()=>sessions,getCharacterRecord:id=>records[id],
  getActiveShip:id=>ships[records[id]?.activeShipID],getInventoryItem:id=>items[id]||ships[id],
  getStationByID:id=>stations[id]||null,getStructureByID:id=>structures[id]||null,
  canDockAtStructure:()=>access,hasCloneService:()=>online,getCharacterCloneLimit:()=>limit,
  getCloneCooldownHours:()=>hours,getWalletBalance:()=>wallet,
  getImplantTypeInfo:()=>({slot:1}),validateImplantItem:()=>({success:implantOkay}),
  getBoosterTypeInfo:()=>({boosterness:1}),validateBoosterItem:()=>({success:boosterOkay}),
  getOwnedShipsAtLocation:(id,loc)=>Object.values(ships).filter(s=>s.ownerID===id&&s.locationID===loc),
  getHomeStationCandidateIDs:()=>candidates,getNativeSchoolHQStationID:()=>300,
  getCloneInstallationFee:()=>installFee,
  getCloneActivationFee:()=>jumpFee,verifyDeathEvent:()=>true,
  isAuthorizedAdmin:()=>admin,nowFiletime:()=>NOW,
  isCapsuleShip:s=>s.typeID===670});
 return {one,two,sessions,records,ships,items,stations,structures,guard,
  control(x,v){if(x==="access")access=v;if(x==="online")online=v;
   if(x==="limit")limit=v;if(x==="wallet")wallet=v;if(x==="hours")hours=v;
   if(x==="implant")implantOkay=v;if(x==="booster")boosterOkay=v;
   if(x==="candidates")candidates=v;if(x==="installFee")installFee=v;
   if(x==="jumpFee")jumpFee=v;if(x==="admin")admin=v}};
}
const J={cloneID:800,destLocationID:400};
test("two personal clones are independent, foreign clone and nonexistent clone denied",()=>{
 const x=fixture();assert.equal(x.guard.jump(x.one,J).ok,true);
 assert.equal(x.guard.jump(x.two,J).reason,"NATIVE_JUMP_CLONE_NOT_OWNED_OR_MISSING");
 assert.equal(x.guard.jump(x.two,{cloneID:810,destLocationID:400}).ok,true);
 assert.equal(x.guard.jump(x.one,{cloneID:999,destLocationID:400}).reason,
  "NATIVE_JUMP_CLONE_NOT_OWNED_OR_MISSING");
});
test("fake session, foreign account and two live sessions rejected",()=>{
 const x=fixture();x.one.userid=1000;
 assert.equal(x.guard.jump(x.one,J).reason,"NATIVE_CLONE_ACCOUNT_MISMATCH");
 x.one.userid=201;x.sessions.push({...x.one});
 assert.equal(x.guard.jump(x.one,J).reason,"DUPLICATE_OR_STALE_NATIVE_SESSION");
 x.sessions.pop();x.one.socket.destroyed=true;
 assert.equal(x.guard.jump(x.one,J).reason,"INVALID_NATIVE_CLONE_SESSION");
});
test("source fitted ship cannot teleport, capsule plus parked native ship accepted",()=>{
 const x=fixture();x.records[101].activeShipID=503;
 assert.equal(x.guard.jump(x.one,J).reason,"NON_CAPSULE_CLONE_JUMP_UNSAFE_SHIP_TELEPORT");
 x.records[101].activeShipID=501;
 const proof=x.guard.jump(x.one,J);assert.equal(proof.ok,true);
 assert.equal(proof.sourceParkedShips.some(s=>s.itemID===503),true);
});
test("cooldown FILETIME uses native skill hours, not client supplied clock",()=>{
 const x=fixture();
 x.records[101].timeLastCloneJump=(BigInt(NOW)-12n*HOUR).toString();
 assert.equal(x.guard.jump(x.one,J).reason,"NATIVE_CLONE_COOLDOWN_ACTIVE");
 x.records[101].timeLastCloneJump=(BigInt(NOW)-25n*HOUR).toString();
 assert.equal(x.guard.jump(x.one,J).ok,true);
 x.records[101].timeLastCloneJump="corrupt";
 assert.equal(x.guard.jump(x.one,J).reason,"INVALID_NATIVE_CLONE_FILETIME");
});
test("future last jump time and forged destination are fail closed",()=>{
 const x=fixture();x.records[101].timeLastCloneJump=(BigInt(NOW)+2n*HOUR).toString();
 assert.equal(x.guard.jump(x.one,J).reason,"FUTURE_NATIVE_CLONE_JUMP_TIME");
 x.records[101].timeLastCloneJump="0";
 assert.equal(x.guard.jump(x.one,{...J,destLocationID:500}).reason,
  "NATIVE_JUMP_CLONE_NOT_OWNED_OR_MISSING");
});
test("duplicate implant ID across active and stored clone denied",()=>{
 const x=fixture();x.records[101].jumpClones[0].implants=[{itemID:901,typeID:991,slot:2}];
 x.records[101].implants=[{itemID:901,typeID:991,slot:2}];
 assert.equal(x.guard.jump(x.one,J).reason,"DUPLICATE_NATIVE_IMPLANT_ITEM");
});
test("active implant slots must be unique and every clone identity physically owned",()=>{
 const x=fixture();x.records[101].implants=[
  {itemID:901,typeID:991,slot:1},{itemID:902,typeID:992,slot:1}];
 assert.equal(x.guard.consume(x.one,{kind:"IMPLANT",itemID:601}).reason,
  "DUPLICATE_NATIVE_IMPLANT_SLOT");
 x.records[101].implants=[];x.records[101].jumpClones[0].ownerID=102;
 assert.equal(x.guard.jump(x.one,J).reason,"NATIVE_CLONE_IDENTITY_INVALID");
});
test("station clone installation checks native cost, limit and physical location",()=>{
 const x=fixture();
 assert.equal(x.guard.installClone(x.one,{cost:10000}).ok,true);
 assert.equal(x.guard.installClone(x.one,{cost:0}).reason,"CLONE_INSTALL_FEE_QUOTE_MISMATCH");
 x.control("wallet",100);
 assert.equal(x.guard.installClone(x.one,{cost:10000}).reason,"NATIVE_CLONE_INSTALL_FEE_UNFUNDED");
 x.control("wallet",100000);x.control("limit",1);
 assert.equal(x.guard.installClone(x.one,{cost:10000}).reason,"NATIVE_CLONE_SKILL_LIMIT");
});
test("cannot install twice at one station",()=>{
 const x=fixture();x.records[101].jumpClones.push({
  jumpCloneID:801,ownerID:101,locationID:300,locationKind:"station",implants:[]});
 assert.equal(x.guard.installClone(x.one,{cost:10000}).reason,"CLONE_ALREADY_AT_LOCATION");
});
test("structure destinations require real access and online clone service",()=>{
 const x=fixture();x.records[101].jumpClones[0].locationID=600;
 x.records[101].jumpClones[0].locationKind="structure";
 x.control("access",false);
 assert.equal(x.guard.jump(x.one,{cloneID:800,destLocationID:600,confirmed:true}).reason,
  "CLONE_STRUCTURE_ACCESS_DENIED");
 x.control("access",true);x.control("online",false);
 assert.equal(x.guard.jump(x.one,{cloneID:800,destLocationID:600,confirmed:true}).reason,
  "CLONE_STRUCTURE_ACCESS_DENIED");
 x.control("online",true);
 assert.equal(x.guard.jump(x.one,{cloneID:800,destLocationID:600,confirmed:true}).ok,true);
});
test("remote home stations respect native candidates and long persisted cooldown",()=>{
 const x=fixture();x.control("candidates",[300]);
 assert.equal(x.guard.homeStation(x.one,{stationID:500}).reason,"HOME_STATION_NOT_NATIVE_CANDIDATE");
 x.control("candidates",[300,500]);
 assert.equal(x.guard.homeStation(x.one,{stationID:500}).reason,
  "REMOTE_HOME_STATION_CONFIRM_REQUIRED");
 x.records[101].nextRemoteHomeStationChangeTime=(BigInt(NOW)+HOUR).toString();
 assert.equal(x.guard.homeStation(x.one,{stationID:500,allowRemote:true}).reason,
  "REMOTE_HOME_STATION_COOLDOWN_ACTIVE");
 x.records[101].nextRemoteHomeStationChangeTime="0";
 assert.equal(x.guard.homeStation(x.one,{stationID:500,allowRemote:true}).ok,true);
 assert.equal(x.guard.homeStation(x.two,{stationID:500,allowRemote:true}).ok,true);
});
test("physical consumables cannot be stolen from another character",()=>{
 const x=fixture();
 assert.equal(x.guard.consume(x.one,{kind:"IMPLANT",itemID:601}).ok,true);
 assert.equal(x.guard.consume(x.two,{kind:"IMPLANT",itemID:601}).reason,
  "NATIVE_CONSUMABLE_ACCESS_DENIED");
 assert.equal(x.guard.consume(x.one,{kind:"BOOSTER",itemID:603}).ok,true);
 x.control("booster",false);
 assert.equal(x.guard.consume(x.one,{kind:"BOOSTER",itemID:603}).reason,
  "NATIVE_CONSUMABLE_ACCESS_DENIED");
});
test("pod death requires unique authoritative death event not a free client trigger",()=>{
 const x=fixture();x.records[101].implants=[{itemID:931,typeID:901,slot:1}];
 assert.equal(x.guard.podDeath(x.one).reason,"NATIVE_POD_DEATH_EVENT_REQUIRED");
 const p=x.guard.podDeath(x.one,{deathEventID:"kill-evt-123"});
 assert.equal(p.ok,true);assert.equal(p.activeImplants[0].itemID,931);
 assert.equal(p.jumpClones[0],800);
 assert.equal(x.guard.podDeath(x.two,{deathEventID:"kill-evt-124"}).jumpClones[0],810);
});

test("players cannot reset 24h jump cooldown through exposed native RPC",()=>{
 const x=fixture();
 assert.equal(x.guard.privilegedReset(x.one,{kind:"CLONE_COOLDOWN_RESET"}).reason,
  "PLAYER_COOLDOWN_RESET_FORBIDDEN");
 x.control("admin",true);
 assert.equal(x.guard.privilegedReset(x.one,{kind:"CLONE_COOLDOWN_RESET"}).ok,true);
});
test("home-station 365-day reset RPC is admin-only",()=>{
 const x=fixture();
 assert.equal(x.guard.privilegedReset(x.one,{kind:"REMOTE_HOME_COOLDOWN_RESET"}).reason,
  "PLAYER_COOLDOWN_RESET_FORBIDDEN");
 x.control("admin",true);
 assert.equal(x.guard.privilegedReset(x.one,{kind:"REMOTE_HOME_COOLDOWN_RESET"}).ok,true);
});
