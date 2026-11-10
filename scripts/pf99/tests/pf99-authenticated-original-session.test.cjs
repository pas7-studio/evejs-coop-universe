'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const native=path.resolve(__dirname,'../native/coopPersonalFleetOriginalSessionWitness.js');
const originalPins=Object.freeze({
 'Code/server/src/services/chat/sessionRegistry.js':'01892cb8f6e35ef46268eae5f2909fd96c4a2a51',
 'Code/server/src/services/structure/structureLocation.js':'0e12ae00721359d526c4453529c81a16f337df22',
 'Code/server/src/services/character/charService.js':'c1159a66622370cd1fd3f5963cddd5de7fe6a52e'
});
const clone=x=>structuredClone(x);
function fromSource(source,requirePath,env=process.env){
 const module={exports:{}};
 new Function('require','module','exports','process','setImmediate',source)(
  requirePath,module,module.exports,{env},setImmediate);
 return module.exports;
}
function fresh({originalRegistry=null,originalDocking=null}={}){
 const sessions=new Set();
 const registry=originalRegistry||{
  getSessions:()=>[...sessions].filter(s=>s.socket&&!s.socket.destroyed),
  findSessionByCharacterID:cid=>[...sessions].find(s=>s.characterID===cid&&
   s.socket&&!s.socket.destroyed)||null
 };
 const loc=source=>Number(source?.structureid??source?.structureID??source?.structureId??0)||0;
 const stat=source=>Number(source?.stationid??source?.stationID??source?.stationId??0)||0;
 const docking=originalDocking||{
  getSessionStationID:stat,getSessionStructureID:loc,
  getDockedLocationID:s=>loc(s)||stat(s)
 };
 const requirePath=p=>{
  if(p==='../services/chat/sessionRegistry')return registry;
  if(p==='../services/structure/structureLocation')return docking;
  throw Error('PF99_UNAUTHORIZED_NATIVE_IMPORT:'+p);
 };
 const service=fromSource(fs.readFileSync(native,'utf8'),requirePath);
 const row={characterID:90000001,accountId:55,shipID:2002,
  stationID:600001,structureID:null,balance:100};
 const session={userid:55,characterID:90000001,charid:90000001,
  stationid:600001,stationID:600001,structureid:null,structureID:null,
  shipID:2002,shipid:2002,activeShipID:2002,socket:{destroyed:false}};
 const state={row,session,sessions,registry,service,docking};
 const reader={get:(table,key)=>{
  assert.equal(table,'characters');assert.equal(key,'90000001');
  return clone(state.row);
 }};
 state.reader=reader;
 state.pf91=()=>({characterID:90000001,session:state.session,stationID:600001});
 state.pf92=()=>({characterID:90000001,session:state.session,
  previousShipItemID:2002,nextShipItemID:2001});
 state.verify=req=>service.verifyOriginalDockedPlayerSession(req||state.pf91(),reader);
 return state;
}
function withNative(t,body,options){
 const previous=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 try{const state=fresh(options);state.sessions.add(state.session);
  // An actual original registry loaded from source must use its own Set.
  if(options?.originalRegistry)options.originalRegistry.register(state.session);
  body(state);
 }finally{
  if(previous===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=previous;
 }
}
test('PF99 authentic original docked station session authorizes PF91 witness',t=>withNative(t,s=>{
 assert.equal(s.verify(),true);
}));
test('PF99 same original authority verifies PF92 previous physical ship ID',t=>withNative(t,s=>{
 assert.equal(s.verify(s.pf92()),true);
}));
test('PF99 valid original docked structure session verifies source location',t=>withNative(t,s=>{
 Object.assign(s.session,{stationid:null,stationID:null,structureid:100000001,structureID:100000001});
 Object.assign(s.row,{stationID:null,structureID:100000001});
 assert.equal(s.verify({...s.pf91(),stationID:100000001}),true);
}));
test('PF99 witness OFF by default and cannot be authorized by a client boolean',t=>withNative(t,s=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 assert.equal(s.verify(),false);
}));
test('PF99 clone of valid live session is not a registered source object',t=>withNative(t,s=>{
 const forged=clone(s.session);
 assert.equal(s.verify({...s.pf91(),session:forged}),false);
}));
test('PF99 disconnected original session cannot authenticate',t=>withNative(t,s=>{
 s.session.socket.destroyed=true;assert.equal(s.verify(),false);
}));
test('PF99 missing native socket cannot authenticate',t=>withNative(t,s=>{
 delete s.session.socket;assert.equal(s.verify(),false);
}));
test('PF99 detached session cannot authenticate after logout',t=>withNative(t,s=>{
 s.sessions.delete(s.session);assert.equal(s.verify(),false);
}));
test('PF99 source registry duplicate character sessions deny ambiguous ownership',t=>withNative(t,s=>{
 s.sessions.add({...s.session,socket:{destroyed:false}});
 assert.equal(s.verify(),false);
}));
test('PF99 original accountId must match authenticated session.userid',t=>withNative(t,s=>{
 s.row.accountId=77;assert.equal(s.verify(),false);
}));
test('PF99 missing original account ownership is not automatically trusted',t=>withNative(t,s=>{
 delete s.row.accountId;assert.equal(s.verify(),false);
}));
test('PF99 character ID aliases cannot disagree with selected original character',t=>withNative(t,s=>{
 s.session.charid=90000002;assert.equal(s.verify(),false);
}));
test('PF99 original physical ship cannot differ from client active hull',t=>withNative(t,s=>{
 s.row.shipID=4004;assert.equal(s.verify(),false);
}));
test('PF99 client active ship aliases cannot disagree',t=>withNative(t,s=>{
 s.session.activeShipID=3003;assert.equal(s.verify(),false);
}));
test('PF99 PF92 previous original hull must match live session title',t=>withNative(t,s=>{
 assert.equal(s.verify({...s.pf92(),previousShipItemID:9999}),false);
}));
test('PF99 PF91 request may not spoof station or structure location',t=>withNative(t,s=>{
 assert.equal(s.verify({...s.pf91(),stationID:600002}),false);
}));
test('PF99 original row location must equal the session docking location',t=>withNative(t,s=>{
 s.row.stationID=600002;assert.equal(s.verify(),false);
}));
test('PF99 contradictory station and structure aliases fail closed',t=>withNative(t,s=>{
 s.session.structureID=100000001;s.session.structureid=100000001;
 assert.equal(s.verify(),false);
}));
test('PF99 original SQLite character reader failure denies source witness',t=>withNative(t,s=>{
 assert.equal(s.service.verifyOriginalSessionLease(s.pf92(),{
  get(){throw Error('DISK_UNAVAILABLE')}
 }),false);
}));
test('PF99 source witness rechecks logout and account switch on second call',t=>withNative(t,s=>{
 assert.equal(s.verify(),true);
 s.session.userid=77;
 assert.equal(s.verify(),false);
 s.session.userid=55;
 s.sessions.delete(s.session);
 assert.equal(s.verify(),false);
}));
test('PF99 native source import graph is hard-bound, not callback-injected',()=>{
 const source=fs.readFileSync(native,'utf8');
 assert.match(source,/require\('\.\.\/services\/chat\/sessionRegistry'\)/);
 assert.match(source,/require\('\.\.\/services\/structure\/structureLocation'\)/);
 assert.doesNotMatch(source,/createOriginalSessionWitness\(\{registry/);
});
test('PF99 exact original registry, docking and ownership source pinned on local WORK only',t=>{
 const input=process.env.PF99_NATIVE_WORKTREE;
 if(!input){t.skip('PF99_NATIVE_WORKTREE absent: original full source owner not verified');return;}
 assert.ok(path.isAbsolute(input));
 const root=fs.realpathSync(input);
 assert.equal(root.split(/[\\/]+/).some(x=>['play','prod','production','deploy'].includes(x.toLowerCase())),false);
 const files={};
 for(const [rel,sha]of Object.entries(originalPins)){
  const bytes=fs.readFileSync(path.join(root,rel));
  const blob=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(blob,sha,'PF99_ORIGINAL_SESSION_SOURCE_DRIFT:'+rel);
  files[rel]=bytes.toString('utf8');
 }
 const registry=fromSource(files['Code/server/src/services/chat/sessionRegistry.js'],
  ()=>{throw Error('PF99_REGISTRY_DEPENDENCY_UNEXPECTED')},{});
 const docking=fromSource(files['Code/server/src/services/structure/structureLocation.js'],
  ()=>{throw Error('PF99_DOCK_DEPENDENCY_UNEXPECTED')},{});
 const s=fresh({originalRegistry:registry,originalDocking:docking});
 const previous=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 try{
  process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
  registry.register(s.session);
  assert.equal(s.verify(),true);
  registry.unregister(s.session);
  assert.equal(s.verify(),false);
 }finally{
  if(previous===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=previous;
 }
});
