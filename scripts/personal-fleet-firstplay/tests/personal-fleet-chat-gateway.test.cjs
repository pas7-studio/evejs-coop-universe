'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetChatGateway.js'),'utf8');
function fixture(work){
 const old=['EVEJS_COOP_PERSONAL_FLEET_CHAT','EVEJS_COOP_PERSONAL_FLEET_NATIVE','EVEJS_COOP_NATIVE_ATOMIC_ROWS'].map(x=>[x,process.env[x]]);
 for(const [key] of old)process.env[key]='1';
 let now={characterID:90000001,accountId:55,shipID:2002},calls=[],pending=0,poisoned=false;
 const session={characterID:90000001,userid:55,charID:90000001,socket:{destroyed:false},_space:{shipID:2002,systemID:30000142}};
 let sessions=[session];
 const registry={getSessions:()=>sessions,findSessionByCharacterID:()=>sessions[0]||null};
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poisoned,transact:(tables,action)=>{
  assert.deepEqual(Array.from(tables),['characters']);return action({get:()=>structuredClone(now)});
 }};
 const sandbox={module:{exports:{}},exports:{},require:name=>{
  if(name==='../services/chat/sessionRegistry')return registry;
  if(name==='../gameStore')return {coopAtomicNativeRows:atomic};
  throw Error('UNEXPECTED_MODULE '+name);
 },process,console,Object,Array,String,Number,Boolean,RegExp};
 vm.runInNewContext(source,sandbox,{filename:'coopPersonalFleetChatGateway.js'});
 const api=sandbox.module.exports;
 const provider={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_OWNER_V1',enabled:()=>true};
 for(const name of ['offers','status','roster','hire','assign','deploy','follow','hold','attack','guard','returnToBase','salary','dismiss'])
   provider[name]=ctx=>{pending++;calls.push({name,ctx});return {status:'ACKED',shipItemID:2001};};
 const run=(command,who=session)=>api.handleChat({session:who,argumentText:command});
 try{work({api,provider,run,session,calls,readCalls:()=>pending,
  setSessions:v=>{sessions=v;},setAccount:v=>{now.accountId=v;},setPoisoned:v=>{poisoned=v;}});}
 finally{for(const [k,v] of old){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('default chat ingress refuses before server owner install',()=>fixture(f=>{
 assert.match(f.run('status').message,/NATIVE_AUTHORITY_NOT_INSTALLED/);
 assert.equal(f.readCalls(),0);
}));
test('valid owner installation invokes exact native authority once',()=>fixture(f=>{
 assert.equal(f.api.installServerAuthority(f.provider),true);
 assert.match(f.run('status').message,/ACKED shipItemID=2001/);
 assert.equal(f.readCalls(),1);
 assert.equal(f.calls[0].ctx.session,f.session);
 assert.equal(f.calls[0].ctx.ownerCharacterID,90000001);
 assert.equal(f.calls[0].ctx.accountID,55);
}));
test('cannot replace installed native provider',()=>fixture(f=>{
 assert.equal(f.api.installServerAuthority(f.provider),true);
 assert.equal(f.api.installServerAuthority(f.provider),false);
}));
test('missing native methods are not installable',()=>fixture(f=>{
 const copy={...f.provider};delete copy.hire;
 assert.equal(f.api.installServerAuthority(copy),false);
 assert.match(f.run('status').message,/NOT_INSTALLED/);
}));
test('incorrect authority provenance is rejected',()=>fixture(f=>{
 assert.equal(f.api.installServerAuthority({...f.provider,source:'UNTRUSTED'}),false);
}));
test('disabled chat feature is inert',()=>fixture(f=>{
 f.api.installServerAuthority(f.provider);
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE;
 assert.match(f.run('status').message,/DISABLED/);
 assert.equal(f.readCalls(),0);
}));
test('disconnected socket refuses',()=>fixture(f=>{
 f.api.installServerAuthority(f.provider);f.session.socket.destroyed=true;
 assert.match(f.run('status').message,/SESSION_UNVERIFIED/);
}));
test('session-shaped forged argument refuses',()=>fixture(f=>{
 f.api.installServerAuthority(f.provider);
 assert.match(f.run('status',{...f.session}).message,/SESSION_UNVERIFIED/);
}));
test('duplicate login refuses',()=>fixture(f=>{
 f.api.installServerAuthority(f.provider);f.setSessions([f.session,{...f.session}]);
 assert.match(f.run('status').message,/SESSION_UNVERIFIED/);
}));
test('mismatching live account refuses',()=>fixture(f=>{
 f.api.installServerAuthority(f.provider);f.setAccount(56);
 assert.match(f.run('status').message,/SESSION_UNVERIFIED/);
}));
test('atomic poison refuses',()=>fixture(f=>{
 f.api.installServerAuthority(f.provider);f.setPoisoned(true);
 assert.match(f.run('status').message,/SESSION_UNVERIFIED/);
}));
test('invalid active character alias refuses',()=>fixture(f=>{
 f.api.installServerAuthority(f.provider);f.session.charID=90000002;
 assert.match(f.run('status').message,/SESSION_UNVERIFIED/);
}));
test('server owner disabled refuses',()=>fixture(f=>{
 f.provider.enabled=()=>false;f.api.installServerAuthority(f.provider);
 assert.match(f.run('hire offer-7 accept-recurring').message,/NATIVE_AUTHORITY_NOT_INSTALLED/);
}));
for(const [command,name] of [['offers','offers'],['roster','roster'],['hire quote:1 accept-recurring','hire'],
 ['assign coop-pilot-123 2001','assign'],['deploy assignment-1','deploy'],
 ['follow 2001','follow'],['hold 2001','hold'],['attack 2001 2999','attack'],['guard 2001','guard'],['return 2001','returnToBase'],['dismiss coop-pilot-123','dismiss']]){
 test('routes authorized /pf '+command,()=>fixture(f=>{
  f.api.installServerAuthority(f.provider);
  assert.match(f.run(command).message,/ACKED/);
  assert.equal(f.calls[0].name,name);
  if(command.startsWith('assign'))assert.equal(f.calls[0].ctx.args[1],2001);
 }));
}
for(const command of ['assign 2001 coop-pilot-123','assign coop-pilot-123 0001','follow 0',
 'follow 9007199254740993','hold -5','return 2001 garbage','hire','hire evil token','hire quote:1',
 'deploy ../../etc/passwd','dismiss 2001','what','hi\nstatus','status\u0000']){
 test('rejects invalid /pf command '+JSON.stringify(command),()=>fixture(f=>{
  f.api.installServerAuthority(f.provider);
  assert.match(f.run(command).message,/INVALID_COMMAND/);assert.equal(f.readCalls(),0);
 }));
}
test('throws in native action cannot be mistaken for successful command',()=>fixture(f=>{
 f.provider.follow=()=>{throw Error('BOOM');};f.api.installServerAuthority(f.provider);
 assert.match(f.run('follow 2001').message,/OUTCOME_UNKNOWN_NO_RETRY/);
}));
test('async native action is blocked instead of claiming success',()=>fixture(f=>{
 f.provider.follow=()=>Promise.resolve({status:'ACKED'});f.api.installServerAuthority(f.provider);
 assert.match(f.run('follow 2001').message,/ASYNC_NATIVE_OUTCOME_UNKNOWN_NO_RETRY/);
}));
test('native output never leaks line breaks or arbitrary objects',()=>fixture(f=>{
 f.provider.offers=()=>({status:'READY\nattack',reason:'failure\nwrite',secrets:{token:'secret'},message:'good\rbye'});
 f.api.installServerAuthority(f.provider);
 const m=f.run('offers').message;
 assert.ok(!m.includes('\n')&&!m.includes('\r')&&!m.includes('secret'));
}));
test('missing native receipt is reported as unknown, not success',()=>fixture(f=>{
 f.provider.hold=()=>null;f.api.installServerAuthority(f.provider);
 assert.match(f.run('hold 2001').message,/outcome unavailable/);
}));
test('help is documented even before provider installation',()=>fixture(f=>{
 assert.match(f.run('help').message,/hire .*assign .*deploy .*follow .*hold .*attack .*guard .*return/);
}));
test('PF91 salary chat requires one canonical named NPC pilot ID',()=>fixture(f=>{
 assert.equal(f.api.installServerAuthority(f.provider),true);
 assert.match(f.run('salary coop-pilot-123').message,/ACKED/);
 assert.equal(f.calls.at(-1).name,'salary');
 assert.equal(f.readCalls(),1);
 assert.match(f.run('salary 123').message,/INVALID_COMMAND/);
 assert.match(f.run('salary coop-pilot-123 9900').message,/INVALID_COMMAND/);
 assert.equal(f.readCalls(),1);
}));
test('PF92 explicit recurring salary acceptance is mandatory at ingress',()=>fixture(f=>{
 assert.equal(f.api.installServerAuthority(f.provider),true);
 assert.match(f.run('hire quote:1').message,/INVALID_COMMAND/);
 assert.match(f.run('hire quote:1 acknowledge').message,/INVALID_COMMAND/);
 assert.equal(f.readCalls(),0);
 assert.match(f.run('hire quote:1 accept-recurring').message,/ACKED/);
 assert.equal(f.calls.at(-1).name,'hire');
}));
test('PF95 attack forbids malformed or same-ship targets at ingress',()=>fixture(f=>{
 assert.equal(f.api.installServerAuthority(f.provider),true);
 for(const command of ['attack 2001','attack 2001 2001','attack 2001 abc','guard abc',
  'guard 2001 2999']){
  assert.match(f.run(command).message,/INVALID_COMMAND/);
 }
 assert.equal(f.readCalls(),0);
}));
