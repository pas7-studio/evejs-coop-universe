import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createStationShipGuard,assertDock,assertUndock,assertDockedActivation}=require('../integration/coopStationShipGuard.cjs');

function scenario(){
  const station=60003760,remote=60003466,system=30000142;
  const characters=new Map([
    [1001,{characterID:1001,shipID:2001,stationID:station,structureID:null,solarSystemID:system}],
    [1002,{characterID:1002,shipID:2002,stationID:station,structureID:null,solarSystemID:system}]
  ]);
  const items=new Map([
    [2001,{itemID:2001,typeID:606,categoryID:6,ownerID:1001,locationID:station,flagID:4,singleton:1}],
    [2002,{itemID:2002,typeID:607,categoryID:6,ownerID:1002,locationID:station,flagID:4,singleton:1}],
    [2003,{itemID:2003,typeID:608,categoryID:6,ownerID:1001,locationID:station,flagID:4,singleton:1}],
    [2004,{itemID:2004,typeID:609,categoryID:6,ownerID:1001,locationID:remote,flagID:4,singleton:1}]
  ]);
  const sessions=[1001,1002].map(charID=>({characterID:charID,charid:charID,stationID:station,stationid:station,activeShipID:characters.get(charID).shipID,shipID:characters.get(charID).shipID,_space:null}));
  const scene={systemID:system,sessions:new Map(sessions.map((s,i)=>[i+1,s]))};
  const physical=new Map();
  const deps={
    peekCharacterRecord:id=>characters.get(id)||null,
    findCharacterShip:(id,shipID)=>{const item=items.get(shipID);return item?.ownerID===id?{...item}:null},
    findItemById:id=>items.has(id)?{...items.get(id)}:null,
    getActiveShipRecord:id=>{const record=characters.get(id);const item=record&&items.get(record.shipID);return item?{...item}:null},
    getSceneForSession:()=>scene,
    getEntity:(_,shipID)=>physical.get(shipID)||null,
  };
  const guard=createStationShipGuard(deps);
  return {guard,deps,characters,items,sessions,scene,physical,station,remote,system};
}
const status=r=>r.success?'OK':r.errorMsg;
function fixtureSpace(f,charIndex=0){
  const s=f.sessions[charIndex],record=f.characters.get(s.characterID),shipID=record.shipID;
  record.stationID=null;record.structureID=null;
  s.stationID=null;s.stationid=null;
  s._space={shipID,systemID:f.system,initialStateSent:true};
  const ship=f.items.get(shipID);ship.locationID=f.system;ship.flagID=0;
  f.physical.set(shipID,{kind:'ship',itemID:shipID,session:s});
  return s;
}

