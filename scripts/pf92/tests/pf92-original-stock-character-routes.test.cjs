'use strict';
// Read-only original owner proof. Never patch or start the EveJS server.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {PINNED}=require('../../pf90/inspect-original-owner-writes.cjs');
const originalRole=role=>{
 const entry=PINNED.find(row=>row.role===role);
 assert.ok(entry,'PF92_ORIGINAL_SOURCE_PIN_MISSING:'+role);
 return entry;
};
function source(t,role){
 const location=process.env.PF92_NATIVE_WORKTREE;
 if(!location){t.skip('PF92_NATIVE_WORKTREE absent: original source NOT verified');return null;}
 assert.ok(path.isAbsolute(location),'PF92 native source checkout must be absolute');
 assert.equal(location.split(path.sep).some(part=>
  ['play','prod','production'].includes(part.toLowerCase())),false,
  'PF92_NEVER_TEST_PLAY');
 const record=originalRole(role),buffer=fs.readFileSync(path.join(location,record.path));
 const sha=crypto.createHash('sha1').update('blob '+buffer.length+'\0')
  .update(buffer).digest('hex');
 assert.equal(sha,record.blob,'PF92_ORIGINAL_SOURCE_DRIFT:'+role);
 return buffer.toString('utf8');
}
function getFn(source,name){
 const anchor='function '+name+'(',start=source.indexOf(anchor);
 assert.ok(start>=0,'PF92_MISSING_ORIGINAL_FUNCTION:'+name);
 // Preserve stock default arg syntax: "(..., options = {}) {".
 const signatureEnd=source.indexOf(') {',start);
 assert.ok(signatureEnd>start,'PF92_ORIGINAL_FUNCTION_SIGNATURE_CHANGED:'+name);
 let depth=0,end=-1,brace=signatureEnd+2;
 for(let i=brace;i<source.length;i++){
  if(source[i]==='{')depth++;
  else if(source[i]==='}'&&--depth===0){end=i+1;break;}
 }
 assert.ok(end>brace,'PF92_ORIGINAL_FUNCTION_BODY_INVALID:'+name);
 return source.slice(start,end);
}
test('PF92 original stock getCharacterRecord can write a normalized character record',t=>{
 const raw=source(t,'STOCK_CHARACTERS_OWNER');if(!raw)return;
 const fn=getFn(raw,'getCharacterRecord');
 assert.match(fn,/normalizeCharacterRecord\(charId, rawRecord\)/);
 assert.match(fn,/writeCharacterRecord\(charId, normalizedRecord\)/);
});
test('PF92 stock updateCharacterRecord uses generic writeCharacterRecord, not activation-only',t=>{
 const raw=source(t,'STOCK_CHARACTERS_OWNER');if(!raw)return;
 const fn=getFn(raw,'updateCharacterRecord');
 assert.match(fn,/writeCharacterRecord\(charId, normalizedRecord\)/);
 const calls=[],ctx={
  getCharacterRecord:()=>({characterID:90000001,balance:5000,shipID:2001}),
  cloneValue:structuredClone,
  normalizeCharacterRecord:(_id,c)=>c,
  writeCharacterRecord:(id,value)=>{calls.push({id,value});return{success:true}}
 };
 vm.createContext(ctx);vm.runInContext(fn+'; this.update=updateCharacterRecord',ctx);
 const reply=ctx.update(90000001,current=>{
  current.balance=7000;current.shipID=2002;return current;
 });
 assert.equal(reply.success,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].value.shipID,2002);
});
test('PF92 original inventory syncCharacterActiveShip also uses generic character writer',t=>{
 const raw=source(t,'STOCK_ITEMS_OWNER');if(!raw)return;
 const fn=getFn(raw,'syncCharacterActiveShip');
 assert.match(fn,/writeCharacterRecord\(/);
 assert.match(fn,/shipID: shipItem\.itemID/);
});
test('PF92 original character record ownership is still single-writer repository',t=>{
 const raw=source(t,'STOCK_CHARACTERS_OWNER');if(!raw)return;
 const fn=getFn(raw,'writeCharacterRecord');
 assert.match(fn,/repo\.write\(CHARACTERS_TABLE,/);
 assert.doesNotMatch(fn,/coopAtomicNativeRows/);
 const owner=source(t,'GAMESTORE_OWNER_REPOSITORY');
 assert.match(owner,/guard\(table, "write"\)/);
});
