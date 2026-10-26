import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {RANKS,rankForMerit,emptyRecord,meritForEvent,applyEvent,capabilitiesFor}=require('../integration/coopFactionWarMerit.cjs');

test('a new pilot starts at the bottom with a frigate and one ship',()=>{
 const record=emptyRecord({pilotID:140000100});
 assert.equal(record.rank,'recruit');
 assert.equal(record.merit,0);
 const caps=capabilitiesFor(record);
 assert.equal(caps.hullClassID,'frigate');
 assert.equal(caps.command,1);
});

test('merit is paid only for known, evidenced events',()=>{
 assert.equal(meritForEvent('kill-confirmed',3).merit,9);
 assert.equal(meritForEvent('objective-captured').merit,12);
 assert.equal(meritForEvent('force-lost').merit,-10);
 assert.equal(meritForEvent('idle-time').status,'UNKNOWN_EVENT');
 assert.equal(meritForEvent('idle-time').merit,0);
});

test('enough real results promote a pilot and unlock a bigger hull',()=>{
 let record=emptyRecord({pilotID:1});
 record=applyEvent(record,'objective-captured',{nowMs:1000}).record;  // 12
 record=applyEvent(record,'objective-captured',{nowMs:1500}).record;  // 24
 const third=applyEvent(record,'objective-captured',{nowMs:2000});   // 36 -> pilot (25)
 assert.equal(third.status,'PROMOTED');
 assert.equal(third.to,'pilot');
 assert.equal(third.hullClassID,'destroyer');
 assert.equal(third.record.merit,36);
 const fourth=applyEvent(third.record,'objective-captured',{nowMs:2500}); // 48, still pilot
 assert.equal(fourth.status,'UPDATED');
 assert.equal(fourth.record.merit,48);
 assert.equal(fourth.record.history.length,4);
});

test('losing a force costs position, not just points',()=>{
 let record=emptyRecord({pilotID:1});
 for(let i=0;i<3;i++)record=applyEvent(record,'objective-captured').record; // 36 -> pilot
 assert.equal(record.rank,'pilot');
 for(let i=0;i<3;i++)record=applyEvent(record,'force-lost').record;        // 36-30 = 6
 assert.equal(record.rank,'recruit');
 assert.equal(record.merit,6);
});

test('merit never goes negative and an unknown event never changes the record',()=>{
 const record=applyEvent(emptyRecord({pilotID:1}),'force-lost').record;
 assert.equal(record.merit,0);
 const untouched=applyEvent(record,'nonsense');
 assert.equal(untouched.status,'UNKNOWN_EVENT');
 assert.equal(untouched.record.merit,0);
});

test('the rank ladder is monotonic in merit and command',()=>{
 for(let i=1;i<RANKS.length;i++){
  assert.equal(RANKS[i].merit>RANKS[i-1].merit,true);
  assert.equal(RANKS[i].command>=RANKS[i-1].command,true);
 }
 assert.equal(rankForMerit(1199).rank,'front-commander');
 assert.equal(rankForMerit(1200).rank,'admiral');
 assert.equal(rankForMerit(99999).rank,'admiral');
});
