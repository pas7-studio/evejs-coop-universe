import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {admitPilot,admitCraft,admitNativeLaunch,witnessAppliedDamage}=
 require('../integration/coopDroneFighterAuthority.cjs');
function fixture(){
 const char=1101,shipID=8001,systemID=30000144,craftID=9001;
 const session={clientID:101,characterID:char,socket:{destroyed:false},_space:{initialStateSent:true,shipID,systemID}};
 const ship={itemID:shipID,kind:'ship',pilotCharacterID:char,session,systemID};
 const craft={itemID:craftID,kind:'drone',typeID:444,ownerID:char,controllerID:shipID,launcherID:shipID,controllerOwnerID:char,systemID};
 const target={itemID:9999,kind:'ship',systemID};
 const entities=new Map([[shipID,ship],[craftID,craft],[9999,target]]);
 const records=new Map([[shipID,{itemID:shipID,ownerID:char,typeID:555}],
   [craftID,{itemID:craftID,ownerID:char,locationID:systemID,flagID:0,typeID:444}],
   [7001,{itemID:7001,ownerID:char,locationID:shipID,flagID:87,typeID:444}]]);
 const scene={systemID,sessions:new Map([[101,session]]),dynamicEntities:entities,getEntityByID:id=>entities.get(id)||null};
 const deps={scene,session,shipRecord:records.get(shipID),registryLookup:id=>id===char?session:null};
 const findItemById=id=>records.get(id)||null;
 const source={...craft,characterID:char,pilotCharacterID:char};
 return {session,ship,craft,target,scene,records,deps,source,findItemById};
}
const pilot=x=>admitPilot(x.deps);
const craft=x=>admitCraft({...x.deps,craftIDs:[x.craft.itemID],kind:x.craft.kind,findItemById:x.findItemById});
const damage=x=>witnessAppliedDamage({scene:x.scene,source:x.source,target:x.target,
 appliedDamage:10,findItemById:x.findItemById,registryLookup:x.deps.registryLookup});
