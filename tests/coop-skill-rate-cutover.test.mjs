import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {RATES,prepare,readJournal,executeCutover,verifyCutover}=require('../integration/coopSkillRateCutover.cjs');
const T=134060000000000000n;
function withDir(callback){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coop-skill-cutover-'));try{return callback(path.join(dir,'cutover.jsonl'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function simulated(options={}){
 const n={rate:options.rate??100,now:T,queue:new Map(),skills:new Map(),calls:[],fault:options.fault};
 const ids=options.ids??[101,202];
 for(const id of ids){n.queue.set(id,{active:true,queue:[{typeID:3300+id,toLevel:5},{typeID:4400+id,toLevel:3}],activeStartTime:String(T-36000000000n)});n.skills.set(id,[{typeID:3300+id,trainedSkillPoints:1000,skillPoints:1000}]);}
 n.api={
  getTrainingMultiplier:()=>n.rate,getNowFileTime:()=>n.now,
  getAllQueueStates:()=>Object.fromEntries([...n.queue].map(([id,q])=>[id,structuredClone(q)])),
  getCharacterQueueState:id=>structuredClone(n.queue.get(id)),
  getCharacterBaseSkills:id=>structuredClone(n.skills.get(id)),
  rebaseActiveTrainingProgress:id=>{
   n.calls.push(id);if(n.fault==='throw')throw Error('native write lost ACK');
   if(n.fault==='failed')return {success:false};
   const old=n.queue.get(id),sk=n.skills.get(id)[0];
   sk.trainedSkillPoints+=n.rate===100?180:86;
   sk.skillPoints=sk.trainedSkillPoints;
   if(n.fault!=='stale')old.activeStartTime=String(n.now);
   if(n.fault==='sp-loss')sk.trainedSkillPoints=0;
   return {success:true,active:true};
  }
 };
 return n;
}
const run=(n,file,opts={})=>executeCutover({oldRate:100,newRate:48,
 expectedCharacterIDs:[101,202],journalFile:file,native:n.api,
 systemQuiesced:true,backupVerified:true,operatorApproved:true,...opts});

