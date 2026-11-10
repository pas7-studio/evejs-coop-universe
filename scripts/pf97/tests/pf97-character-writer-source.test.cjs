'use strict';
/**
 * PF97 — execute the EXACT original characterState writer from a source-pinned,
 * temp-only patched copy. Never import the live server or patch WORK/PLAY.
 */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const PIN='8a002d190899b6cb1e1068a565451e6d1d808401';
const SOURCE='Code/server/src/services/character/characterState.js';
const PATCH=path.resolve(__dirname,'../review/characterState.pf97.review-only.patch');
function loadOriginal(t){
 const home=process.env.PF97_NATIVE_WORKTREE;
 if(!home){t.skip('PF97_NATIVE_WORKTREE absent: ORIGINAL characterState source not tested');return null;}
 assert.ok(path.isAbsolute(home),'PF97_ORIGINAL_WORKTREE_ABSOLUTE_REQUIRED');
 const root=fs.realpathSync(home);
 assert.equal(root.split(/[\\/]+/).some(p=>['play','prod','production','deploy'].includes(p.toLowerCase())),
  false,'PF97_NEVER_TEST_PLAY_OR_PRODUCTION');
 const raw=fs.readFileSync(path.join(root,SOURCE));
 const sha=crypto.createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
 assert.equal(sha,PIN,'PF97_ORIGINAL_CHARACTER_OWNER_SOURCE_PIN_DRIFT');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf97-character-owner-'));
 try{
  const file=path.join(dir,'server/src/services/character/characterState.js');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw);
  const check=spawnSync('git',['apply','--check',PATCH],{cwd:dir,encoding:'utf8'});
  assert.equal(check.status,0,'PF97_REVIEW_PATCH_CHECK_FAILED: '+check.stderr);
  const applied=spawnSync('git',['apply',PATCH],{cwd:dir,encoding:'utf8'});
  assert.equal(applied.status,0,'PF97_TEMP_ONLY_APPLY_FAILED: '+applied.stderr);
  const source=fs.readFileSync(file,'utf8');
  assert.notEqual(source,raw.toString('utf8'));
  return {dir,source};
 }catch(error){fs.rmSync(dir,{recursive:true,force:true});throw error;}
}
function withHarness(t,callback){
 const original=loadOriginal(t);if(!original)return;
 const oldFlag=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE "characters"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const seed={characterID:90000001,shipID:2001,shipTypeID:606,shipName:'Test Hull',balance:100,storedShips:[]};
  db.prepare('INSERT INTO "characters"(key,json) VALUES (?,?)').run('90000001',JSON.stringify(seed));
  const read=id=>{const r=db.prepare('SELECT json FROM "characters" WHERE key=?').get(String(id));return r?JSON.parse(r.json):null;};
  const write=(id,value)=>db.prepare('INSERT INTO "characters"(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(String(id),JSON.stringify(value));
  const metrics={legacyWrites:0,nativeTransactions:0,nativePuts:0,directRemoves:0};
  const state={beforeOverride:null,preTransaction:null,atomicError:null,poisoned:false,noNative:false,overridePut:null};
  const cache=new Map();
  const repo={
   read:(table,p)=>({success:true,data:p==='/'?{'90000001':read('90000001')}:read(p.slice(1))}),
   write:(table,p,v)=>{metrics.legacyWrites++;write(p.slice(1),v);return {success:true}},
   remove:(table,p)=>{metrics.directRemoves++;db.prepare('DELETE FROM "characters" WHERE key=?').run(p.slice(1));return {success:true}}
  };
  const native={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>state.poisoned,
   transact:(tables,fn)=>{
    metrics.nativeTransactions++;
    assert.deepEqual(tables,['characters']);
    if(state.atomicError)throw state.atomicError;
    if(state.preTransaction)state.preTransaction({read,write});
    db.exec('BEGIN IMMEDIATE');
    const tx={
     get:(table,id)=>read(id),
     put:(table,id,value)=>{metrics.nativePuts++;if(state.overridePut)state.overridePut({write,id,value});else write(id,value)}
    };
    try{const result=fn(tx);db.exec('COMMIT');return result}
    catch(e){db.exec('ROLLBACK');throw e}
   }};
  const deps={
   repo,cloneValue:structuredClone,characterRecordCache:cache,
   readCharacters:()=>state.beforeOverride||repo.read('characters','/').data,
   require:()=>state.noNative?{}:{coopAtomicNativeRows:native},
   path:{join:()=>'/isolated/fake/gameStore'},__dirname:'/isolated/fake/character',
   process,CHARACTERS_TABLE:'characters'
  };
  const s=original.source;
  const start=s.indexOf('const PF97_PROTECTED_SHIP_FIELDS =');
  const end=s.indexOf('// Owner removal API',start);
  assert.ok(start>0&&end>start,'PF97_SOURCE_WRITER_SPAN_NOT_FOUND');
  const rm=s.indexOf('function removeCharacterRecord(charId) {',end);
  const rmEnd=s.indexOf('function toBigInt(value, fallback = 0n) {',rm);
  assert.ok(rm>0&&rmEnd>rm);
  const sourceFunctions=s.slice(start,end)+'\n'+s.slice(rm,rmEnd)+
     '\nreturn {writeCharacterRecord,removeCharacterRecord,pf97ProtectedShipChanged};';
  const argNames=Object.keys(deps),api=new Function(...argNames,sourceFunctions)(...Object.values(deps));
  callback({db,read,write,seed,repo,native,state,metrics,cache,api,source:s});
 }finally{
  db.close();fs.rmSync(original.dir,{recursive:true,force:true});
  if(oldFlag===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=oldFlag;
 }
}
test('PF97 stock original writer unchanged while feature flag OFF',t=>withHarness(t,h=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,balance:101});
 assert.equal(out.success,true);assert.equal(h.metrics.legacyWrites,1);
 assert.equal(h.metrics.nativeTransactions,0);assert.equal(h.read(90000001).balance,101);
}));
test('PF97 wallet-only write commits through one original native character row',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,balance:111});
 assert.equal(out.success,true);assert.equal(h.read(90000001).balance,111);
 assert.equal(h.metrics.legacyWrites,0);assert.equal(h.metrics.nativeTransactions,1);
 assert.equal(h.metrics.nativePuts,1);
}));
test('PF97 original writer rejects changed shipID before any SQLite mutation',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,shipID:3003});
 assert.equal(out.errorMsg,'PF97_SHIP_IDENTITY_REQUIRES_NATIVE_CUSTODY');
 assert.equal(h.metrics.nativeTransactions,0);assert.equal(h.read(90000001).shipID,2001);
}));
test('PF97 original writer rejects changed activeShipID alias',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,activeShipID:5005});
 assert.equal(out.errorMsg,'PF97_SHIP_IDENTITY_REQUIRES_NATIVE_CUSTODY');
 assert.equal(h.metrics.nativeTransactions,0);
}));
test('PF97 original writer rejects normalized shipTypeID and shipName changes',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 for(const next of [{...h.seed,shipTypeID:999},{...h.seed,shipName:'Spoofed'}]){
  const out=h.api.writeCharacterRecord(90000001,next);
  assert.equal(out.errorMsg,'PF97_SHIP_IDENTITY_REQUIRES_NATIVE_CUSTODY');
 }
 assert.equal(h.metrics.nativePuts,0);
}));
test('PF97 storedShips deletion is a protected ship title change',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.writeCharacterRecord(90000001,(({storedShips,...rest})=>rest)(h.seed));
 assert.equal(out.errorMsg,'PF97_SHIP_IDENTITY_REQUIRES_NATIVE_CUSTODY');
}));
test('PF97 stale original snapshot cannot overwrite a newer native owner',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 h.state.beforeOverride={'90000001':structuredClone(h.seed)};
 h.state.preTransaction=({write})=>write('90000001',{...h.seed,balance:135});
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,balance:150});
 assert.equal(out.errorMsg,'PF97_CHARACTER_BEFORE_IMAGE_STALE');
 assert.equal(h.read(90000001).balance,135);assert.equal(h.metrics.nativePuts,0);
 assert.equal(h.metrics.legacyWrites,0);
}));
test('PF97 unavailable native GameStore owner fails closed',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';h.state.noNative=true;
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,balance:105});
 assert.equal(out.errorMsg,'PF97_NATIVE_OWNER_NOT_AVAILABLE');
 assert.equal(h.metrics.legacyWrites,0);assert.equal(h.read(90000001).balance,100);
}));
test('PF97 poisoned native GameStore owner fails closed',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';h.state.poisoned=true;
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,balance:105});
 assert.equal(out.errorMsg,'PF97_NATIVE_OWNER_NOT_AVAILABLE');
 assert.equal(h.metrics.nativeTransactions,0);
}));
test('PF97 original writer refuses transient or implicit persistence options',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,balance:105},{transient:true});
 assert.equal(out.errorMsg,'PF97_ORIGINAL_CHARACTER_INPUT_INVALID');
 assert.equal(h.metrics.nativeTransactions,0);
}));
test('PF97 original writer refuses character identity replacement',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,characterID:90000002});
 assert.equal(out.errorMsg,'PF97_ORIGINAL_CHARACTER_INPUT_INVALID');
}));
test('PF97 original writer denies new row creation without exact before-image',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.writeCharacterRecord(90000002,{characterID:90000002,balance:10});
 assert.equal(out.errorMsg,'PF97_ORIGINAL_CHARACTER_BEFORE_MISSING');
}));
test('PF97 precommit native write/readback inconsistency rolls back atomically',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 h.state.overridePut=()=>{}; // deliberately drop the physical write
 const out=h.api.writeCharacterRecord(90000001,{...h.seed,balance:105});
 assert.equal(out.errorMsg,'PF97_CHARACTER_ATOMIC_WRITE_FAILED');
 assert.equal(h.read(90000001).balance,100);
}));
test('PF97 unknown durable COMMIT outcome must propagate without retryable status',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const err=Error('UNCONFIRMED');err.coopCommitOutcomeUnknown=true;h.state.atomicError=err;
 assert.throws(()=>h.api.writeCharacterRecord(90000001,{...h.seed,balance:109}),/UNCONFIRMED/);
 assert.equal(h.metrics.legacyWrites,0);
}));
test('PF97 postcommit cache poison must propagate without retryable status',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 h.state.atomicError=Error('NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE');
 assert.throws(()=>h.api.writeCharacterRecord(90000001,{...h.seed,balance:105}),/COMMITTED_BUT_CACHE_UNSAFE/);
}));
test('PF97 character deletion is denied under native witness feature mode',t=>withHarness(t,h=>{
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const out=h.api.removeCharacterRecord(90000001);
 assert.equal(out.errorMsg,'PF97_CHARACTER_DELETE_REQUIRES_NATIVE_OWNER');
 assert.equal(h.metrics.directRemoves,0);assert.ok(h.read(90000001));
}));
test('PF97 original character deletion behavior unchanged with feature OFF',t=>withHarness(t,h=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const out=h.api.removeCharacterRecord(90000001);
 assert.equal(out.success,true);assert.equal(h.metrics.directRemoves,1);assert.equal(h.read(90000001),null);
}));
test('PF97 original normalization detects that a denied writer must not return a synthetic ship title',t=>withHarness(t,h=>{
 assert.match(h.source,/const saved = writeCharacterRecord\(charId, normalizedRecord\)/);
 assert.match(h.source,/if \(process\.env\.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS === "1" &&\s*\(!saved \|\| !saved\.success\)\) \{\s*return null;/);
}));
