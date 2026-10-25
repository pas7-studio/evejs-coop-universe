import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createPlayerTravelGuard, manifest} = require('../integration/coopPlayerTravelGuard.cjs');
const A=30000142,B=30000144;
function fixture() {
  let now=100000;
  const src={systemID:A,sessions:new Map(),entities:new Map()};
  const dest={systemID:B,sessions:new Map(),entities:new Map()};
  for(const s of [src,dest]) {
    s.getEntityByID=id=>s.entities.get(id)||null;
    s.getShipEntityForSession=session=>s.entities.get(session?._space?.shipID)||null;
  }
  const sessions=[];
  const ships=new Map();
  const contents=new Map();
  const physical=new Map();
  function add(characterID,shipID) {
    const session={characterID,userid:characterID+10000,shipID,shipid:shipID,activeShipID:shipID,
      socket:{destroyed:false},_space:{systemID:A,shipID,initialStateSent:true}};
    const ship={itemID:shipID,typeID:587,ownerID:characterID,locationID:A,
      conditionState:{shieldCharge:0.5,armorDamage:0.2,hullDamage:0.1},
      spaceState:{systemID:A}};
    const hull={kind:'ship',itemID:shipID,pilotCharacterID:characterID,
      radius:200,position:{x:0,y:0,z:0}};
    sessions.push(session);ships.set(characterID,ship);physical.set(shipID,hull);
    contents.set(shipID,[{itemID:shipID+1000,ownerID:characterID,typeID:123,
      locationID:shipID,flagID:27,quantity:-1,singleton:1},
      {itemID:shipID+2000,ownerID:characterID,typeID:456,
        locationID:shipID,flagID:5,quantity:40,singleton:0}]);
    src.sessions.set(characterID,session);src.entities.set(shipID,hull);
    return {session,ship,hull};
  }
  const gateA={itemID:900,kind:'stargate',position:{x:2000,y:0,z:0},radius:200};
  const gateB={itemID:901,kind:'stargate',position:{x:2000,y:0,z:0},radius:200};
  src.entities.set(900,gateA);dest.entities.set(901,gateB);
  const gates=new Map([[900,{itemID:900,solarSystemID:A,destinationID:901}],
    [901,{itemID:901,solarSystemID:B,destinationID:900}]]);
  const deps={getActiveShipRecord:char=>ships.get(char),
    getCharacterRecord:char=>({accountId:char+10000}),
    getSceneForSession:s=>s?._space?.systemID===A?src:s?._space?.systemID===B?dest:null,
    getSessions:()=>sessions.filter(s=>!s.socket.destroyed),
    listContainerItems:(_owner,shipID)=>structuredClone(contents.get(shipID)||[]),
    getStargateByID:id=>gates.get(id),clock:()=>now,maxAgeMs:5000};
  const guard=createPlayerTravelGuard(deps);
  function begin(session,kind='stargate') {return guard.begin({session,kind,sourceGateID:900,
    destinationGateID:901,destinationSystemID:B});}
  function arrive({session,ship,hull}) {
    src.sessions.delete(session.characterID);src.entities.delete(ship.itemID);
    ship.locationID=B;ship.spaceState.systemID=B;
    session._space.systemID=B;
    hull.position={x:20000,y:0,z:0};
    dest.sessions.set(session.characterID,session);dest.entities.set(ship.itemID,hull);
  }
  return {src,dest,sessions,ships,contents,gates,physical,gateA,gateB,deps,guard,begin,add,arrive,
    advance:ms=>now+=ms};
}
test('manifest is stable against order changes and rejects duplicates and injected items',()=>{
 const rows=[{itemID:5,locationID:1,flagID:27},{itemID:2,locationID:1,flagID:5}];
 assert.equal(manifest(rows,1),manifest([...rows].reverse(),1));
 assert.equal(manifest([rows[0],rows[0]],1),null);
 assert.equal(manifest([{itemID:7,locationID:42}],1),null);
});
test('two distinct pilots jump sequentially with same native ship identities and equipment',()=>{
 const x=fixture();const a=x.add(10,100),b=x.add(20,200);
 const ta=x.begin(a.session),tb=x.begin(b.session);
 assert.equal(ta.ok,true);assert.equal(tb.ok,true);
 assert.equal(x.guard.handoff(ta.ticket,a.session).ok,true);
 x.arrive(a);assert.equal(x.guard.finish(ta.ticket,a.session).ok,true);
 assert.equal(x.src.getEntityByID(200),b.hull);
 assert.equal(x.guard.handoff(tb.ticket,b.session).ok,true);
 x.arrive(b);assert.equal(x.guard.finish(tb.ticket,b.session).ok,true);
 assert.equal(x.dest.getEntityByID(100),a.hull);
 assert.equal(x.dest.getEntityByID(200),b.hull);
 assert.equal(x.guard.pendingCount(),0);
});
test('wrong owned ship is blocked before jump',()=>{
 const x=fixture(),a=x.add(10,100);a.ship.ownerID=20;
 assert.equal(x.begin(a.session).reason,'SHIP_OWNERSHIP_MISMATCH');
});
test('stale client ship ID cannot drive another active hull',()=>{
 const x=fixture(),a=x.add(10,100);a.session.shipid=200;
 assert.equal(x.begin(a.session).reason,'SESSION_SHIP_MISMATCH');
});
test('non-reciprocal stargate is blocked',()=>{
 const x=fixture(),a=x.add(10,100);x.gates.get(901).destinationID=456;
 assert.equal(x.begin(a.session).reason,'NON_RECIPROCAL_STARGATE');
});
test('missing physical gate is not treated as successful stargate range',()=>{
 const x=fixture(),a=x.add(10,100);x.src.entities.delete(900);
 assert.equal(x.begin(a.session).reason,'PHYSICAL_STARGATE_MISSING');
});
test('gate outside 2.5km surface distance is rejected',()=>{
 const x=fixture(),a=x.add(10,100);a.hull.position.x=10000;
 assert.equal(x.begin(a.session).reason,'STARGATE_OUT_OF_RANGE');
});
test('a duplicate real character session is rejected',()=>{
 const x=fixture(),a=x.add(10,100);x.sessions.push({...a.session,_space:{...a.session._space}});
 assert.equal(x.begin(a.session).reason,'DUPLICATE_CHARACTER_OR_SHIP_SESSION');
});
test('a second pilot claiming another pilot ship fails closed',()=>{
 const x=fixture(),a=x.add(10,100),b=x.add(20,200);
 b.session.shipID=100;
 assert.equal(x.begin(a.session).reason,'DUPLICATE_CHARACTER_OR_SHIP_SESSION');
});
test('another simultaneous transition kind is rejected',()=>{
 const x=fixture(),a=x.add(10,100);a.session._transitionState={kind:'dock',startedAt:1};
 assert.equal(x.begin(a.session).reason,'CONCURRENT_NATIVE_TRANSITION');
});
test('a second jump of the same player cannot supersede a pending handoff',()=>{
 const x=fixture(),a=x.add(10,100);
 assert.equal(x.begin(a.session).ok,true);
 assert.equal(x.begin(a.session).reason,'PLAYER_TRANSITION_ALREADY_PENDING');
});
test('disconnected delayed jump is blocked; a fresh native session may start again',()=>{
 const x=fixture(),a=x.add(10,100);const first=x.begin(a.session);
 a.session.socket.destroyed=true;
 assert.equal(x.guard.handoff(first.ticket,a.session).reason,'NO_ACTIVE_CHARACTER_SESSION');
 const next={...a.session,socket:{destroyed:false},_space:{...a.session._space}};
 x.sessions.push(next);x.src.sessions.set(10,next);
 const second=x.begin(next);
 assert.equal(second.ok,true);
 assert.equal(x.guard.handoff(first.ticket,a.session).reason,'STALE_TRANSITION_TICKET');
});
test('timer expiry prevents a stale handoff',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 x.advance(5001);
 assert.equal(x.guard.handoff(start.ticket,a.session).reason,'TRANSITION_EXPIRED');
 assert.equal(x.guard.cancel(start.ticket),true);
});
test('wrong destination scene cannot be claimed as arrival',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 assert.equal(x.guard.finish(start.ticket,a.session).reason,'WRONG_SOURCE_SYSTEM');
 assert.equal(x.guard.cancel(start.ticket),true);
});
test('cargo missing after native jump is detected, never repaired or created',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 x.arrive(a);x.contents.set(100,x.contents.get(100).slice(0,1));
 assert.equal(x.guard.finish(start.ticket,a.session).reason,'FITTING_OR_CARGO_CHANGED');
 assert.equal(x.contents.get(100).length,1);
});
test('changed HP from an interrupted jump is detected',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 x.arrive(a);a.ship.conditionState.hullDamage=0.7;
 assert.equal(x.guard.finish(start.ticket,a.session).reason,'SHIP_CONDITION_CHANGED');
});
test('destination hull with wrong owner fails closed',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 x.arrive(a);a.hull.pilotCharacterID=999;
 assert.equal(x.guard.finish(start.ticket,a.session).reason,'PHYSICAL_SHIP_OWNERSHIP_UNVERIFIED');
});
test('same source ship still attached on arrival cannot be accepted',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 x.arrive(a);x.src.entities.set(100,a.hull);
 // External observer must also check source absence: the native scene
 // representation is deliberately never modified by this guard.
 assert.equal(x.guard.finish(start.ticket,a.session).reason,'SOURCE_SCENE_SHIP_STILL_PRESENT');
 assert.ok(x.src.getEntityByID(100));
});
test('cancel requires the original ticket and leaves native state unchanged',()=>{
 const x=fixture(),a=x.add(10,100);const first=x.begin(a.session);
 assert.equal(x.guard.cancel({...first.ticket}),false);
 assert.equal(x.guard.cancel(first.ticket),true);
 assert.equal(x.guard.pendingCount(),0);
 assert.equal(a.ship.locationID,A);
});