test('does not change configured global training multiplier or mint SP itself',()=>withDir(file=>{
 const n=simulated();const r=run(n,file);
 assert.equal(r.status,'READY_FOR_SWITCH');assert.equal(n.rate,100);assert.deepEqual(n.calls,[101,202]);
 assert.equal(n.skills.get(101)[0].trainedSkillPoints,1180);
 assert.equal(n.skills.get(202)[0].trainedSkillPoints,1180);
 assert.equal(n.queue.get(101).activeStartTime,String(T));
 assert.equal(verifyCutover({journalFile:file,oldRate:100,newRate:48,expectedCharacterIDs:[202,101]}).status,'READY_FOR_SWITCH');
 assert.deepEqual(readJournal(file).entries.map(x=>x.state),['PREPARED','CHAR_PREPARED','CHAR_REBASED','CHAR_PREPARED','CHAR_REBASED','READY_FOR_SWITCH']);
}));
test('no second SP grant after same migration is requested again',()=>withDir(file=>{
 const n=simulated();assert.equal(run(n,file).status,'READY_FOR_SWITCH');
 assert.equal(run(n,file).status,'READY_FOR_SWITCH');assert.deepEqual(n.calls,[101,202]);
}));
test('normal 48x user-selected rate and current 100x world are both supported',()=>{
 assert.deepEqual(RATES,[1,6,12,24,48,100]);
 const n=simulated();assert.equal(prepare({oldRate:100,newRate:48,expectedCharacterIDs:[101,202],queueTable:n.api.getAllQueueStates()}).manifest.activeCharacters.length,2);
 assert.equal(prepare({oldRate:48,newRate:100,expectedCharacterIDs:[101,202],queueTable:n.api.getAllQueueStates()}).manifest.newRate,100);
});
test('explicit shutdown, verified backup and operator approval are all mandatory',()=>withDir(file=>{
 const n=simulated();for(const opt of [{systemQuiesced:false},{backupVerified:false},{operatorApproved:false}])
 assert.equal(run(n,file,opt).status,'QUIESCE_BACKUP_APPROVAL_REQUIRED');
 assert.equal(fs.existsSync(file),false);assert.equal(n.calls.length,0);
}));
test('fail before write if old runtime multiplier was already changed',()=>withDir(file=>{
 const n=simulated({rate:48});assert.equal(run(n,file).status,'OLD_RATE_NOT_RUNNING');
 assert.equal(n.calls.length,0);assert.equal(fs.existsSync(file),false);
}));
test('reject any active character absent from the explicitly approved roster',()=>withDir(file=>{
 const n=simulated({ids:[101,202,303]});
 assert.equal(run(n,file).status,'NEEDS_OPERATOR_REPAIR');assert.equal(n.calls.length,0);
 assert.equal(fs.existsSync(file),false);
}));
test('inactive characters do not gain free SP, while active ones are rebased',()=>withDir(file=>{
 const n=simulated();n.queue.get(202).active=false;n.queue.get(202).activeStartTime=null;
 const r=run(n,file);assert.equal(r.status,'READY_FOR_SWITCH');assert.deepEqual(n.calls,[101]);
 assert.equal(n.skills.get(202)[0].trainedSkillPoints,1000);
}));
test('two independent character queues retain their own order and start time',()=>withDir(file=>{
 const n=simulated();const before=n.queue.get(202).queue;
 assert.equal(run(n,file).status,'READY_FOR_SWITCH');
 assert.deepEqual(n.queue.get(202).queue,before);assert.notEqual(n.queue.get(202),n.queue.get(101));
}));
test('crash after precommit becomes permanent manual-repair block rather than double SP',()=>withDir(file=>{
 const n=simulated({fault:'throw'});const one=run(n,file);
 assert.equal(one.status,'NEEDS_OPERATOR_REPAIR');const count=n.calls.length;
 assert.equal(readJournal(file).status,'REQUIRES_MANUAL_RECONCILIATION');
 assert.equal(run(n,file).status,'REQUIRES_MANUAL_RECONCILIATION');assert.equal(n.calls.length,count);
}));
test('native false result is ambiguous and never retried',()=>withDir(file=>{
 const n=simulated({fault:'failed'});assert.equal(run(n,file).status,'NATIVE_REBASE_UNCERTAIN');
 assert.equal(run(n,file).status,'REQUIRES_MANUAL_RECONCILIATION');assert.deepEqual(n.calls,[101]);
}));
test('native method reporting success without moving activeStartTime is rejected',()=>withDir(file=>{
 const n=simulated({fault:'stale'});
 assert.equal(run(n,file).status,'ACTIVE_START_REBASE_NOT_PROVED');
 assert.deepEqual(n.calls,[101]);
}));
test('decreasing native recorded SP is an operator-repair-only failure',()=>withDir(file=>{
 const n=simulated({fault:'sp-loss'});assert.equal(run(n,file).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(run(n,file).status,'REQUIRES_MANUAL_RECONCILIATION');
}));
test('bad journal JSON and partial trailing write fail closed after restart',()=>withDir(file=>{
 const n=simulated();fs.writeFileSync(file,'{"state":"PREPARED"');
 assert.equal(readJournal(file).status,'JOURNAL_CORRUPT');assert.equal(run(n,file).status,'JOURNAL_CORRUPT');
 assert.equal(n.calls.length,0);
}));
test('valid journal cannot be repurposed to migrate another speed/roster',()=>withDir(file=>{
 const n=simulated();assert.equal(run(n,file).status,'READY_FOR_SWITCH');
 assert.equal(verifyCutover({journalFile:file,oldRate:6,newRate:48,expectedCharacterIDs:[101,202]}).status,'RATE_CUTOVER_MANIFEST_MISMATCH');
 assert.equal(verifyCutover({journalFile:file,oldRate:100,newRate:48,expectedCharacterIDs:[101]}).status,'RATE_CUTOVER_MANIFEST_MISMATCH');
}));
test('refuse an existing in-progress lock without mutating any skill',()=>withDir(file=>{
 const n=simulated();fs.writeFileSync(file+'.lock','owner?');
 assert.equal(run(n,file).status,'RATE_CUTOVER_LOCKED');assert.equal(n.calls.length,0);
}));
test('wrong API set and invalid journal path fail closed',()=>{
 assert.equal(executeCutover({oldRate:100,newRate:48,expectedCharacterIDs:[101,202],journalFile:'relative',native:simulated().api,systemQuiesced:true,backupVerified:true,operatorApproved:true}).status,'INVALID_JOURNAL_PATH');
 assert.equal(executeCutover({oldRate:100,newRate:48,expectedCharacterIDs:[101,202],journalFile:'/tmp/nonexistent',native:{},systemQuiesced:true,backupVerified:true,operatorApproved:true}).status,'NEEDS_OPERATOR_REPAIR');
});
test('same speed, bogus characters and missing active timestamps rejected',()=>{
 const n=simulated();
 assert.throws(()=>prepare({oldRate:48,newRate:48,expectedCharacterIDs:[101,202],queueTable:n.api.getAllQueueStates()}),/INVALID_RATE_CHANGE/);
 assert.throws(()=>prepare({oldRate:100,newRate:48,expectedCharacterIDs:[101,101],queueTable:n.api.getAllQueueStates()}),/INVALID_CHARACTER_ROSTER/);
 n.queue.get(101).activeStartTime=null;
 assert.throws(()=>prepare({oldRate:100,newRate:48,expectedCharacterIDs:[101,202],queueTable:n.api.getAllQueueStates()}),/ACTIVE_START_TIME_UNTRUSTED/);
});
test('detects concurrent native queue mutation between manifest and native rebase',()=>withDir(file=>{
 const n=simulated();let calls=0;
 const original=n.api.getCharacterQueueState;
 n.api.getCharacterQueueState=id=>{
  const value=original(id);
  if(id===101&&calls++===0)value.queue[0].toLevel=4;
  return value;
 };
 assert.equal(run(n,file).status,'NATIVE_QUEUE_CHANGED_BEFORE_REBASE');
 assert.deepEqual(n.calls,[]);
 assert.equal(run(n,file).status,'REQUIRES_MANUAL_RECONCILIATION');
}));
test('when 2nd native rebase fails after 1st, no migration is marked ready and neither retried',()=>withDir(file=>{
 const n=simulated();let count=0;
 const original=n.api.rebaseActiveTrainingProgress;
 n.api.rebaseActiveTrainingProgress=id=>{
  if(++count===2)throw Error('failed second native write');
  return original(id);
 };
 assert.equal(run(n,file).status,'NEEDS_OPERATOR_REPAIR');
 const states=readJournal(file);
 assert.equal(states.status,'REQUIRES_MANUAL_RECONCILIATION');
 assert.deepEqual(states.entries.map(x=>x.state),['PREPARED','CHAR_PREPARED','CHAR_REBASED','CHAR_PREPARED']);
 assert.equal(run(n,file).status,'REQUIRES_MANUAL_RECONCILIATION');
 assert.equal(count,2);
}));
test('old-rate rebase may remove completed prefix, but must preserve remaining order',()=>withDir(file=>{
 const n=simulated();const original=n.api.rebaseActiveTrainingProgress;
 n.api.rebaseActiveTrainingProgress=id=>{
  const result=original(id);n.queue.get(id).queue.shift();return result;
 };
 assert.equal(run(n,file).status,'READY_FOR_SWITCH');
 assert.equal(n.queue.get(101).queue.length,1);
}));
test('native queue reorder after rebase is an explicit repair fault, never READY',()=>withDir(file=>{
 const n=simulated();const original=n.api.rebaseActiveTrainingProgress;
 n.api.rebaseActiveTrainingProgress=id=>{
  const result=original(id);n.queue.get(id).queue.reverse();return result;
 };
 assert.equal(run(n,file).status,'NATIVE_QUEUE_SEQUENCE_CHANGED');
 assert.equal(run(n,file).status,'REQUIRES_MANUAL_RECONCILIATION');
}));
