'use strict';
/** Read-only original EveJS transaction writer witness for PF93. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PINNED}=require('../../pf90/inspect-original-owner-writes.cjs');
const role='GAMESTORE_NATIVE_ATOMIC';
function original(t){
 const root=process.env.PF93_NATIVE_WORKTREE;
 if(!root){t.skip('PF93_NATIVE_WORKTREE missing: native GameStore source not checked');return null;}
 assert.ok(path.isAbsolute(root),'PF93_WORKTREE_MUST_BE_ABSOLUTE');
 assert.equal(root.split(path.sep).some(x=>['play','prod','production'].includes(x.toLowerCase())),
  false,'PF93_NEVER_READ_PLAY');
 const pin=PINNED.find(p=>p.role===role);
 assert.ok(pin);
 const raw=fs.readFileSync(path.join(root,pin.path));
 const digest=crypto.createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
 assert.equal(digest,pin.blob,'PF93_ORIGINAL_NATIVE_SQLITE_SOURCE_PIN_DRIFT');
 return raw.toString('utf8');
}
test('PF93 original GameStore transaction declares scan against same SQLite authority',t=>{
 const s=original(t);if(!s)return;
 assert.match(s,/db\.exec\("BEGIN IMMEDIATE"\)/);
 assert.match(s,/scan\(t\)\{const table=tbl\(t\)/);
 assert.match(s,/db\.prepare\('SELECT key,json FROM '\+table\)\.all\(\)/);
 assert.match(s,/const tx=Object\.freeze\(\{/);
});
test('PF93 original transaction allows synchronous writes and rolls back thrown witness failures',t=>{
 const s=original(t);if(!s)return;
 assert.match(s,/put\(t,k,value\)\{const table=tbl\(t\)/);
 assert.match(s,/del\(t,k\)\{const table=tbl\(t\)/);
 assert.match(s,/db\.exec\("ROLLBACK"\)/);
 assert.match(s,/ASYNC_NATIVE_ATOMIC_MUTATION_FORBIDDEN/);
});
test('PF93 original GameStore uses one claimed writer and rejects poisoned commit state',t=>{
 const s=original(t);if(!s)return;
 assert.match(s,/NATIVE_SQLITE_WRITER_ALREADY_CLAIMED/);
 assert.match(s,/NATIVE_GAMESTORE_POISONED/);
 assert.match(s,/NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE/);
});