test('actual native docking preserves fitting/hull and permits upstream shield/cap recharge',()=>{
 const x=fixture(),a=x.add(10,100);
 const begin=x.guard.begin({session:a.session,kind:'dock',destinationLocationID:60003760});
 assert.equal(begin.ok,true);
 x.src.sessions.delete(10);x.src.entities.delete(100);
 a.ship.locationID=60003760;a.ship.spaceState=null;
 a.ship.conditionState.shieldCharge=1;a.ship.conditionState.charge=1;
 // Must snapshot a charge field before beginning for the recharge comparison.
 assert.equal(x.guard.finish(begin.ticket,a.session,{docked:true}).reason,'DOCKED_NATIVE_STATE_MISMATCH');
 a.session._space=null;a.session.stationid=60003760;
 assert.equal(x.guard.finish(begin.ticket,a.session,{docked:true}).reason,'SHIP_CONDITION_CHANGED');
});
test('native docking recharge is accepted when charge exists in initial condition snapshot',()=>{
 const x=fixture(),a=x.add(10,100);a.ship.conditionState.charge=0.3;
 const begin=x.guard.begin({session:a.session,kind:'dock',destinationLocationID:60003760});
 assert.equal(begin.ok,true);
 x.src.sessions.delete(10);x.src.entities.delete(100);
 a.ship.locationID=60003760;a.ship.spaceState=null;
 a.ship.conditionState.shieldCharge=1;a.ship.conditionState.charge=1;
 a.session._space=null;a.session.stationid=60003760;
 assert.equal(x.guard.finish(begin.ticket,a.session,{docked:true}).ok,true);
});

