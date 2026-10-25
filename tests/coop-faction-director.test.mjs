import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {createFactionDirector}=require('../integration/coopFactionDirector.cjs');
test('faction loss generates demand and patrol priority, survives restart and dedupes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-faction-'));
 try {
  let now=1000; const file=join(dir,'factions.json');
  const make=()=>createFactionDirector({file,clock:()=>now,buildMinutes:1});
  let d=make();
  assert.equal(d.onLoss({eventID:'wreck:9001',faction:'frontier',systemID:30000142}).status,'RECORDED');
  assert.equal(make().onLoss({eventID:'wreck:9001',faction:'frontier',systemID:30000142}).status,'DUPLICATE');
  const initial=make().snapshot().factions['frontier@30000142'];
  assert.equal(initial.replacementDemand,1);
  assert.equal(initial.patrolPriority,20);
  assert.equal(initial.threat,15);
  now+=60000;d=make();
  const result=d.advance({'30000142':{goods:20}});
  assert.equal(result.completed,1);
  assert.equal(d.snapshot().factions['frontier@30000142'].replacementDemand,0);
  assert.equal(d.snapshot().factions['frontier@30000142'].shipsRebuilt,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('no goods do not fulfil faction replacements',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-faction-'));
 try{
  let now=1000;const d=createFactionDirector({file:join(dir,'s.json'),clock:()=>now});
  d.onLoss({eventID:'wreck:10',faction:'independent',systemID:30000142});
  now+=1800000;
  assert.equal(d.advance({'30000142':{goods:0}}).completed,0);
  assert.equal(d.snapshot().factions['independent@30000142'].replacementDemand,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('faction chronicle stores confirmed losses and real attack orders across restarts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-chronicle-'));
 try{
  const file=join(dir,'s.json'),make=()=>createFactionDirector({file,clock:()=>123456});
  const d=make();
  const engagement=i=>({
   eventID:'native-order:30000142:201:990:'+i,
   aggressorFaction:'frontier',defenderFaction:'independent',systemID:30000142,
   attackerPilotID:'coop-pilot-002',defenderPilotID:'coop-pilot-005'
  });
  for(let i=0;i<3;i++)assert.equal(d.onEngagement(engagement(i)).status,'RECORDED');
  assert.equal(d.onEngagement(engagement(0)).status,'DUPLICATE');
  assert.equal(d.snapshot().rivalries['frontier|independent@30000142'].phase,'ESCALATING');
  d.onLoss({eventID:'wreck:171',faction:'independent',systemID:30000142});
  const restored=make();
  assert.equal(restored.recentForSystem(30000142).length,4);
  assert.equal(restored.recentForSystem(30000142)[0].kind,'CONFIRMED_NPC_LOSS');
  assert.equal(restored.snapshot().factions['independent@30000142'].replacementDemand,1);
  assert.equal(restored.onEngagement({...engagement(4),defenderFaction:'frontier'}).status,'INVALID');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CHAT18 durable loss rolls back uncommitted RAM on filesystem failure',()=>{
 const fs=require('node:fs'),dir=mkdtempSync(join(tmpdir(),'coop-faction-chat18-'));
 try{
  const file=join(dir,'f.json'),director=createFactionDirector({file,clock:()=>1000});
  const loss={eventID:'wreck:190',faction:'frontier',systemID:30000142};
  assert.equal(director.onLoss(loss).status,'RECORDED');
  const before=director.snapshot();
  const old=fs.fsyncSync;
  fs.fsyncSync=()=>{throw Error('CHAT18_INJECTED_FSYNC')};
  try{assert.throws(()=>director.onLoss({...loss,eventID:'wreck:191'}),/CHAT18_INJECTED_FSYNC/);}
  finally{fs.fsyncSync=old}
  assert.deepEqual(director.snapshot(),before);
  assert.equal(director.onLoss({...loss,eventID:'wreck:191'}).status,'RECORDED');
  const restored=createFactionDirector({file,clock:()=>1000});
  assert.equal(restored.snapshot().factions['frontier@30000142'].losses,2);
  assert.equal(restored.onLoss({...loss,eventID:'wreck:191'}).status,'DUPLICATE');
  assert.equal(restored.onLoss({...loss,eventID:'wreck:191',faction:'independent'}).status,'CONFLICT');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CHAT18 faction identity rejects contradictory native engagement replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-faction-chat18-'));
 try{
  const file=join(dir,'f.json'),create=()=>createFactionDirector({file,clock:()=>1000});
  const order={eventID:'native-order:30000142:1:2:3',aggressorFaction:'frontier',
   defenderFaction:'independent',attackerPilotID:'coop-pilot-001',
   defenderPilotID:'coop-pilot-002',systemID:30000142};
  assert.equal(create().onEngagement(order).status,'RECORDED');
  assert.equal(create().onEngagement(order).status,'DUPLICATE');
  assert.equal(create().onEngagement({...order,attackerPilotID:'coop-pilot-009'}).status,'CONFLICT');
  assert.equal(create().onEngagement({...order,defenderFaction:'frontier'}).status,'INVALID');
  assert.equal(create().onLoss({eventID:order.eventID,faction:'frontier',systemID:30000142}).status,'CONFLICT');
  assert.equal(create().snapshot().rivalries['frontier|independent@30000142'].engagementOrders,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CHAT18 faction advance does not acknowledge phantom virtual production after failed fsync',()=>{
 const fs=require('node:fs'),dir=mkdtempSync(join(tmpdir(),'coop-faction-chat18-'));
 try{
  const file=join(dir,'f.json');let now=1000;
  const create=()=>createFactionDirector({file,clock:()=>now,buildMinutes:1});
  const d=create();
  d.onLoss({eventID:'wreck:180',faction:'frontier',systemID:30000142});
  now+=60000;
  const before=d.snapshot(),old=fs.fsyncSync;
  fs.fsyncSync=()=>{throw Error('CHAT18_FSYNC_ADVANCE')};
  try{assert.throws(()=>d.advance({'30000142':{goods:100}}),/CHAT18_FSYNC_ADVANCE/)}
  finally{fs.fsyncSync=old}
  assert.deepEqual(d.snapshot(),before);
  assert.equal(d.advance({'30000142':{goods:100}}).completed,1);
  assert.equal(create().snapshot().factions['frontier@30000142'].shipsRebuilt,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
