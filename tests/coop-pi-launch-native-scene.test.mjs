import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const base=path.resolve(import.meta.dirname,'../integration/coopPiIntegrityGuard.cjs');
const source=fs.readFileSync(base,'utf8');
const system=30000144, owner=101, containerID=700001, launchID=700;
function run({scenePresent=true,sceneOwner=owner,itemOwner=owner}={}){
 const launch={launchID,planetID:400001,ownerID:owner,solarSystemID:system,contents:{2267:12}};
 const saved={...launch,physicalContainerID:containerID};
 const inventory={ITEM_FLAGS:{HANGAR:4},findItemById:id=>id===containerID?{itemID:containerID,ownerID:itemOwner,locationID:system}:null,
  listContainerItems:(id,loc,flag)=>[{typeID:2267,ownerID:owner,locationID:containerID,stacksize:12}]};
 const runtime={getLaunch:()=>saved};
 const space={ensureScene:()=>({getEntityByID:id=>scenePresent?{itemID:id,ownerID:sceneOwner}:null})};
 const services={
  '../services/inventory/itemStore':inventory,
  '../services/planet/planetRuntimeStore':runtime,
  '../services/planet/planetStaticData':{},
  '../services/planet/planetOrbitalState':{},
  '../space/runtime':space,
  '../common/machoErrors':{throwWrappedUserError:(_,d)=>{throw Error(d.notify)}}
 };
 const module={exports:{}};
 new Function('module','require','process',source)(module,n=>{if(!(n in services))throw Error('unknown '+n);return services[n]}, {env:{EVEJS_COOP_PI_INTEGRITY:'1'}});
 return module.exports.afterLaunch({session:{characterID:owner},launch});
}
test('native wrapper attests the real physical Ballpark entity',()=>{
 const r=run();assert.deepEqual(r,{ok:true,launchID,physicalContainerID:containerID});
});
test('no physical Ballpark entity cannot acknowledge a launch',()=>{
 assert.throws(()=>run({scenePresent:false}),/PI_PHYSICAL_LAUNCH_CARGO_UNVERIFIED/);
});
test('foreign scene owner cannot satisfy PI custody',()=>{
 assert.throws(()=>run({sceneOwner:202}),/PI_PHYSICAL_LAUNCH_CARGO_UNVERIFIED/);
});
test('foreign inventory container cannot satisfy PI custody',()=>{
 assert.throws(()=>run({itemOwner:202}),/PI_PHYSICAL_LAUNCH_CARGO_UNVERIFIED/);
});
