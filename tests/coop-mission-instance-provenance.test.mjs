import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {record,verify,read,identity,nativeSharedObjectiveMatches}=require('../integration/coopMissionInstanceProvenance.cjs');
function fixture(file){
 const ownerID=101,peerID=202,agentID=55;
 const leaderMission={agentID,missionSequence:12,contentID:440,
  missionTemplateID:'ship-dungeon-440',missionSystemID:30000144,
  dungeonInstanceID:99013,runtimeStatus:'accepted',objectiveMode:'dungeon',
  objectiveCompleted:false,gmCompleted:false};
 const peerMission={agentID,missionSequence:17,contentID:440,
  missionTemplateID:'ship-dungeon-440',missionSystemID:30000144,
  dungeonInstanceID:null,runtimeStatus:'offered',objectiveMode:'dungeon',
  objectiveCompleted:false,gmCompleted:false};
 const args={ownerID,peerID,agentID,leaderMission,peerMission,file};
 const write=()=>record(args);
 const check=()=>verify({...args,peerMission:{...peerMission,runtimeStatus:'accepted',
  dungeonInstanceID:99014}});
 return {args,write,check,leaderMission,peerMission};
}
function withFile(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coop19-'));
 try{return fn(path.join(dir,'instance-links.jsonl'),dir)}
 finally{fs.rmSync(dir,{force:true,recursive:true})}}
