import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {auditPilot,auditTwoPilots}=require('../integration/coopSkillEtaEvidence.cjs');
const MIN=600000000n;
function pilot(characterID=11,accountID=111,omega=true,rate=48){
 const from=1000,to=4000,per=(20+20/2)*rate*(omega?1:0.5);
 const start=134060000000000000n,end=start+BigInt(Math.floor((to-from)/per*Number(MIN)));
 return {characterID,accountID,globalRate:rate,omega,primary:20,secondary:20,
  queueSnapshot:{characterID,active:true,currentEntry:{trainingStartTime:String(start),
    trainingEndTime:String(end),trainingStartSP:from,trainingDestinationSP:to,
    skillPointsPerMinute:per}},observedClientEndTime:String(end),
  observedClientCloneGrade:omega?'omega':'alpha'};
}
test('native 48x Omega rate matches UI ETA and exact FILETIME duration',()=>{
 assert.equal(auditPilot(pilot()).status,'NATIVE_AND_CLIENT_ETA_ALIGNED');
});
test('native Alpha 0.5x is distinct from Omega and accepts matching client grade',()=>{
 const a=pilot(21,221,false);assert.equal(auditPilot(a).status,'NATIVE_AND_CLIENT_ETA_ALIGNED');
 assert.equal(a.queueSnapshot.currentEntry.skillPointsPerMinute,720);
});
test('native 100x rate remains testable without forcing config down to 48x',()=>{
 assert.equal(auditPilot(pilot(1,2,true,100)).status,'NATIVE_AND_CLIENT_ETA_ALIGNED');
});
test('a duplicate character or account is not proof of two independent players',()=>{
 assert.equal(auditTwoPilots([pilot(),pilot()]).status,'TWO_INDEPENDENT_CHARACTERS_NOT_PROVED');
 assert.equal(auditTwoPilots([pilot(1,1),pilot(2,1)]).status,'TWO_INDEPENDENT_CHARACTERS_NOT_PROVED');
});
test('two independent client/character snapshots align only with real observed client ETAs',()=>{
 const a=pilot(11,111),b=pilot(22,222);
 assert.equal(auditTwoPilots([a,b]).status,'TWO_NATIVE_AND_CLIENT_ETAS_ALIGNED');
 b.observedClientEndTime=null;
 assert.equal(auditTwoPilots([a,b]).status,'TWO_PILOT_EVIDENCE_INCOMPLETE');
});
test('client observation is not inferred from server-only time',()=>{
 const a=pilot();delete a.observedClientEndTime;
 assert.equal(auditPilot(a).status,'CLIENT_ETA_NOT_OBSERVED');
});
test('wrong server rate, wrong clone and client ETA drift are explicit failures',()=>{
 const a=pilot();a.queueSnapshot.currentEntry.skillPointsPerMinute=30;
 assert.equal(auditPilot(a).status,'SERVER_SP_RATE_MISMATCH');
 const b=pilot();b.observedClientCloneGrade='alpha';
 assert.equal(auditPilot(b).status,'CLIENT_CLONE_GRADE_MISMATCH');
 const c=pilot();c.observedClientEndTime=String(BigInt(c.observedClientEndTime)+120n*MIN);
 assert.equal(auditPilot(c).status,'CLIENT_ETA_MISMATCH');
});
test('unrelated character snapshot and fabricated native end time never pass',()=>{
 const a=pilot();a.queueSnapshot.characterID=99;
 assert.equal(auditPilot(a).status,'NATIVE_QUEUE_NOT_ACTIVE');
 const b=pilot();b.queueSnapshot.currentEntry.trainingEndTime=String(BigInt(b.queueSnapshot.currentEntry.trainingEndTime)+MIN);
 assert.equal(auditPilot(b).status,'SERVER_QUEUE_ETA_MISMATCH');
});