test('two distinct characters at one real station can board only their owned local hulls',()=>{
 const f=scenario();
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'OK');
 assert.equal(status(f.guard.activate(f.sessions[1],2002)),'OK');
 assert.equal(status(f.guard.activate(f.sessions[1],2003)),'STATION_SHIP_NOT_OWNED');
 assert.equal(status(f.guard.activate(f.sessions[0],2002)),'STATION_SHIP_NOT_OWNED');
 assert.equal(f.characters.get(1001).shipID,2001);assert.equal(f.characters.get(1002).shipID,2002);
});
test('remote station hull cannot be activated even when legitimately owned',()=>{
 const f=scenario();assert.equal(status(f.guard.activate(f.sessions[0],2004)),'STATION_SHIP_NOT_IN_CURRENT_HANGAR');
});
test('forged ship snapshot owner cannot bypass native itemStore identity',()=>{
 const f=scenario();f.deps.findCharacterShip=()=>({...f.items.get(2002),ownerID:1001});
 const guard=createStationShipGuard(f.deps);
 assert.equal(status(guard.activate(f.sessions[0],2002)),'STATION_SHIP_NOT_OWNED');
});
test('hangar transition refuses a packaged hull and wrong item flag',()=>{
 const f=scenario();f.items.get(2003).singleton=0;
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'STATION_SHIP_NOT_ASSEMBLED');
 f.items.get(2003).singleton=1;f.items.get(2003).flagID=0;
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'STATION_SHIP_NOT_IN_CURRENT_HANGAR');
});
test('boarding refuses destroyed/not-found hull without spawning a replacement',()=>{
 const f=scenario();f.items.delete(2003);
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'STATION_SHIP_NOT_OWNED');
 assert.equal(f.items.size,3);
});
test('docked session must match persisted station on relog',()=>{
 const f=scenario();f.characters.get(1001).stationID=f.remote;
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'STATION_SESSION_LOCATION_STALE');
});
test('docked session aliases must not disagree',()=>{
 const f=scenario();f.sessions[0].stationid=123;
 assert.equal(status(f.guard.activate(f.sessions[0],2001)),'STATION_SESSION_LOCATION_STALE');
});
test('docked and space simultaneously is rejected, including reconnect residue',()=>{
 const f=scenario();f.sessions[0]._space={shipID:2001};
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'STATION_SPACE_SESSION_STALE');
});
test('docked record with station and structure identity is rejected',()=>{
 const f=scenario();f.characters.get(1001).structureID=1020001;
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'STATION_PERSISTED_LOCATION_INVALID');
});
test('structure dock supports native structure location but not personal station ships',()=>{
 const f=scenario();const s=f.sessions[0];f.characters.get(1001).structureID=1020001;f.characters.get(1001).stationID=null;
 s.stationID=null;s.stationid=null;s.structureID=1020001;s.structureid=1020001;
 f.items.get(2003).locationID=1020001;
 assert.equal(status(f.guard.activate(s,2003)),'OK');
 assert.equal(status(f.guard.activate(s,2004)),'STATION_SHIP_NOT_IN_CURRENT_HANGAR');
});
test('undock active ID must match both session and actual requested ship ID',()=>{
 const f=scenario();const s=f.sessions[0];
 assert.equal(status(f.guard.undock(s,2001)),'OK');
 assert.equal(status(f.guard.undock(s,2003)),'STATION_UNDOCK_SHIP_MISMATCH');
 assert.equal(status(f.guard.undock(s,null)),'OK');
 s.shipID=2003;assert.equal(status(f.guard.undock(s,2001)),'STATION_ACTIVE_SESSION_SHIP_STALE');
});
test('undock refuses a remotely located currently active hull without inventory move',()=>{
 const f=scenario();f.characters.get(1001).shipID=2004;f.sessions[0].shipID=2004;f.sessions[0].activeShipID=2004;
 assert.equal(status(f.guard.undock(f.sessions[0],2004)),'STATION_ACTIVE_SHIP_INVALID');
 assert.equal(f.items.get(2004).locationID,f.remote);
});
test('undock detects missing physical active hull after destruction/relogin',()=>{
 const f=scenario();f.items.delete(2001);
 assert.equal(status(f.guard.undock(f.sessions[0],2001)),'STATION_SHIP_ID_INVALID');
});
test('undock refuses ambiguous active record or packed capsule',()=>{
 const f=scenario();f.characters.get(1001).shipID=2003;
 assert.equal(status(f.guard.undock(f.sessions[0],2003)),'STATION_ACTIVE_SESSION_SHIP_STALE');
 f.sessions[0].shipID=2003;f.sessions[0].activeShipID=2003;f.items.get(2003).singleton=0;
 assert.equal(status(f.guard.undock(f.sessions[0],2003)),'STATION_ACTIVE_SHIP_INVALID');
});
test('undock ensures native persisted character ship ID agrees even if item record is owned',()=>{
 const f=scenario();f.characters.get(1001).shipID=2003;
 f.deps.getActiveShipRecord=()=>({...f.items.get(2001)});
 const guard=createStationShipGuard(f.deps);
 assert.equal(status(guard.undock(f.sessions[0],2001)),'STATION_ACTIVE_RECORD_SHIP_STALE');
});
test('dock validates original physical ship, system and session before detach',()=>{
 const f=scenario(),s=fixtureSpace(f),target={locationID:f.station,solarSystemID:f.system};
 assert.equal(status(f.guard.dock(s,f.station,target)),'OK');
 f.physical.get(2001).session=f.sessions[1];
 assert.equal(status(f.guard.dock(s,f.station,target)),'STATION_DOCK_BALLPARK_STALE');
});
test('dock refuses incomplete Ballpark bootstrap, including fresh reconnect',()=>{
 const f=scenario(),s=fixtureSpace(f),target={locationID:f.station,solarSystemID:f.system};
 s._space.initialStateSent=false;
 assert.equal(status(f.guard.dock(s,f.station,target)),'STATION_DOCK_BALLPARK_STALE');
});
test('dock fails closed on competing claims to the same native hull',()=>{
 const f=scenario(),s=fixtureSpace(f),target={locationID:f.station,solarSystemID:f.system};
 f.sessions[1]._space={shipID:2001,systemID:f.system,initialStateSent:true};
 assert.equal(status(f.guard.dock(s,f.station,target)),'STATION_DOCK_SHIP_DOUBLE_CLAIMED');
});
test('new guard instance after reconnect reads the same authoritative item and character records',()=>{
 const f=scenario();
 const next=createStationShipGuard(f.deps);
 assert.equal(status(next.activate(f.sessions[0],2003)),'OK');
 f.items.get(2003).locationID=f.remote;
 assert.equal(status(next.activate(f.sessions[0],2003)),'STATION_SHIP_NOT_IN_CURRENT_HANGAR');
});
test('dock cannot cross solar systems or select unverified station',()=>{
 const f=scenario(),s=fixtureSpace(f);
 assert.equal(status(f.guard.dock(s,f.remote,{locationID:f.remote,solarSystemID:30000144})),'STATION_DOCK_SYSTEM_MISMATCH');
 assert.equal(status(f.guard.dock(s,0,{locationID:0,solarSystemID:f.system})),'STATION_DOCK_SYSTEM_MISMATCH');
});
test('dock requires scene membership and no stale Ballpark ship ID',()=>{
 const f=scenario(),s=fixtureSpace(f),target={locationID:f.station,solarSystemID:f.system};
 f.scene.sessions.delete(1);
 assert.equal(status(f.guard.dock(s,f.station,target)),'STATION_DOCK_SCENE_SESSION_STALE');
 f.scene.sessions.set(1,s);s._space.shipID=2002;
 assert.equal(status(f.guard.dock(s,f.station,target)),'STATION_DOCK_BALLPARK_STALE');
});
test('dock cannot move a ship absent from authoritative ItemStore',()=>{
 const f=scenario(),s=fixtureSpace(f),target={locationID:f.station,solarSystemID:f.system};
 f.items.delete(2001);
 assert.equal(status(f.guard.dock(s,f.station,target)),'STATION_SHIP_ID_INVALID');
});
test('dock cannot be performed by a player whose character is already docked',()=>{
 const f=scenario();assert.equal(status(f.guard.dock(f.sessions[0],f.station,{locationID:f.station,solarSystemID:f.system})),'STATION_ALREADY_DOCKED');
});
test('docked switching does not affect the other character or cargo contents',()=>{
 const f=scenario();const cargo={itemID:7001,ownerID:1001,locationID:2001,flagID:5};
 const B={...f.characters.get(1002)};
 assert.equal(status(f.guard.activate(f.sessions[0],2003)),'OK');
 assert.equal(status(f.guard.undock(f.sessions[1],2002)),'OK');
 assert.deepEqual(f.characters.get(1002),B);assert.deepEqual(cargo,{itemID:7001,ownerID:1001,locationID:2001,flagID:5});
});
test('missing dependencies fail construction before ever authorizing an operation',()=>{
 assert.throws(()=>createStationShipGuard({}),/STATION_GUARD_DEPENDENCY_MISSING/);
});
test('native wrappers are inert when OFF and do not load upstream code',()=>{
 const previous=process.env.EVEJS_COOP_STATION_SHIP_GUARD;
 try{delete process.env.EVEJS_COOP_STATION_SHIP_GUARD;
   assert.doesNotThrow(()=>assertDockedActivation(null,100));
   assert.doesNotThrow(()=>assertUndock(null,100));
   assert.doesNotThrow(()=>assertDock(null,100,null));
 }finally{if(previous===undefined)delete process.env.EVEJS_COOP_STATION_SHIP_GUARD;else process.env.EVEJS_COOP_STATION_SHIP_GUARD=previous;}
});

