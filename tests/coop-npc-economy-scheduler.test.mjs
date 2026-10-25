import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createScheduler}=require("../integration/coopNpcEconomyScheduler.cjs");
const stations=[{ownerID:1000010,stationID:60000001,productTypeIDs:[215,215]}];
function fixture(tick=()=>({status:"SUFFICIENT_NATIVE_STOCK"})){
 let now=1000000,timers=[],closed=[];
 const scheduler=createScheduler({director:{tick},stations,clock:()=>now,
  setTimer:(fn,delay)=>{const timer={fn,delay,unref(){}};timers.push(timer);return timer},
  clearTimer:timer=>closed.push(timer)});
 return {scheduler,timers,closed,advance:ms=>now+=ms};
}
async function run(fn){const a=process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY,b=process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER;
 process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY="1";process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER="1";
 try{return await fn()}finally{if(a===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY;
 else process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY=a;
 if(b===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER;
 else process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER=b}}
test("scheduler defaults OFF and cannot create a timer",async()=>run(async()=>{
 const f=fixture();delete process.env.EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER;
 assert.equal(f.scheduler.start().status,"SCHEDULER_DISABLED");assert.equal(f.timers.length,0);
}));
test("explicit start registers exactly one interval and stop clears it",async()=>run(async()=>{
 const f=fixture();assert.equal(f.scheduler.start().status,"STARTED");
 assert.equal(f.scheduler.start().status,"ALREADY_STARTED");assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,60000);
 assert.equal(f.scheduler.stop().status,"STOPPED");assert.equal(f.closed.length,1);
}));
test("one bounded native action per cooldown; no crash catchup flood",async()=>run(async()=>{
 let calls=0;const f=fixture(()=>{calls++;return{status:"PREPARED"}});
 f.scheduler.start();assert.equal((await f.scheduler.runOnce()).status,"CYCLE_COMPLETE");
 assert.equal((await f.scheduler.runOnce()).status,"SCHEDULER_RATE_LIMITED");
 assert.equal(calls,1);f.advance(60000);await f.scheduler.runOnce();assert.equal(calls,2);f.scheduler.stop();
}));
test("asynchronous Rust market call cannot cause overlapping station ticks",async()=>run(async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>{release=()=>resolve({status:"LISTED"})}));
 f.scheduler.start();const pending=f.scheduler.runOnce();
 assert.equal((await f.scheduler.runOnce()).status,"SCHEDULER_BUSY");
 release();assert.equal((await pending).status,"CYCLE_COMPLETE");f.scheduler.stop();
}));
test("uncertain native outcome pauses station; no second debit",async()=>run(async()=>{
 let calls=0;const f=fixture(()=>{calls++;return{status:"BLOCKED",reason:"OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION"}});
 f.scheduler.start();assert.equal((await f.scheduler.runOnce()).status,"NEEDS_OPERATOR_ATTENTION");
 f.advance(60000);const r=await f.scheduler.runOnce();assert.equal(r.outcomes[0].status,"STATION_PAUSED");
 assert.equal(calls,1);f.scheduler.stop();
}));
test("thrown game engine or market exception quarantines station",async()=>run(async()=>{
 let n=0;const f=fixture(()=>{n++;throw Error("NATIVE_RPC_ACK_LOST")});
 f.scheduler.start();const r=await f.scheduler.runOnce();assert.equal(r.outcomes[0].status,"STATION_ERROR");
 f.advance(60000);await f.scheduler.runOnce();assert.equal(n,1);f.scheduler.stop();
}));
test("station requires explicit operator authorization after reconciliation",async()=>run(async()=>{
 let fail=true;const f=fixture(()=>fail?{status:"BLOCKED",reason:"NO_RECEIPT"}:{status:"READY"});
 f.scheduler.start();await f.scheduler.runOnce();
 assert.equal(f.scheduler.resume("1000010:60000001").status,"RECONCILIATION_REQUIRED");
 assert.equal(f.scheduler.resume("1000010:60000001",{operatorVerified:true}).status,"RESUMED");
 fail=false;f.advance(60000);assert.equal((await f.scheduler.runOnce()).outcomes[0].status,"READY");f.scheduler.stop();
}));
test("invalid duplicated station and high-frequency auto ticks refuse to start",()=>{
 assert.throws(()=>createScheduler({director:{tick:()=>({})},stations,intervalMs:5}),/SCHEDULER_DEPENDENCIES/);
 assert.throws(()=>createScheduler({director:{tick:()=>({})},stations:[...stations,...stations]}),/DUPLICATE_STATION/);
});
