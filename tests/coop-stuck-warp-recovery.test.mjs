import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {release}=require('../integration/coopStuckWarpRecovery.cjs');

const now=5000000;
const ship=extra=>({itemID:980000000123,mode:'WARP',position:{x:1,y:2,z:3},
 velocity:{x:9,y:9,z:9},speedFraction:1,pendingWarp:null,
 warpState:{targetPoint:{x:100,y:0,z:0},completeAtMs:now-1},...extra});
const scene={systemID:30000144,broadcasts:0,broadcastSlimItemChanges(){this.broadcasts+=1}};

test('an interrupted warp is finished at its real target and the ship can mine again',()=>{
 const s=ship();
 assert.equal(release(s,scene,now),'WARP_COMPLETED');
 assert.equal(s.mode,'STOP');
 assert.deepEqual(s.position,{x:100,y:0,z:0});
 assert.deepEqual(s.velocity,{x:0,y:0,z:0});
 assert.equal(s.warpState,null);
 assert.equal(s.speedFraction,0);
 assert.equal(scene.broadcasts,1,'a landed ship must be broadcast to clients');
});

test('a warp that is still in flight is never touched',()=>{
 const s=ship({warpState:{targetPoint:{x:100,y:0,z:0},completeAtMs:now+60000}});
 assert.equal(release(s,scene,now),null);
 assert.equal(s.mode,'WARP');
});

test('a queued warp is never cancelled',()=>{
 const s=ship({pendingWarp:{targetPoint:{x:5,y:5,z:5}}});
 assert.equal(release(s,scene,now),null);
 assert.equal(s.mode,'WARP');
});

test('a bare WARP mode is never landed without a provable warp clock',()=>{
 const s=ship({warpState:null,targetPoint:null});
 assert.equal(release(s,scene,now),null);
 assert.equal(s.mode,'WARP');
});

test('a landed ship is left alone',()=>{
 const s=ship({mode:'STOP',warpState:null});
 assert.equal(release(s,scene,now),null);
 assert.equal(s.mode,'STOP');
});
