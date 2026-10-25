import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildCourierSession,preflight,undock,warp,dock,runStep}=require('../integration/coopCourierFlightDriver.cjs');

const flight={contractID:980000000,characterID:140000100,shipItemID:9988400100000,
 originStationID:60015260,destinationStationID:60015262,step:'undock'};
const position={x:1,y:2,z:3};

function ctx(overrides={}){
 const calls=[];
 return Object.assign({
  calls,
  character:{characterID:140000100,accountId:901,corporationID:98000001},
  transitions:{
   undockSession:(session,options)=>{calls.push(['undock',session.characterID,session.locationid]);return {success:true,shipID:9988400100000};},
   dockSession:(session,stationID)=>{calls.push(['dock',session.characterID,stationID]);return {success:true};},
  },
  space:{
   warpToPoint:(entityID,pos,options)=>{calls.push(['warp',entityID,pos.x,options.ingressDurationMs]);return true;},
   getShipEntityForCharacter:(characterID)=>{calls.push(['lookup',characterID]);return 980000000999;},
  },
 },overrides);
}

test('the courier identity object is not a registered client session',()=>{
 const session=buildCourierSession(ctx().character,60015260);
 assert.equal(session.characterID,140000100);
 assert.equal(session.locationid,60015260);
 assert.equal(session.sendNotification,undefined);
 assert.equal(session.isNpcCourier,true);
 assert.equal(buildCourierSession({},1),null);
});

test('preflight lists exactly what a half-wired server is missing',()=>{
 assert.equal(preflight(ctx()).status,'READY');
 const missing=preflight({transitions:{},space:{}});
 assert.equal(missing.status,'NOT_READY');
 assert.deepEqual(missing.missing.sort(),['space.getShipEntityForCharacter','space.warpToPoint','transitions.dockSession','transitions.undockSession']);
});

test('undock calls the native transition with the courier station and never retries',()=>{
 const runtime=ctx();
 assert.equal(undock(runtime,flight).status,'OK');
 assert.deepEqual(runtime.calls[0],['undock',140000100,60015260]);
 const failing=ctx({transitions:{undockSession:()=>{throw new Error('boom');},dockSession:()=>{}}});
 assert.equal(undock(failing,flight).status,'AMBIGUOUS');
});

test('a refused undock is reported as FAILED, not retried',()=>{
 const runtime=ctx({transitions:{undockSession:()=>({success:false,errorMsg:'DOCK_REQUIRED'}),dockSession:()=>{}}});
 const result=undock(runtime,flight);
 assert.equal(result.status,'FAILED');
 assert.equal(result.reason,'DOCK_REQUIRED');
});

test('warp needs a real station position and a ship actually in space',()=>{
 const runtime=ctx();
 assert.equal(warp(runtime,flight,null).status,'REFUSED');
 assert.equal(warp(runtime,flight,position).status,'OK');
 assert.deepEqual(runtime.calls.at(-1).slice(0,3),['warp',980000000999,1]);
 const noShip=ctx({space:{warpToPoint:()=>true,getShipEntityForCharacter:()=>0}});
 assert.equal(warp(noShip,flight,position).status,'FAILED');
});

test('dock uses the destination station and reports failure honestly',()=>{
 const runtime=ctx();
 assert.equal(dock(runtime,flight).status,'OK');
 assert.deepEqual(runtime.calls[0],['dock',140000100,60015262]);
 const bad=ctx({transitions:{undockSession:()=>{},dockSession:()=>({success:false,errorMsg:'TOO_FAR'})}});
 assert.equal(dock(bad,flight).status,'FAILED');
});

test('runStep executes exactly one step of the flight',()=>{
 const runtime=ctx();
 assert.equal(runStep(runtime,flight,position).status,'OK');
 assert.equal(runStep(runtime,{...flight,step:'warp'},position).status,'OK');
 assert.equal(runStep(runtime,{...flight,step:'dock'},position).status,'OK');
 assert.equal(runStep(runtime,{...flight,step:'done'},position).status,'DONE');
 assert.equal(runStep(runtime,{...flight,step:'nope'},position).status,'REFUSED');
});
