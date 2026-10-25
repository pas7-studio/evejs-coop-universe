import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createPersonalGoals}=require('../integration/coopNpcPersonalGoals.cjs');
const SID=30000144;
const f=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npc-goals-'));let now=1_000_000;
 const file=path.join(dir,'goals.json');const create=()=>createPersonalGoals({file,clock:()=>now,minDwellMs:120000});
 return {create, file, advance:n=>{now+=n},cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};};
const input=(pilotID='coop-pilot-003')=>({pilotID,systemID:SID,assessment:'SCOUT',gateCount:2,beltCount:2,stationCount:1});
test('individual scouting preference survives process restart without randomization',()=>{
 const x=f();try{let g=x.create();const a=g.decide(input());assert.equal(a.status,'PLANNED');
 assert.equal(a.intent,'WATCH_BELT');assert.equal(g.routeRole(input()),'watch');
 const b=x.create().decide(input());assert.equal(b.status,'UNCHANGED');
 assert.equal(b.changedAt,a.changedAt);assert.equal(g.snapshot().pilots['coop-pilot-003'].nativeOrdersObserved,0);
 }finally{x.cleanup();}});
test('different named pilot has its own route preference',()=>{
 const x=f();try{const g=x.create();assert.equal(g.decide(input('coop-pilot-004')).intent,'SCOUT_GATE');
 assert.equal(g.routeRole({pilotID:'coop-pilot-004',systemID:SID}),'scout');
 assert.equal(g.routeRole({pilotID:'coop-pilot-004',systemID:30000142}),null);
 }finally{x.cleanup();}});
test('risky raid changes to belt watch instead of scripted attack',()=>{
 const x=f();try{const g=x.create();const a=g.decide({...input(),assessment:'WORK'});
 assert.equal(a.intent,'WATCH_BELT');assert.equal(a.reason,'RAID_NOT_WORTH_RISK');
 assert.equal(g.routeRole(input()),'watch');
 }finally{x.cleanup();}});
test('confirmed native raid order yields HUNT but unconfirmed candidate does not',()=>{
 const x=f();try{const g=x.create();const a=g.decide({...input(),assessment:'RAID'});
 assert.notEqual(a.intent,'HUNT');
 const b=g.decide({...input(),assessment:'RAID',verifiedRaid:true});
 assert.equal(b.intent,'HUNT');assert.equal(b.reason,'VERIFIED_NATIVE_ORDER');
 assert.equal(g.routeRole(input()),null);
 }finally{x.cleanup();}});
test('danger overrides dwell and chooses station without pretending to repair',()=>{
 const x=f();try{const g=x.create();g.decide(input());const a=g.decide({...input(),danger:true});
 assert.equal(a.intent,'LAY_LOW');assert.equal(g.routeRole(input()),'lay-low');
 assert.equal(g.snapshot().pilots['coop-pilot-003'].nativeOrdersObserved,0);
 }finally{x.cleanup();}});
test('no available POI cannot hallucinate a belt or gate',()=>{
 const x=f();try{const g=x.create();const r=g.decide({...input(),gateCount:0,beltCount:0,stationCount:0});
 assert.equal(r.intent,'LAY_LOW');
 }finally{x.cleanup();}});
test('normal intention hysteresis prevents 30s tick route flapping',()=>{
 const x=f();try{const g=x.create();const a=g.decide(input('coop-pilot-004'));x.advance(30000);
 const b=g.decide({...input('coop-pilot-004'),assessment:'WORK'});assert.equal(b.status,'HELD');
 assert.equal(b.intent,a.intent);x.advance(120000);
 const c=g.decide({...input('coop-pilot-004'),assessment:'WORK'});assert.equal(c.status,'PLANNED');
 assert.equal(c.reason,'RAID_NOT_WORTH_RISK');
 }finally{x.cleanup();}});
test('native movement is counted only on verified successfully ordered warp/orbit',()=>{
 const x=f();try{const g=x.create();g.decide(input());
 assert.equal(g.observeNativeOrder({pilotID:'coop-pilot-003',systemID:SID,entityID:501,targetID:303,action:'warp'}).status,'RECORDED');
 assert.equal(x.create().snapshot().pilots['coop-pilot-003'].nativeOrdersObserved,1);
 assert.equal(g.observeNativeOrder({pilotID:'coop-pilot-003',systemID:SID,entityID:501,targetID:303,action:'attack'}).status,'INVALID');
 assert.equal(g.snapshot().pilots['coop-pilot-003'].nativeOrdersObserved,1);
 }finally{x.cleanup();}});
test('corrupt and incompatible state fails closed without resetting stored goals',()=>{
 const x=f();try{fs.writeFileSync(x.file,'{"version":2,"pilots":{}}');
 assert.throws(()=>x.create(),/INVALID_SAVED_NPC_PERSONAL_GOALS/);
 assert.match(fs.readFileSync(x.file,'utf8'),/"version":2/);
 }finally{x.cleanup();}});
test('pilot cap and unknown IDs prevent unbounded state',()=>{
 const x=f();try{const g=createPersonalGoals({file:x.file,maxPilots:1,clock:()=>1000000});
 assert.equal(g.decide(input()).status,'PLANNED');
 assert.equal(g.decide(input('coop-pilot-004')).status,'CAP_REACHED');
 assert.equal(g.decide(input('bad')).status,'INVALID');
 }finally{x.cleanup();}});