test('ordinary request writes one durable native offer link; acceptance can be verified',()=>withFile(file=>{
 const f=fixture(file);assert.equal(f.write().status,'NATIVE_INSTANCE_LINK_RECORDED');
 assert.equal(f.check().status,'NATIVE_INSTANCE_LINK_VERIFIED');
 assert.equal(read(file).links.length,1);
}));
test('no implicit Accept: the native offered record cannot be treated as accepted',()=>withFile(file=>{
 const f=fixture(file);f.write();
 assert.equal(verify(f.args).status,'NATIVE_ACCEPTED_INSTANCE_REQUIRED');
}));
test('restart/reconnect: new require and new mission objects preserve explicit link',()=>withFile(file=>{
 const f=fixture(file);f.write();
 const mod=require('../integration/coopMissionInstanceProvenance.cjs');
 assert.equal(mod.verify({...f.args,leaderMission:{...f.leaderMission},
  peerMission:{...f.peerMission,runtimeStatus:'accepted',dungeonInstanceID:998}}).ok,true);
}));
test('independent same-title accepted dungeon does not inherit someone else\'s link',()=>withFile(file=>{
 const f=fixture(file);f.write();
 f.peerMission.missionSequence=18;
 assert.equal(f.check().status,'NATIVE_INSTANCE_LINK_NOT_PROVED');
}));
test('different leader native instance or sequence never shares objective credit',()=>withFile(file=>{
 for(const key of ['dungeonInstanceID','missionSequence']){
  const f=fixture(file);if(!fs.existsSync(file))f.write();
  f.leaderMission[key]++;
  assert.equal(f.check().status,'NATIVE_INSTANCE_LINK_NOT_PROVED');
 }
}));
test('wrong agent, content, template, system, character cannot read link',()=>withFile(file=>{
 for(const mutate of [
  f=>f.args.agentID++, f=>f.peerMission.contentID++,f=>f.peerMission.missionTemplateID+='fake',
  f=>f.peerMission.missionSystemID++,f=>f.args.peerID++,f=>f.args.ownerID++
 ]){
  const f=fixture(file);if(!fs.existsSync(file))f.write();mutate(f);
  assert.equal(f.check().ok,false);
 }
}));
test('native GM completion or non-dungeon objective is excluded',()=>withFile(file=>{
 for(const update of [{gmCompleted:true},{objectiveMode:'transport'}]){
  const f=fixture(file);Object.assign(f.leaderMission,update);
  assert.equal(f.write().status,'NATIVE_INSTANCE_LINK_INVALID');
 }
}));
test('duplicate same immutable receipt is idempotent, never a second append',()=>withFile(file=>{
 const f=fixture(file);f.write();
 const before=fs.readFileSync(file,'utf8');
 assert.equal(f.write().status,'NATIVE_INSTANCE_LINK_ALREADY_RECORDED');
 assert.equal(fs.readFileSync(file,'utf8'),before);
}));
test('same leader sequence/instance cannot claim a different wingman reward',()=>withFile(file=>{
 const f=fixture(file);f.write();f.args.peerID=203;f.peerMission.missionSequence=18;
 assert.equal(f.write().status,'NATIVE_INSTANCE_LINK_CONFLICT');
}));
test('same peer mission sequence cannot be claimed by a different leader',()=>withFile(file=>{
 const f=fixture(file);f.write();f.args.ownerID=105;f.leaderMission.dungeonInstanceID=100000;
 assert.equal(f.write().status,'NATIVE_INSTANCE_LINK_CONFLICT');
}));
test('tampered, torn or conflicting durable ledger blocks native objective credit',()=>withFile(file=>{
 const f=fixture(file);f.write();
 const original=fs.readFileSync(file,'utf8');
 for(const content of [original.slice(0,-1),'{malformed}\n',
  original+JSON.stringify({...JSON.parse(original),ownerID:303})+'\n']){
  fs.writeFileSync(file,content);
  assert.equal(f.check().ok,false);
 }
}));
test('an unavailable journal blocks granting; does not fall back to title',()=>withFile((file,dir)=>{
 const f=fixture(dir);assert.equal(f.write().status,'LINK_LEDGER_UNAVAILABLE');
 assert.equal(f.check().ok,false);
}));
test('missing native receipt after crash between offer and fsync cannot credit later accepted mission',()=>withFile(file=>{
 assert.equal(fixture(file).check().status,'NATIVE_INSTANCE_LINK_NOT_PROVED');
}));
test('explicit sourceInstanceID check prevents replay into another live dungeon',()=>withFile(file=>{
 const f=fixture(file);f.write();
 assert.equal(verify({...f.args,peerMission:{...f.peerMission,runtimeStatus:'accepted'},
  sourceInstanceID:99015}).status,'NATIVE_INSTANCE_LINK_MISMATCH');
 assert.equal(verify({...f.args,peerMission:{...f.peerMission,runtimeStatus:'accepted'},
  sourceInstanceID:0}).ok,false);
}));
test('mission reoffer with a new sequence requires a new explicit link',()=>withFile(file=>{
 const f=fixture(file);f.write();f.peerMission.missionSequence=22;
 assert.equal(f.check().ok,false);
 assert.equal(f.write().status,'NATIVE_INSTANCE_LINK_CONFLICT');
}));
test('bad identity with multiple registered agents or missing native IDs cannot mint consent',()=>withFile(file=>{
 const f=fixture(file);f.peerMission.agentID=56;
 assert.equal(f.write().status,'NATIVE_INSTANCE_LINK_INVALID');
 assert.equal(identity({...f.args,peerID:null}),null);
}));
test('fail closed when fsync fails after a write: test using inaccessible path',()=>withFile((_file,dir)=>{
 const f=fixture(path.join(dir,'no', 'inside'));
 fs.mkdirSync(path.join(dir,'no','inside'),{recursive:true});
 assert.equal(f.write().status,'LINK_LEDGER_UNAVAILABLE');
}));

test('native co-op objective receipt must refer to leader physical instance and owner',()=>withFile(file=>{
 const f=fixture(file);f.write();
 const peer={...f.peerMission,runtimeStatus:'accepted',objectiveCompleted:true,
  coopSharedDungeon:{ownerID:101,agentID:55,sourceInstanceID:99013,
   contentID:440,missionTemplateID:'ship-dungeon-440'}};
 const args={ownerID:101,agentID:55,leaderMission:f.leaderMission,peerMission:peer};
 assert.equal(nativeSharedObjectiveMatches(args),true);
 for(const bad of [{ownerID:999},{agentID:66},{sourceInstanceID:99014},
  {contentID:441},{missionTemplateID:'other'}]){
  assert.equal(nativeSharedObjectiveMatches({...args,peerMission:{...peer,
   coopSharedDungeon:{...peer.coopSharedDungeon,...bad}}}),false);
 }
 assert.equal(nativeSharedObjectiveMatches({...args,peerMission:{...peer,objectiveCompleted:false}}),false);
}));