test('sequential reciprocal native stargate hops require fresh verified source each time',()=>{
 const x=fixture(),a=x.add(10,100);
 const one=x.begin(a.session);assert.equal(one.ok,true);
 x.arrive(a);assert.equal(x.guard.finish(one.ticket,a.session).ok,true);
 a.hull.position={x:2100,y:0,z:0};
 const two=x.guard.begin({session:a.session,kind:'stargate',
  destinationSystemID:A,sourceGateID:901,destinationGateID:900});
 assert.equal(two.ok,true);
 x.dest.sessions.delete(10);x.dest.entities.delete(100);
 x.src.sessions.set(10,a.session);x.src.entities.set(100,a.hull);
 a.ship.locationID=A;a.ship.spaceState.systemID=A;a.session._space.systemID=A;
 assert.equal(x.guard.finish(two.ticket,a.session).ok,true);
 assert.equal(x.guard.pendingCount(),0);
});
test('jump-capable native solar jump uses real destination without requiring a stargate',()=>{
 const x=fixture(),a=x.add(10,100);
 const start=x.guard.begin({session:a.session,kind:'solar-jump',destinationSystemID:B});
 assert.equal(start.ok,true);
 x.arrive(a);
 assert.equal(x.guard.finish(start.ticket,a.session).ok,true);
});
test('old delayed handoff cannot change a replacement active ship',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 x.ships.get(10).itemID=404;
 assert.equal(x.guard.handoff(start.ticket,a.session).reason,'SESSION_SHIP_MISMATCH');
});
test('restart drops only ephemeral pending tickets and never replays or creates cargo',()=>{
 const x=fixture(),a=x.add(10,100);const start=x.begin(a.session);
 const restarted=createPlayerTravelGuard(x.deps);
 assert.equal(restarted.pendingCount(),0);
 assert.equal(restarted.finish(start.ticket,a.session).reason,'STALE_TRANSITION_TICKET');
 assert.equal(x.src.getEntityByID(100),a.hull);
 assert.equal(x.contents.get(100).length,2);
 const fresh=restarted.begin({session:a.session,kind:'stargate',
  sourceGateID:900,destinationGateID:901,destinationSystemID:B});
 assert.equal(fresh.ok,true);
});
test('native undock arrives into one source system with the original ship',()=>{
 const x=fixture(),a=x.add(10,100);
 x.src.entities.delete(100);x.src.sessions.delete(10);
 a.session._space=null;a.session.stationid=60003760;
 a.ship.locationID=60003760;a.ship.spaceState=null;
 const start=x.guard.begin({session:a.session,kind:'undock',destinationSystemID:A});
 assert.equal(start.ok,true);
 a.session.stationid=null;a.session._space={systemID:A,shipID:100,initialStateSent:true};
 a.ship.locationID=A;a.ship.spaceState={systemID:A};
 x.src.entities.set(100,a.hull);x.src.sessions.set(10,a.session);
 assert.equal(x.guard.finish(start.ticket,a.session).ok,true);
});
test('docking cannot pretend to be completed by an in-space destination',()=>{
 const x=fixture(),a=x.add(10,100);
 const start=x.guard.begin({session:a.session,kind:'dock',destinationLocationID:60003760});
 assert.equal(start.ok,true);
 assert.equal(x.guard.finish(start.ticket,a.session,{docked:false}).reason,'TRANSITION_KIND_MISMATCH');
});

