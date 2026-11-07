'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const PIN='e992d56ee9cff1911d54247bf46d44d01e5d8060';
const SOURCE='Code/server/src/services/inventory/itemStore.js';
const PATCH=path.resolve(__dirname,'../review/itemStore.pf97.review-only.patch');
function withPatchedSource(t,callback){
 const home=process.env.PF97_NATIVE_WORKTREE;
 if(!home){t.skip('PF97_NATIVE_WORKTREE absent: original ItemStore source not tested');return;}
 assert.ok(path.isAbsolute(home),'PF97_ORIGINAL_WORKTREE_ABSOLUTE_REQUIRED');
 const root=fs.realpathSync(home);
 assert.equal(root.split(/[\\/]+/).some(n=>['play','prod','production','deploy'].includes(n.toLowerCase())),
  false,'PF97_NEVER_TEST_PLAY_OR_PRODUCTION');
 const raw=fs.readFileSync(path.join(root,SOURCE));
 const digest=crypto.createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
 assert.equal(digest,PIN,'PF97_ORIGINAL_ITEMSTORE_SOURCE_PIN_DRIFT');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pf97-itemstore-'));
 const oldFlag=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 try{
  const f=path.join(temp,'server/src/services/inventory/itemStore.js');
  fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,raw);
  let result=spawnSync('git',['apply','--check',PATCH],{cwd:temp,encoding:'utf8'});
  assert.equal(result.status,0,'PF97_ITEMSTORE_PATCH_CHECK_FAILED: '+result.stderr);
  result=spawnSync('git',['apply',PATCH],{cwd:temp,encoding:'utf8'});
  assert.equal(result.status,0,'PF97_ITEMSTORE_TEMP_ONLY_APPLY_FAILED: '+result.stderr);
  const source=fs.readFileSync(f,'utf8');
  const extract=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i+1);assert.ok(i>0&&j>i);return source.slice(i,j)};
  const counters={migrated:0,find:0,synced:0,writes:0};
  const char={accountId:1,characterID:90000001,shipID:2001,stationID:60000001};
  const hull={itemID:2001,ownerID:90000001,typeID:606,itemName:'Original Hull'};
  const deps={
   process,
   ensureMigrated:()=>{counters.migrated++},
   toNumber:(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback,
   readCharacters:()=>({'90000001':structuredClone(char)}),
   findCharacterShipItem:(id,shipID)=>{counters.find++;return Number(shipID)===2001?structuredClone(hull):null},
   activeShipNeedsSpaceRecordRepair:()=>{throw Error('PF97_UNEXPECTED_SPACE_REPAIR')},
   cloneValue:structuredClone,
   require:()=>({writeCharacterRecord:()=>{counters.writes++;return {success:true}}}),
  };
  const snippet=extract('function ensureCharacterActiveShipItem(','function getActiveShipItem(')+
   extract('function syncCharacterActiveShip(','function resolveItemTypeReference(')+
   extract('function setActiveShipForCharacter(','function characterHasGoldenCapsuleImplant(')+
   '\nreturn {ensureCharacterActiveShipItem,syncCharacterActiveShip,setActiveShipForCharacter};';
  const api=new Function(...Object.keys(deps),snippet)(...Object.values(deps));
  callback({api,counters,char,hull,source});
 }finally{
  fs.rmSync(temp,{recursive:true,force:true});
  if(oldFlag===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=oldFlag;
 }
}
test('PF97 original lazy active-ship read cannot create or repair a hull in guarded mode',t=>withPatchedSource(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 assert.equal(h.api.ensureCharacterActiveShipItem(90000001),null);
 assert.equal(h.counters.migrated,0);assert.equal(h.counters.find,0);
}));
test('PF97 original ship sync is blocked before ItemStore migration',t=>withPatchedSource(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const result=h.api.syncCharacterActiveShip(90000001,h.hull);
 assert.equal(result.errorMsg,'PF97_ITEMSTORE_SHIP_SYNC_REQUIRES_NATIVE_CUSTODY');
 assert.equal(h.counters.migrated,0);assert.equal(h.counters.writes,0);
}));
test('PF97 stock ship activation is blocked before ItemStore lookup',t=>withPatchedSource(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const result=h.api.setActiveShipForCharacter(90000001,2001);
 assert.equal(result.errorMsg,'PF97_ITEMSTORE_ACTIVATION_REQUIRES_NATIVE_CUSTODY');
 assert.equal(h.counters.find,0);assert.equal(h.counters.writes,0);
}));
test('PF97 existing active hull lazy read stays unchanged when flag OFF',t=>withPatchedSource(t,h=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const item=h.api.ensureCharacterActiveShipItem(90000001);
 assert.equal(item.itemID,2001);
 assert.equal(h.counters.migrated,1);assert.equal(h.counters.find,1);
}));
test('PF97 stock ship title sync still uses CharacterState owner when flag OFF',t=>withPatchedSource(t,h=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const result=h.api.syncCharacterActiveShip(90000001,h.hull);
 assert.equal(result.success,true);
 assert.equal(h.counters.migrated,1);assert.equal(h.counters.writes,1);
}));
test('PF97 stock ship activation still uses ItemStore and character writer when OFF',t=>withPatchedSource(t,h=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const result=h.api.setActiveShipForCharacter(90000001,2001);
 assert.equal(result.success,true);assert.equal(result.data.itemID,2001);
 assert.equal(h.counters.find,1);assert.equal(h.counters.writes,1);
}));
test('PF97 ItemStore original copy remains untouched after isolated review patch test',t=>withPatchedSource(t,h=>{
 assert.match(h.source,/PF97_ITEMSTORE_SHIP_SYNC_REQUIRES_NATIVE_CUSTODY/);
 assert.match(h.source,/PF97_ITEMSTORE_ACTIVATION_REQUIRES_NATIVE_CUSTODY/);
}));
