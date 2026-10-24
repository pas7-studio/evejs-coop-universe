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