test('two different players own independently authoritative ships and drones',()=>{
 const x=fixture(),b={clientID:102,characterID:1102,socket:{destroyed:false},_space:{initialStateSent:true,shipID:8002,systemID:30000144}};
 const shipB={itemID:8002,kind:'ship',pilotCharacterID:1102,session:b,systemID:x.scene.systemID};
 const droneB={itemID:9002,kind:'drone',typeID:444,ownerID:1102,controllerID:8002,launcherID:8002,controllerOwnerID:1102,systemID:x.scene.systemID};
 x.scene.sessions.set(102,b);x.scene.dynamicEntities.set(8002,shipB);x.scene.dynamicEntities.set(9002,droneB);
 x.records.set(8002,{itemID:8002,ownerID:1102});x.records.set(9002,{itemID:9002,ownerID:1102,locationID:x.scene.systemID,typeID:444,flagID:0});
 assert.equal(craft(x).ok,true);
 assert.equal(admitCraft({...x.deps,session:b,shipRecord:x.records.get(8002),registryLookup:id=>id===1102?b:x.session,
  craftIDs:[9002],kind:'drone',findItemById:x.findItemById}).ok,true);
 assert.equal(admitCraft({...x.deps,craftIDs:[9002],kind:'drone',findItemById:x.findItemById}).reason,'CRAFT_INVENTORY_CUSTODY_MISMATCH');
 assert.equal(damage(x).ok,true);
});
test('blocked ghost, duplicate, replaced, wrong-system and wrong-owner pilots',()=>{
 const x=fixture();assert.equal(pilot(x).ok,true);
 x.session.socket.destroyed=true;assert.equal(pilot(x).reason,'SESSION_NOT_BALLPARK_READY');x.session.socket.destroyed=false;
 const ghost={...x.session,clientID:103};x.scene.sessions.set(103,ghost);
 assert.equal(pilot(x).reason,'DUPLICATE_ACTIVE_CHARACTER_OR_SHIP');x.scene.sessions.delete(103);
 x.ship.session=ghost;assert.equal(pilot(x).reason,'PHYSICAL_SHIP_SESSION_MISMATCH');x.ship.session=x.session;
 x.scene.systemID=30000001;assert.equal(pilot(x).reason,'SESSION_IDENTITY_MISMATCH');x.scene.systemID=30000144;
 x.records.get(8001).ownerID=1102;assert.equal(pilot(x).reason,'ACTIVE_SHIP_INVENTORY_OWNER_MISMATCH');
});
test('session registry, physical hull identity and Ballpark readiness are mandatory',()=>{
 const x=fixture();x.deps.registryLookup=()=>null;assert.equal(pilot(x).reason,'REGISTRY_OWNER_MISMATCH');
 x.deps.registryLookup=()=>x.session;x.session._space.initialStateSent=false;assert.equal(pilot(x).reason,'SESSION_NOT_BALLPARK_READY');
 x.session._space.initialStateSent=true;x.scene.dynamicEntities.set(8001,{...x.ship,itemID:8009});
 assert.equal(pilot(x).reason,'NATIVE_SHIP_NOT_AUTHORITATIVE');
 x.scene.dynamicEntities.set(8001,x.ship);x.ship.nativeNpc=true;assert.equal(pilot(x).reason,'NATIVE_SHIP_NOT_AUTHORITATIVE');
});
test('control rejects substituted, foreign, missing, duplicate and incorrectly stored drone items',()=>{
 const x=fixture();assert.equal(craft(x).ok,true);
 x.craft.controllerID=8002;assert.equal(craft(x).reason,'CRAFT_CONTROL_OWNER_MISMATCH');x.craft.controllerID=8001;
 x.records.get(9001).locationID=8001;assert.equal(craft(x).reason,'CRAFT_INVENTORY_CUSTODY_MISMATCH');x.records.get(9001).locationID=x.scene.systemID;
 x.scene.dynamicEntities.set(9001,{...x.craft,itemID:9019});assert.equal(craft(x).reason,'CRAFT_NOT_AUTHORITATIVE');
 x.scene.dynamicEntities.set(9001,x.craft);
 assert.equal(admitCraft({...x.deps,craftIDs:[9001,9001],kind:'drone',findItemById:x.findItemById}).reason,'DUPLICATE_CRAFT_ID');
});
test('reconnect only detached owned drones; fighter reconnect is not invented',()=>{
 const x=fixture();x.craft.controllerID=null;x.craft.launcherID=null;x.craft.controllerOwnerID=0;
 assert.equal(admitCraft({...x.deps,craftIDs:[9001],kind:'drone',mode:'reconnect',findItemById:x.findItemById}).ok,true);
 x.craft.kind='fighter';x.craft.tubeFlagID=900;
 assert.equal(admitCraft({...x.deps,craftIDs:[9001],kind:'fighter',mode:'reconnect',findItemById:x.findItemById}).reason,'FIGHTER_RECONNECT_UNSUPPORTED');
 x.craft.controllerID=8001;
 assert.equal(admitCraft({...x.deps,craftIDs:[9001],kind:'fighter',mode:'scoop',findItemById:x.findItemById}).reason,'CRAFT_STILL_CONTROLLED');
});
test('fighter movement/abilities require originating tube and authoritative controller',()=>{
 const x=fixture();x.craft.kind='fighter';
 assert.equal(craft(x).reason,'FIGHTER_TUBE_ID_MISSING');x.craft.tubeFlagID=159;
 assert.equal(craft(x).ok,true);
 x.craft.controllerOwnerID=1102;assert.equal(craft(x).reason,'CRAFT_CONTROL_OWNER_MISMATCH');
});
test('launch ownership validation rejects foreign bay items, duplicate and already materialized hulls',()=>{
 const x=fixture();const launch=()=>admitNativeLaunch({...x.deps,itemIDs:[7001],kind:'drone',flagID:87,findItemById:x.findItemById});
 assert.equal(launch().ok,true);
 x.records.get(7001).ownerID=1102;assert.equal(launch().reason,'LAUNCH_ITEM_NOT_OWNED_IN_BAY');
 x.records.get(7001).ownerID=1101;x.scene.dynamicEntities.set(7001,{itemID:7001});
 assert.equal(launch().reason,'LAUNCH_ENTITY_ALREADY_PHYSICAL');
 assert.equal(admitNativeLaunch({...x.deps,itemIDs:[7001,7001],kind:'drone',flagID:87,findItemById:x.findItemById}).reason,'INVALID_OR_DUPLICATE_LAUNCH_ITEM');
});
test('native damage witness accepts only physical source, exact owner, positive applied damage and same victim',()=>{
 const x=fixture();assert.equal(damage(x).ok,true);
 assert.deepEqual({...damage(x)}, {...damage(x)});
 x.source.pilotCharacterID=1102;assert.equal(damage(x).reason,'COMBAT_ATTRIBUTION_OWNER_MISMATCH');
 x.source.pilotCharacterID=1101;x.source.controllerID=8002;assert.equal(damage(x).reason,'COMBAT_SOURCE_CONTROLLER_MISMATCH');
 x.source.controllerID=8001;
 assert.equal(witnessAppliedDamage({scene:x.scene,source:x.source,target:x.target,appliedDamage:0,findItemById:x.findItemById}).reason,'NO_VERIFIED_CRAFT_DAMAGE');
 x.scene.dynamicEntities.delete(x.target.itemID);assert.equal(damage(x).reason,'SOURCE_OR_TARGET_NOT_AUTHORITATIVE');
});
test('fighter damage witness never guesses the player identity from an NPC or detached entity',()=>{
 const x=fixture();x.craft.kind='fighter';x.source.kind='fighter';
 assert.equal(damage(x).ok,true);
 x.ship.session=null;assert.equal(damage(x).reason,'OWNER_SESSION_UNVERIFIED');
 x.ship.session=x.session;x.craft.controllerOwnerID=0;
 assert.equal(damage(x).reason,'COMBAT_ATTRIBUTION_OWNER_MISMATCH');
});
test('read-only functions do not mutate native state, stored inventory or emit network messages',()=>{
 const x=fixture();const before=JSON.stringify({session:x.session._space,ship:x.ship,craft:x.craft,item:x.records.get(9001)});
 assert.equal(craft(x).ok,true);assert.equal(damage(x).ok,true);
 assert.equal(JSON.stringify({session:x.session._space,ship:x.ship,craft:x.craft,item:x.records.get(9001)}),before);
});
