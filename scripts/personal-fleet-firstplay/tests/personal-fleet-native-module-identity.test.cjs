'use strict';
/**
 * PF91 regression: the original first-play package must not accidentally
 * swap WORK chat ingress with server-only command owner during an edit.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ownerPath=path.join(__dirname,'../native/coopPersonalFleetWorkCommandOwner.js');
const chatPath=path.join(__dirname,'../native/coopPersonalFleetChatGateway.js');
const owner=fs.readFileSync(ownerPath,'utf8');
const chat=fs.readFileSync(chatPath,'utf8');
test('PF91 WORK owner and chat gateway exports are tied to exact native filename',()=>{
 assert.match(owner,/module\.exports=Object\.freeze\(\{createOriginalWorkCommandOwner\}\)/);
 assert.doesNotMatch(owner,/module\.exports=Object\.freeze\(\{installServerAuthority/);
 assert.match(chat,/module\.exports=Object\.freeze\(\{installServerAuthority,handleChat,parseCommand,HELP\}\)/);
 assert.doesNotMatch(chat,/module\.exports=Object\.freeze\(\{createOriginalWorkCommandOwner/);
});
test('PF91 server command owner contains original salary and dismiss authority',()=>{
 assert.match(owner,/function salary\(ctx\)/);
 assert.match(owner,/function dismiss\(ctx\)/);
 assert.match(owner,/pf57\.salary\(/);
 assert.match(owner,/pf57\.inspect\(/);
 assert.match(chat,/salary:\{arity:1,method:'salary'\}/);
 assert.match(chat,/\['dismiss','salary'\]\.includes\(action\)/);
});
test('PF91 owner exports constructor without installing a chat listener',()=>{
 const m={exports:{}};
 vm.runInNewContext(owner,{module:m,exports:m.exports,
  require:name=>{
   if(name==='node:crypto')return {randomUUID:()=>{throw Error('SYNTHETIC_OPERATION_NOT_ALLOWED');}};
   throw Error('UNEXPECTED_IMPORT:'+name);
  },Object,Number,Array,Set,Map,Date},{filename:ownerPath});
 assert.equal(typeof m.exports.createOriginalWorkCommandOwner,'function');
 assert.equal(m.exports.handleChat,undefined);
});
