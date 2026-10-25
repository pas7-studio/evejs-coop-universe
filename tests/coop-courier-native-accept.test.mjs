import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildNpcSession,accept,complete}=require('../integration/coopCourierNativeAccept.cjs');

const contract={
 contractID:980000000,contractType:'courier',status:'outstanding',
 plasticWrapItemID:9988400000874,volume:29500,reward:30000,collateral:300000,
 startStationID:60015260,endStationID:60015262,
 startSolarSystemID:30000142,endSolarSystemID:30000142,
};
const identity={
 character:{characterID:140000100,accountId:901,corporationID:98000001,stationID:60015260,balance:25000000},
 ship:{itemID:9988400100000,typeID:20185,ownerID:140000100,stationID:60015260,capacityM3:465000},
};

function fakeRuntime(live={}){
 const calls=[];
 return {
  calls,
  getContractRecord:()=>Object.assign({status:0,acceptorID:0},live),
  acceptContract:(id,session,forCorp)=>{calls.push(['accept',id,session,forCorp]);return {contractID:id};},
  completeContract:(id,target,session)=>{calls.push(['complete',id,target,session]);return true;},
 };
}

test('a synthetic NPC session carries only identity and no client channel',()=>{
 const session=buildNpcSession(identity.character);
 assert.equal(session.charid,140000100);
 assert.equal(session.userid,901);
 assert.equal(session.sendNotification,undefined);
 assert.equal(buildNpcSession({characterID:0}),null);
});

test('accept refuses to start a chain it cannot finish',()=>{
 const runtime=fakeRuntime();
 const result=accept({contract,identity,packageLocationID:60009999,runtime});
 assert.equal(result.status,'REFUSED');
 assert.equal(runtime.calls.length,0);
});

test('accept calls the native path with the courier identity only',()=>{
 const runtime=fakeRuntime();
 const result=accept({contract,identity,packageLocationID:60015260,runtime});
 assert.equal(result.status,'ACCEPTED');
 assert.deepEqual(result.next,['fly','complete']);
 assert.equal(runtime.calls.length,1);
 const [kind,id,session,forCorp]=runtime.calls[0];
 assert.equal(kind,'accept');
 assert.equal(id,980000000);
 assert.equal(session.charid,140000100);
 assert.equal(forCorp,false);
});

test('accept refuses a contract that already has an acceptor',()=>{
 const runtime=fakeRuntime({acceptorID:140000005});
 assert.equal(accept({contract,identity,packageLocationID:60015260,runtime}).status,'REFUSED');
 assert.equal(runtime.calls.length,0);
});

test('an ambiguous accept is reported and never retried',()=>{
 const runtime=fakeRuntime();
 runtime.acceptContract=()=>{runtime.calls.push(['accept']);throw new Error('socket closed');};
 const result=accept({contract,identity,packageLocationID:60015260,runtime});
 assert.equal(result.status,'AMBIGUOUS');
 assert.match(result.reason,/socket closed/);
 assert.equal(runtime.calls.length,1);
});

test('complete refuses until the package is physically at the destination',()=>{
 const runtime=fakeRuntime({acceptorID:140000100});
 assert.equal(complete({contract,identity,packageLocationID:60015260,runtime}).status,'REFUSED');
 assert.equal(runtime.calls.length,0);
});

test('complete refuses when this courier is not the acceptor',()=>{
 const runtime=fakeRuntime({acceptorID:140000101,status:1});
 assert.equal(complete({contract,identity,packageLocationID:60015262,runtime}).status,'REFUSED');
 assert.equal(runtime.calls.length,0);
});

test('complete uses the native FINISHED status for the real acceptor',()=>{
 const runtime=fakeRuntime({acceptorID:140000100,status:1});
 const result=complete({contract,identity,packageLocationID:60015262,runtime});
 assert.equal(result.status,'COMPLETED');
 assert.deepEqual(runtime.calls[0].slice(0,3),['complete',980000000,4]);
 assert.notEqual(runtime.calls[0][2],5,'5 is CANCELLED, not FINISHED');
});

test('complete refuses a contract that is not in progress',()=>{
 const runtime=fakeRuntime({acceptorID:140000100,status:0});
 const result=complete({contract,identity,packageLocationID:60015262,runtime});
 assert.equal(result.status,'REFUSED');
 assert.equal(runtime.calls.length,0);
});