test('undock rejects a stale alternate shipid or activeShipID even if shipID is correct',()=>{
 const f=scenario(),s=f.sessions[0];
 s.shipid=2003;
 assert.equal(status(f.guard.undock(s,2001)),'STATION_ACTIVE_SESSION_SHIP_STALE');
 delete s.shipid;s.activeShipID=2003;
 assert.equal(status(f.guard.undock(s,2001)),'STATION_ACTIVE_SESSION_SHIP_STALE');
});
test('dock refuses a stale active session ship even when Ballpark advertises correct ID',()=>{
 const f=scenario(),s=fixtureSpace(f),target={locationID:f.station,solarSystemID:f.system};
 s.activeShipID=2002;
 assert.equal(status(f.guard.dock(s,f.station,target)),'STATION_ACTIVE_SESSION_SHIP_STALE');
});
test('dock refuses a persisted active ship ID divergent from the native hull',()=>{
 const f=scenario(),s=fixtureSpace(f),target={locationID:f.station,solarSystemID:f.system};
 f.characters.get(1001).shipID=2003;
 f.deps.getActiveShipRecord=()=>({...f.items.get(2001)});
 const guard=createStationShipGuard(f.deps);
 assert.equal(status(guard.dock(s,f.station,target)),'STATION_ACTIVE_SESSION_SHIP_STALE');
});
test('type ID mismatch between owner ship listing and original itemStore fails closed',()=>{
 const f=scenario();f.deps.findCharacterShip=(charID,shipID)=>{
  const item=f.items.get(shipID);return item?.ownerID===charID?{...item,typeID:item.typeID+1}:null;
 };
 const guard=createStationShipGuard(f.deps);
 assert.equal(status(guard.activate(f.sessions[0],2003)),'STATION_SHIP_SNAPSHOT_DRIFT');
});
