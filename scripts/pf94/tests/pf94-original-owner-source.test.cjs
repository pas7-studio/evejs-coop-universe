'use strict';
// Read-only original EveJS GameStore source contract. Never authorizes feature.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PINNED}=require('../../pf90/inspect-original-owner-writes.cjs');
function original(t){
 const root=process.env.PF94_NATIVE_WORKTREE;
 if(!root){t.skip('PF94_NATIVE_WORKTREE absent; original owner source not tested');return null;}
 assert.ok(path.isAbsolute(root),'PF94_NATIVE_ROOT_ABSOLUTE_REQUIRED');
 assert.equal(root.split(path.sep).some(p=>['play','prod','production','deploy'].includes(p.toLowerCase())),
  false,'PF94_DO_NOT_READ_PLAY');
 const pin=PINNED.find(p=>p.role==='GAMESTORE_NATIVE_ATOMIC');
 assert.ok(pin,'PF94_ORIGINAL_GAMESTORE_SOURCE_PIN_MISSING');
 const raw=fs.readFileSync(path.join(root,pin.path));
 const blob=crypto.createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
 assert.equal(blob,pin.blob,'PF94_ORIGINAL_GAMESTORE_SOURCE_CHANGED');
 return raw.toString('utf8');
}
test('PF94 original SQLite owner creates a frozen transaction after BEGIN IMMEDIATE',t=>{
 const text=original(t);if(!text)return;
 assert.match(text,/BEGIN IMMEDIATE/);
 assert.match(text,/const tx=Object\.freeze\(\{/);
 assert.match(text,/put\(t,k,value\)/);
 assert.match(text,/del\(t,k\)/);
});
test('PF94 original GameStore still lacks trusted mutation epoch — source gate blocks activation',t=>{
 const text=original(t);if(!text)return;
 assert.doesNotMatch(text,/createOriginalOwnerMutationEpoch/);
 assert.doesNotMatch(text,/PF94_ORIGINAL_GAMESTORE_EPOCH_HOOK_V1/);
 assert.match(text,/db\.exec\("ROLLBACK"\)/);
});
test('PF94 original single writer has an explicit commit outcome and cache reconciliation boundary',t=>{
 const text=original(t);if(!text)return;
 assert.match(text,/NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN/);
 assert.match(text,/claimTransactor\(\)/);
 assert.match(text,/invalidateNativeItems/);
});
