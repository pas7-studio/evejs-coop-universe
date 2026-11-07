'use strict';
/**
 * PF95: test a SOURCE-PINNED original EveJS SQLite adapter, patched ONLY in
 * an isolated temporary directory. Neither patch nor test changes original.
 */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const pin='2b28b48145f3fbc989ce7346384487ee75e52280';
const patch=path.resolve(__dirname,'../../../patches/upstream/0011-pf95-original-sqlite-witness-owner.patch');
const rel='Code/server/src/space/coopGameStoreAtomic.js';
function sourceFromWork(t){
 const input=process.env.PF95_NATIVE_WORKTREE;
 if(!input){t.skip('PF95_NATIVE_WORKTREE absent: ORIGINAL native SQLite owner was not executed');return null;}
 assert.ok(path.isAbsolute(input),'PF95_NATIVE_WORKTREE_ABSOLUTE_REQUIRED');
 const root=fs.realpathSync(input);
 assert.equal(root.split(/[\\/]+/).some(x=>['play','prod','production','deploy'].includes(x.toLowerCase())),false,
  'PF95_NEVER_TEST_LIVE_PLAY_OR_DEPLOY');
 const original=fs.readFileSync(path.join(root,rel));
 const sha=crypto.createHash('sha1').update('blob '+original.length+'\0').update(original).digest('hex');
 assert.equal(sha,pin,'PF95_SOURCE_PIN_DRIFT_NO_PATCH_OR_TEST');
 return original;
}
function patchedOriginal(t){
 const original=sourceFromWork(t);if(!original)return null;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf95-original-owner-test-'));
 try{
  const file=path.join(dir,'server/src/space/coopGameStoreAtomic.js');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,original);
  const dry=spawnSync('git',['apply','--check',patch],{cwd:dir,encoding:'utf8'});
  assert.equal(dry.status,0,'PF95_ORIGINAL_SOURCE_PATCH_CHECK_FAILED: '+dry.stderr);
  const applied=spawnSync('git',['apply',patch],{cwd:dir,encoding:'utf8'});
  assert.equal(applied.status,0,'PF95_TEMPORARY_PATCH_APPLY_FAILED: '+applied.stderr);
  const changed=fs.readFileSync(file);
  assert.notDeepEqual(changed,original,'PF95_PATCH_HAD_NO_EFFECT');
  const native=require(file);
  assert.equal(typeof native.createSqliteAdapter,'function');
  return {native,dir,file,original,changed};
 }catch(error){fs.rmSync(dir,{recursive:true,force:true});throw error;}
}
function withNative(t,fn,{witness='1'}={}){
 const source=patchedOriginal(t);if(!source)return;
 const db=new DatabaseSync(':memory:');
 const oldAtomic=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 const oldWitness=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 try{
  process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS='1';
  if(witness===null)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=witness;
  for(const table of ['items','characters','corporationRuntime']){
   db.exec('CREATE TABLE "'+table+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  }
  const seed={characterID:90000001,balance:100,shipID:2001};
  db.prepare('INSERT INTO "characters" (key,json) VALUES(?,?)').run('90000001',JSON.stringify(seed));
  const adapter=source.native.createSqliteAdapter(()=>db).claimTransactor();
  const get=(table,key)=>{
   const record=db.prepare('SELECT json FROM "'+table+'" WHERE key=?').get(String(key));
   return record?JSON.parse(record.json):null;
  };
  fn({db,adapter,get,source,seed});
 }finally{
  db.close();fs.rmSync(source.dir,{recursive:true,force:true});
  if(oldAtomic===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=oldAtomic;
  if(oldWitness===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=oldWitness;
 }
}
test('PF95 patched ORIGINAL owner is source-pinned, patchable and temporary only',t=>withNative(t,h=>{
 assert.equal(h.source.changed.includes('PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK'),true);
 assert.equal(crypto.createHash('sha1').update('blob '+h.source.original.length+'\0').update(h.source.original).digest('hex'),pin);
 assert.equal(h.get('characters','90000001').balance,100);
}));
test('PF95 pure original source session reader succeeds and preserves original receipts',t=>withNative(t,h=>{
 const row={characterID:90000001,balance:101,shipID:2001};
 const out=h.adapter.transact(['characters'],tx=>{
  assert.equal(tx.verifyReadOnlySessionWitness((_request,reader)=>{
   assert.equal(reader.put,undefined);assert.equal(reader.del,undefined);
   assert.equal(reader.get('characters','90000001').balance,100);return true;
  },{characterID:90000001}),true);
  tx.put('characters','90000001',row);
  return 'OK';
 });
 assert.equal(out.result,'OK');
 assert.deepEqual(out.changed,{characters:['90000001']});
 assert.equal(out.writes.characters.length,1);
 assert.equal(out.writes.characters[0][1],JSON.stringify(row));
 assert.equal(h.get('characters','90000001').balance,101);
}));
test('PF95 original witness false with no write is a safe false',t=>withNative(t,h=>{
 const out=h.adapter.transact(['characters'],tx=>tx.verifyReadOnlySessionWitness(()=>false,{}));
 assert.equal(out.result,false);
 assert.equal(h.get('characters','90000001').balance,100);
}));
test('PF95 original witness write then restore aborts the actual SQLite transaction',t=>withNative(t,h=>{
 assert.throws(()=>h.adapter.transact(['characters'],tx=>tx.verifyReadOnlySessionWitness(()=>{
  const before=tx.get('characters','90000001');
  tx.put('characters','90000001',{...before,balance:999});
  tx.put('characters','90000001',before);
  return false;
 },{})),/PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK/);
 assert.equal(h.get('characters','90000001').balance,100);
}));
test('PF95 original witness identical-value write is caught',t=>withNative(t,h=>{
 assert.throws(()=>h.adapter.transact(['characters'],tx=>tx.verifyReadOnlySessionWitness(()=>{
  tx.put('characters','90000001',tx.get('characters','90000001'));
  return true;
 },{})),/PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK/);
}));
test('PF95 original witness deletion of missing row is counted and rolled back',t=>withNative(t,h=>{
 assert.throws(()=>h.adapter.transact(['characters'],tx=>tx.verifyReadOnlySessionWitness(()=>{
  tx.del('characters','missing');return false;
 },{})),/PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK/);
}));
test('PF95 callback mutating unrelated original corporation row never commits on false',t=>withNative(t,h=>{
 assert.throws(()=>h.adapter.transact(['characters','corporationRuntime'],tx=>
  tx.verifyReadOnlySessionWitness(()=>{tx.put('corporationRuntime','other',{unexpected:true});return false;},{})),
 /PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK/);
 assert.equal(h.get('corporationRuntime','other'),null);
}));
test('PF95 callbacks returning promises are refused before COMMIT',t=>withNative(t,h=>{
 assert.throws(()=>h.adapter.transact(['characters'],tx=>tx.verifyReadOnlySessionWitness(
  ()=>Promise.resolve(true),{})),/PF95_ASYNC_ORIGINAL_SESSION_WITNESS_FORBIDDEN/);
}));
test('PF95 source-owned witness stays disabled without the specific opt-in',t=>withNative(t,h=>{
 assert.throws(()=>h.adapter.transact(['characters'],tx=>tx.verifyReadOnlySessionWitness(
  ()=>true,{})),/PF95_ORIGINAL_SESSION_WITNESS_DISABLED/);
 assert.equal(h.get('characters','90000001').balance,100);
},{witness:null}));
test('PF95 original transaction token is unusable after a successful commit',t=>withNative(t,h=>{
 let escaped;
 h.adapter.transact(['characters'],tx=>{escaped=tx;return 'OK';});
 assert.throws(()=>escaped.put('characters','90000001',{characterID:90000001,balance:0}),/PF95_NATIVE_TRANSACTION_CLOSED/);
 assert.throws(()=>escaped.get('characters','90000001'),/PF95_NATIVE_TRANSACTION_CLOSED/);
 assert.equal(h.get('characters','90000001').balance,100);
}));
test('PF95 original transaction token is unusable after rollback',t=>withNative(t,h=>{
 let escaped;
 assert.throws(()=>h.adapter.transact(['characters'],tx=>{
  escaped=tx;tx.put('characters','90000001',{characterID:90000001,balance:0});throw Error('ABORT');
 }),/ABORT/);
 assert.throws(()=>escaped.del('characters','90000001'),/PF95_NATIVE_TRANSACTION_CLOSED/);
 assert.equal(h.get('characters','90000001').balance,100);
}));
test('PF95 original SQLite source still uses synchronous FULL and BEGIN IMMEDIATE',t=>withNative(t,h=>{
 assert.match(h.source.changed.toString('utf8'),/PRAGMA synchronous = FULL/);
 assert.match(h.source.changed.toString('utf8'),/BEGIN IMMEDIATE/);
 assert.match(h.source.changed.toString('utf8'),/NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN/);
}));
