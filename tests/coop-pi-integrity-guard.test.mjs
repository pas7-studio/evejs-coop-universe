import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createPiIntegrityGuard,CODE,beforeNetwork,beforeLaunch,beforeCustoms,afterLaunch,beforeGmMutation}=require('../integration/coopPiIntegrityGuard.cjs');
const system=30000144,planet=40000011,otherPlanet=40000012,office=12000040000011;
const flags={CARGO_HOLD:5,SPECIALIZED_COMMAND_CENTER_HOLD:133,COLONY_RESOURCES_HOLD:153,HANGAR:4};
function f(){
 let now=Date.parse('2026-10-25T15:00:00Z');
 const items=new Map([[700,{itemID:700,ownerID:101,typeID:2200,locationID:1001,flagID:5,singleton:1}],
 [701,{itemID:701,ownerID:102,typeID:2200,locationID:1002,flagID:5,singleton:1}]]);
 const inventory={ITEM_FLAGS:flags,findItemById:id=>items.get(Number(id))||null};
 const staticData={getPinEntityType:type=>Number(type)===2200?'command':Number(type)===2544?'spaceport':'storage'};
 const runtime={COMMAND:{CREATEPIN:1}};
 const guard=createPiIntegrityGuard({inventory,staticData,runtime,clock:()=>now});
 const a={characterID:101,shipID:1001,_space:{shipID:1001}},b={characterID:102,shipID:1002,_space:{shipID:1002}};
 const ca={planetID:planet,solarSystemID:system,ownerID:101,pins:[{pinID:12,typeID:2544,ownerID:101}]};
 const cb={planetID:planet,solarSystemID:system,ownerID:102,pins:[{pinID:13,typeID:2544,ownerID:102}]};
 const orbital={itemID:office,groupID:1025,planetID:planet,solarSystemID:system,state:-4,ownerID:1,corporationID:1};
 return {guard,items,a,b,ca,cb,orbital,inventory,staticData,runtime,setNow:x=>now=x};
}
const center=(id,type=2200)=>[{id:1,args:[id,type,0.2,0.1]}];
const verify=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('owner A consumes only an existing cargo-mounted native command center with exact itemID',()=>{
 const v=f();assert.deepEqual(v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:center(700),existingColony:null}),{ok:true,sourceItems:[700]});
});
test('two independent colonists on one planet use different command-center items',()=>{
 const v=f();assert.deepEqual(v.guard.assertCommandCenterEdit({session:v.b,ownerID:102,planetID:planet,serializedChanges:center(701)}).sourceItems,[701]);
 assert.deepEqual(v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:center(700)}).sourceItems,[700]);
});
test('another character cannot deploy a physical command center owned by the other colonist',()=>{
 const v=f();verify(()=>v.guard.assertCommandCenterEdit({session:v.b,ownerID:102,planetID:planet,serializedChanges:center(700)}),CODE.SOURCE);
});
test('command-center creation rejects temporary/generated pin IDs that native code cannot debit',()=>{
 const v=f();verify(()=>v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:center(-123)}),CODE.SOURCE);
});
test('wrong cargo ship, wrong type, wrong flag all reject pre-mutation',()=>{
 for(const patch of [{locationID:1002},{typeID:1111},{flagID:4}]){
  const v=f();Object.assign(v.items.get(700),patch);
  verify(()=>v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:center(700)}),CODE.SOURCE);
 }
});
test('missing ship and actor mismatch reject',()=>{
 const v=f();const s={...v.a,_space:{shipID:0},shipID:0};
 verify(()=>v.guard.assertCommandCenterEdit({session:s,ownerID:101,planetID:planet,serializedChanges:center(700)}),CODE.SOURCE);
 verify(()=>v.guard.assertCommandCenterEdit({session:v.a,ownerID:102,planetID:planet,serializedChanges:center(700)}),CODE.OWNER);
});
test('no second command center may overwrite an existing one',()=>{
 const v=f();v.ca.pins.push({pinID:900,typeID:2200,ownerID:101});
 verify(()=>v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:center(700),existingColony:v.ca}),CODE.SOURCE);
});
test('unrecognized serialized command shape fails closed without a free pin write',()=>{
 const v=f();verify(()=>v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:[{commandID:1,args:null}]}),CODE.SOURCE);
});
test('two CREATEPIN command centers in same command batch denied',()=>{
 const v=f();verify(()=>v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:[...center(700),...center(701)]}),CODE.SOURCE);
});
test('ordinary route or processor edits do not require a new command-center item',()=>{
 const v=f();assert.equal(v.guard.assertCommandCenterEdit({session:v.a,ownerID:101,planetID:planet,serializedChanges:[{id:6,args:[1,[12,55],2267,100]}],existingColony:v.ca}).ok,true);
});
test('both colonists may use same legitimate customs office with individually owned spaceport pins',()=>{
 const v=f();for(const [session,ownerID,colony,pin] of [[v.a,101,v.ca,12],[v.b,102,v.cb,13]]){
 assert.equal(v.guard.assertOfficeTransfer({session,ownerID,officeID:office,spaceportPinID:pin,colony,office:v.orbital}).ok,true);
 }
});
test('customs office of another planet or system cannot teleport commodities',()=>{
 const v=f();for(const changed of [{planetID:otherPlanet},{solarSystemID:30000142}]){
 verify(()=>v.guard.assertOfficeTransfer({session:v.a,ownerID:101,officeID:office,spaceportPinID:12,colony:v.ca,office:{...v.orbital,...changed}}),CODE.OFFICE);
 }
});
test('foreign pin and foreign colony rejected even when the same office is legitimate',()=>{
 const v=f();verify(()=>v.guard.assertOfficeTransfer({session:v.a,ownerID:101,officeID:office,spaceportPinID:13,colony:v.cb,office:v.orbital}),CODE.OWNER);
 verify(()=>v.guard.assertOfficeTransfer({session:v.a,ownerID:101,officeID:office,spaceportPinID:13,colony:v.ca,office:v.orbital}),CODE.OFFICE);
});
test('spoofed orbital ID, category, offlined or destroyed office fail',()=>{
 const v=f();for(const changed of [{itemID:office+1},{groupID:1106},{state:-7},{state:-2}]){
 verify(()=>v.guard.assertOfficeTransfer({session:v.a,ownerID:101,officeID:office,spaceportPinID:12,colony:v.ca,office:{...v.orbital,...changed}}),CODE.OFFICE);
 }
});
test('one normal fleet member cannot alter InterBus or corporate customs taxes',()=>{
 const v=f();verify(()=>v.guard.assertOfficeSettings({session:v.a,officeID:office,office:v.orbital}),CODE.SETTINGS);
});
test('personally owned office permits exact owner only',()=>{
 const v=f(),owned={...v.orbital,ownerID:101};
 assert.equal(v.guard.assertOfficeSettings({session:v.a,officeID:office,office:owned}).authority,'PERSONAL_OWNER');
 verify(()=>v.guard.assertOfficeSettings({session:v.b,officeID:office,office:owned}),CODE.SETTINGS);
});
test('corporate access needs explicit verified role, not merely matching corp ID',()=>{
 const v=f(),o={...v.orbital,ownerID:990,corporationID:990};
 verify(()=>v.guard.assertOfficeSettings({session:v.a,officeID:office,office:o}),CODE.SETTINGS);
 const custom=createPiIntegrityGuard({inventory:v.inventory,staticData:v.staticData,runtime:v.runtime,canManageCorporateOrbital:({session})=>session.characterID===101});
 assert.equal(custom.assertOfficeSettings({session:v.a,officeID:office,office:o}).authority,'VERIFIED_CORPORATE_ROLE');
 verify(()=>custom.assertOfficeSettings({session:v.b,officeID:office,office:o}),CODE.SETTINGS);
});
test('unphysicalized launch remains unresolved after reconnect/new guard instance',()=>{
 const v=f(),launches=[{launchID:23,ownerID:101,planetID:planet,createdAt:'2026-10-25T14:59:00Z',deleted:false}];
 verify(()=>v.guard.assertLaunchReady({session:v.a,planetID:planet,launches}),CODE.LAUNCH);
 const newGuard=createPiIntegrityGuard({inventory:v.inventory,staticData:v.staticData,runtime:v.runtime,clock:()=>Date.parse('2026-10-25T15:01:00Z')});
 verify(()=>newGuard.assertLaunchReady({session:v.a,planetID:planet,launches}),CODE.LAUNCH);
});
test('launch fence does not stop other owner or other planet',()=>{
 const v=f(),launches=[{launchID:23,ownerID:101,planetID:planet,createdAt:'2026-10-25T14:59:00Z'}];
 assert.equal(v.guard.assertLaunchReady({session:v.b,planetID:planet,launches}).ok,true);
 assert.equal(v.guard.assertLaunchReady({session:v.a,planetID:otherPlanet,launches}).ok,true);
});
test('seven-day stale legacy launches and deleted launches are excluded from active fence',()=>{
 const v=f();assert.equal(v.guard.assertLaunchReady({session:v.a,planetID:planet,launches:[{launchID:23,ownerID:101,planetID:planet,deleted:true,createdAt:'2026-10-25T14:59:00Z'},{launchID:24,ownerID:101,planetID:planet,createdAt:'2026-10-01T00:00:00Z'}]}).ok,true);
});
test('physical container cargo must match native launch record by owner, type, quantity',()=>{
 const v=f();const launch={launchID:55,ownerID:101,planetID:planet,solarSystemID:system,contents:{2267:120,2268:30}};
 const committed={...launch,physicalContainerID:777};const container={itemID:777,ownerID:101,locationID:system};
 const items=[{typeID:2267,ownerID:101,locationID:777,stacksize:100},{typeID:2267,ownerID:101,locationID:777,stacksize:20},{typeID:2268,ownerID:101,locationID:777,stacksize:30}];
 assert.equal(v.guard.assertLaunchPhysicalized({session:v.a,launch,readLaunch:()=>committed,container,items,sceneEntity:{itemID:777,ownerID:101}}).ok,true);
 for(const patch of [{ownerID:102},{locationID:otherPlanet},{itemID:778}])verify(()=>v.guard.assertLaunchPhysicalized({session:v.a,launch,readLaunch:()=>committed,container:{...container,...patch},items,sceneEntity:{itemID:777,ownerID:101}}),CODE.CARGO);
});
test('missing native container or quantity deficit never reports launch success',()=>{
 const v=f();const launch={launchID:55,ownerID:101,planetID:planet,solarSystemID:system,contents:{2267:120}};
 const data={...launch,physicalContainerID:777};
 const args={session:v.a,launch,readLaunch:()=>data,container:{itemID:777,ownerID:101,locationID:system},sceneEntity:{itemID:777,ownerID:101},items:[{typeID:2267,ownerID:101,locationID:777,stacksize:119}]};
 verify(()=>v.guard.assertLaunchPhysicalized(args),CODE.CARGO);
 verify(()=>v.guard.assertLaunchPhysicalized({...args,readLaunch:()=>({...data,physicalContainerID:null})}),CODE.CARGO);
});
test('foreign cargo inside launch container or surplus items prevent a false exact receipt',()=>{
 const v=f();const launch={launchID:55,ownerID:101,planetID:planet,solarSystemID:system,contents:{2267:100}};
 const data={...launch,physicalContainerID:777};const container={itemID:777,ownerID:101,locationID:system};
 for(const items of [[{typeID:2267,ownerID:102,locationID:777,stacksize:100}], [{typeID:2267,ownerID:101,locationID:777,stacksize:101}]])verify(()=>v.guard.assertLaunchPhysicalized({session:v.a,launch,readLaunch:()=>data,container,items,sceneEntity:{itemID:777,ownerID:101}}),CODE.CARGO);
});
test('native ItemStore receipt is insufficient without a physical Ballpark container',()=>{
 const v=f(),launch={launchID:55,ownerID:101,planetID:planet,solarSystemID:system,contents:{2267:1}};
 const args={session:v.a,launch,readLaunch:()=>({...launch,physicalContainerID:777}),container:{itemID:777,ownerID:101,locationID:system},items:[{ownerID:101,typeID:2267,locationID:777,stacksize:1}]};
 verify(()=>v.guard.assertLaunchPhysicalized({...args,sceneEntity:null}),CODE.CARGO);
 verify(()=>v.guard.assertLaunchPhysicalized({...args,sceneEntity:{itemID:888}}),CODE.CARGO);
 assert.equal(v.guard.assertLaunchPhysicalized({...args,sceneEntity:{itemID:777}}).ok,true);
});
test('GM commodity mint is strictly denied under integrity policy',()=>{
 const v=f();verify(()=>v.guard.disableGmCommodity(),CODE.GM);
});
test('all native wrapper functions remain OFF by default (no native require or synthetic mutation)',()=>{
 for(const method of [()=>beforeNetwork({}),()=>beforeCustoms({}),()=>beforeLaunch({}),()=>afterLaunch({}),()=>beforeGmMutation()])assert.equal(method(),null);
});