test('ambiguous expired transition does not automatically unlock a second mutation',()=>{
 const x=fixture(),a=x.add(10,100);
 assert.equal(x.begin(a.session).ok,true);x.advance(1000000);
 assert.equal(x.begin(a.session).reason,'PLAYER_TRANSITION_ALREADY_PENDING');
});
test('failed destination verification remains unresolved rather than replaying jump',()=>{
 const x=fixture(),a=x.add(10,100);const first=x.begin(a.session);
 x.arrive(a);x.contents.get(100)[1].quantity=999;
 assert.equal(x.guard.finish(first.ticket,a.session).reason,'FITTING_OR_CARGO_CHANGED');
 assert.equal(x.guard.pendingCount(),1);
 assert.equal(x.guard.begin({session:a.session,kind:'solar-jump',destinationSystemID:A}).reason,
  'PLAYER_TRANSITION_ALREADY_PENDING');
});

test('native solar jump may originate from a legitimately docked ship',()=>{
 const x=fixture(),a=x.add(10,100);
 x.src.sessions.delete(10);x.src.entities.delete(100);
 a.session._space=null;a.session.stationid=60003760;
 a.ship.locationID=60003760;a.ship.spaceState=null;
 const start=x.guard.begin({session:a.session,kind:'solar-jump',destinationSystemID:B});
 assert.equal(start.ok,true);
 assert.equal(x.guard.handoff(start.ticket,a.session).ok,true);
 a.session.stationid=null;a.session._space={systemID:B,shipID:100,initialStateSent:true};
 a.ship.locationID=B;a.ship.spaceState={systemID:B};
 x.dest.entities.set(100,a.hull);x.dest.sessions.set(10,a.session);
 assert.equal(x.guard.finish(start.ticket,a.session).ok,true);
});
test('ghost undock with an active in-space ship record is blocked',()=>{
 const x=fixture(),a=x.add(10,100);
 a.session._space=null;a.session.stationid=60003760;
 assert.equal(x.guard.begin({session:a.session,kind:'undock',destinationSystemID:A}).reason,
   'NATIVE_DOCKED_SOURCE_UNVERIFIED');
});

