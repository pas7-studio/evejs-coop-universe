'use strict';
// Read-only source-pinned tests against ORIGINAL EveJS checkout, not mocks
// treated as deployed hooks. Set PF91_NATIVE_WORKTREE on local WORK agent.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const CHAR='Code/server/src/services/character/characterState.js';
const STOCK='Code/server/src/services/inventory/itemStore.js';
const CHAR_PIN='8a002d190899b6cb1e1068a565451e6d1d808401';
const STOCK_PIN='e992d56ee9cff1911d54247bf46d44d01e5d8060';
const blob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
function native(t){
 const root=process.env.PF91_NATIVE_WORKTREE;
 if(!root){t.skip('PF91_NATIVE_WORKTREE absent: original owner not executed');return null;}
 assert.ok(path.isAbsolute(root),'PF91 native checkout must be absolute');
 if(root.split(path.sep).some(p=>['play','prod','production'].includes(p.toLowerCase())))
  throw Error('PF91_NEVER_EXECUTE_FROM_PLAY');
 return root;
}
function original(root,rel,pin){
 const b=fs.readFileSync(path.join(root,rel));
 assert.equal(blob(b),pin,'PF91_ORIGINAL_OWNER_SOURCE_PIN_DRIFT:'+rel);
 return b.toString('utf8');
}
function getFunction(source,name){
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,'PF91_STOCK_FUNCTION_NOT_FOUND:'+name);
 const sep=source.indexOf(') {',start);
 assert.ok(sep>start,'PF91_STOCK_FUNCTION_SIGNATURE_UNRECOGNIZED:'+name);
 const brace=sep+2;
 let depth=0,end=-1;
 for(let i=brace;i<source.length;i++){
  if(source[i]==='{')depth++;
  else if(source[i]==='}'&&--depth===0){end=i+1;break;}
 }
 assert.ok(end>brace,'PF91_STOCK_FUNCTION_BODY_UNTERMINATED:'+name);
 return source.slice(start,end);
}
test('PF91 original characterState is per-character owner-repository writer',t=>{
 const root=native(t);if(!root)return;
 const source=original(root,CHAR,CHAR_PIN);
 const fn=getFunction(source,'writeCharacterRecord');
 const calls=[];
 const cache=new Map([['90000001',{stale:true}]]);
 const ctx={cloneValue:structuredClone,CHARACTERS_TABLE:'characters',
  characterRecordCache:cache,
  repo:{write:(table,key,value,opts)=>{
   calls.push({table,key,value,opts});return{success:true};}}};
 vm.createContext(ctx);
 vm.runInContext(fn+'; this.subject=writeCharacterRecord;',ctx);
 const out=ctx.subject(90000001,{characterID:90000001,shipID:2001,balance:5000});
 assert.equal(out.success,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].table,'characters');
 assert.equal(calls[0].key,'/90000001');
 assert.equal(cache.has('90000001'),false);
 assert.equal(calls[0].value.shipID,2001);
});
test('PF91 original characterState failure does not claim a committed native ship switch',t=>{
 const root=native(t);if(!root)return;
 const fn=getFunction(original(root,CHAR,CHAR_PIN),'writeCharacterRecord');
 const cache=new Map([['90000001',{existing:true}]]);
 const ctx={cloneValue:structuredClone,CHARACTERS_TABLE:'characters',
  characterRecordCache:cache,
  repo:{write:()=>({success:false,errorMsg:'INJECTED_STOCK_FAILURE'})}};
 vm.createContext(ctx);vm.runInContext(fn+'; this.subject=writeCharacterRecord;',ctx);
 const out=ctx.subject(90000001,{characterID:90000001,shipID:2001});
 assert.equal(out.success,false);
 assert.equal(out.errorMsg,'INJECTED_STOCK_FAILURE');
 assert.equal(cache.has('90000001'),true);
});
test('PF91 source owner still lacks a native character custody transaction hook',t=>{
 const root=native(t);if(!root)return;
 const src=original(root,CHAR,CHAR_PIN);
 const fn=getFunction(src,'writeCharacterRecord');
 assert.match(fn,/repo\.write\(CHARACTERS_TABLE,/);
 assert.doesNotMatch(fn,/coopAtomicNativeRows/);
 assert.equal(src.includes('PF91_ORIGINAL_PLAYER_SHIP_SWITCH_HOOK'),false);
});
test('PF91 original inventory delegates active ship identity to characterState',t=>{
 const root=native(t);if(!root)return;
 const src=original(root,STOCK,STOCK_PIN);
 const fn=getFunction(src,'syncCharacterActiveShip');
 assert.match(fn,/writeCharacterRecord\(/);
 assert.doesNotMatch(fn,/tx\.put\('characters'/);
 assert.match(fn,/shipID: shipItem\.itemID/);
});