test('source entity without optional pilot field still uses native getShipEntityForSession ownership',()=>{
 const x=fixture(),a=x.add(10,100);
 delete a.hull.pilotCharacterID;
 assert.equal(x.begin(a.session).ok,true);
});
test('native scene refuses to associate a ship with the wrong session',()=>{
 const x=fixture(),a=x.add(10,100);
 x.src.getShipEntityForSession=()=>null;
 assert.equal(x.begin(a.session).reason,'PHYSICAL_SHIP_OWNERSHIP_UNVERIFIED');
});

test('nested charges and subcontainers are checked, not just direct ship cargo',()=>{
 const x=fixture(),a=x.add(10,100);
 // Add a fitted module charge stored inside its module item ID.
 const nested={itemID:6000,ownerID:10,typeID:88,locationID:1100,flagID:0,quantity:4};
 x.deps.listContainerItems=(_owner,id)=>id===100?structuredClone(x.contents.get(100)):
  id===1100?[structuredClone(nested)]:[];
 const guard=createPlayerTravelGuard(x.deps);
 const first=guard.begin({session:a.session,kind:'stargate',
  sourceGateID:900,destinationGateID:901,destinationSystemID:B});
 assert.equal(first.ok,true);
 x.arrive(a);
 nested.quantity=3;
 assert.equal(guard.finish(first.ticket,a.session).reason,'FITTING_OR_CARGO_CHANGED');
});
test('native ship type cannot silently change across a jump',()=>{
 const x=fixture(),a=x.add(10,100),first=x.begin(a.session);
 x.arrive(a);a.ship.typeID=999;
 assert.equal(x.guard.finish(first.ticket,a.session).reason,'SHIP_TYPE_CHANGED');
});
test('malformed cyclical nested cargo fails closed',()=>{
 const a={itemID:1001,locationID:1002},b={itemID:1002,locationID:1001};
 assert.equal(manifest([a,b],100),null);
});
test('one disconnected pilot cannot interrupt an independent live pilot transition',()=>{
 const x=fixture(),a=x.add(10,100),b=x.add(20,200);
 const ta=x.begin(a.session),tb=x.begin(b.session);
 a.session.socket.destroyed=true;
 assert.equal(x.guard.handoff(ta.ticket,a.session).ok,false);
 assert.equal(x.guard.handoff(tb.ticket,b.session).ok,true);
 x.arrive(b);
 assert.equal(x.guard.finish(tb.ticket,b.session).ok,true);
 assert.equal(x.src.getEntityByID(100),a.hull);
});

test('native account is required, a foreign account cannot take another pilot hull',()=>{
 const x=fixture(),a=x.add(10,100);
 a.session.userid=99999;
 assert.equal(x.begin(a.session).reason,'NATIVE_ACCOUNT_OWNERSHIP_MISMATCH');
});
test('a client with incomplete native Ballpark cannot start an in-space transition',()=>{
 const x=fixture(),a=x.add(10,100);
 a.session._space.initialStateSent=false;
 assert.equal(x.begin(a.session).reason,'SOURCE_BALLPARK_NOT_READY');
});
test('detached socket is never interpreted as an authorized native session',()=>{
 const x=fixture(),a=x.add(10,100);
 a.session.socket=null;
 assert.equal(x.begin(a.session).reason,'NO_ACTIVE_CHARACTER_SESSION');
});

test('native in-flight warp blocks physical jump and dock preflight',()=>{
 const x=fixture(),a=x.add(10,100);
 a.hull.mode='WARP';
 assert.equal(x.begin(a.session).reason,'ACTIVE_WARP_BLOCKS_TRANSITION');
 assert.equal(x.guard.begin({session:a.session,kind:'dock',destinationLocationID:60003760}).reason,
  'ACTIVE_WARP_BLOCKS_TRANSITION');
 a.hull.mode='STOP';a.hull.pendingWarp={targetID:900};
 assert.equal(x.begin(a.session).reason,'ACTIVE_WARP_BLOCKS_TRANSITION');
 a.hull.pendingWarp=null;a.hull.warpState={duration:100};
 assert.equal(x.begin(a.session).reason,'ACTIVE_WARP_BLOCKS_TRANSITION');
});
test('physically published static EveJS gate is recognized without dynamic entity map copy',()=>{
 const x=fixture(),a=x.add(10,100);
 x.src.entities.delete(900);x.src.staticEntities=[x.gateA];
 assert.equal(x.begin(a.session).ok,true);
});
test('fitted native module customInfo and condition cannot change invisibly',()=>{
 const x=fixture(),a=x.add(10,100);
 x.contents.get(100)[0].customInfo='original';
 const first=x.begin(a.session);
 x.arrive(a);x.contents.get(100)[0].customInfo='changed';
 assert.equal(x.guard.finish(first.ticket,a.session).reason,'FITTING_OR_CARGO_CHANGED');
});

test('arrival needs actual native coordinates near EveJS-computed spawn anchor',()=>{
 const x=fixture(),a=x.add(10,100),first=x.begin(a.session);
 x.arrive(a);
 assert.equal(x.guard.finish(first.ticket,a.session,{expectedArrivalPoint:{x:90000,y:0,z:0}}).reason,
   'NATIVE_ARRIVAL_COORDINATES_MISMATCH');
 assert.equal(x.guard.pendingCount(),1);
 const result=x.guard.finish(first.ticket,a.session,{expectedArrivalPoint:{x:20100,y:0,z:0}});
 assert.equal(result.ok,true);assert.equal(result.nativeArrivalCoordinatesVerified,true);
 assert.equal(result.clientArrivalVerified,false);
});
test('missing source spawn anchor never claims confirmed position',()=>{
 const x=fixture(),a=x.add(10,100),first=x.begin(a.session);
 x.arrive(a);
 const result=x.guard.finish(first.ticket,a.session);
 assert.equal(result.ok,true);assert.equal(result.nativeArrivalCoordinatesVerified,false);
});

test('native scene lookup errors fail closed without taking down upstream RPC',()=>{
 const x=fixture(),a=x.add(10,100);
 x.src.getEntityByID=()=>{throw Error('stale scene')};
 assert.equal(x.begin(a.session).reason,'NATIVE_SCENE_UNAVAILABLE');
});
test('source scene evaporating mid-jump fails closed without claiming arrival',()=>{
 const x=fixture(),a=x.add(10,100),first=x.begin(a.session);
 x.arrive(a);x.src.getEntityByID=()=>{throw Error('evicted scene')};
 assert.equal(x.guard.finish(first.ticket,a.session).reason,'SOURCE_SCENE_UNAVAILABLE');
 assert.equal(x.guard.pendingCount(),1);
});
