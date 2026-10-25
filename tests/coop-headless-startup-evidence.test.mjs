import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const src=path.resolve(import.meta.dirname,'../integration/coopVirtualWorldRuntime.cjs');
function initSandbox(env={EVEJS_COOP_VIRTUAL_WORLD:'1',EVEJS_COOP_HEADLESS_WORLD_BOOT:'1'}){
 const evidence=[];const warnings=[];
 const sandbox={
  module:{exports:{}}, exports:{}, process:{env},
  console:{warn:(...args)=>warnings.push(args.join(' ')),info:()=>{}},
  setInterval(){throw Error('unexpected live timer on failed initialization')},
  require(id){
   if(id==='./coopRuntimeProbe')return {observe:(event,session,ship,extra)=>{evidence.push({event,extra});return true;}};
   if(id==='./coopVirtualWorld')return {createWorld(){throw Object.assign(Error('corrupt native state'),{code:'E_CORRUPT'})}};
   if(id==='./coopNpcLife')return {createLife(){throw Error('should never reach NPC life')}};
   throw Error('unexpected module: '+id);
  }
 };
 vm.runInNewContext(fs.readFileSync(src,'utf8'),sandbox,{filename:'coopVirtualWorldRuntime.cjs'});
 return {start:sandbox.module.exports.start,evidence,warnings};
}
test('compiled native runtime emits early evidence and explicit failure before any boot request',()=>{
 const {start,evidence}=initSandbox();
 assert.throws(()=>start(),/corrupt native state/);
 assert.deepEqual(evidence.map(x=>x.event),['living-startup-entered','living-startup-failed']);
 assert.equal(evidence[1].extra.phase,'persistent-state-load');
 assert.equal(evidence[1].extra.errorCode,'E_CORRUPT');
 assert.ok(!evidence.some(x=>x.event==='living-headless-boot-requested'));
});
test('inconsistent headless/virtual-world flags produce an explicit warning without fake boot',()=>{
 const {start,evidence,warnings}=initSandbox({EVEJS_COOP_VIRTUAL_WORLD:'0',EVEJS_COOP_HEADLESS_WORLD_BOOT:'1'});
 assert.doesNotThrow(()=>start());
 assert.equal(evidence.length,0);
 assert.match(warnings.join(' '),/BLOCKED_RUNTIME_CONFIG/);
});
test('early invocation marker precedes persisted world loading in pinned overlay',()=>{
 const code=fs.readFileSync(src,'utf8');
 assert.ok(code.indexOf('observe("living-startup-entered"')>0);
 assert.ok(code.indexOf('observe("living-startup-entered"')<code.indexOf('nextWorld=createWorld('));
 assert.ok(code.indexOf('observe("living-startup-failed"')>0);
 assert.match(code,/scheduleHeadlessWorldBoot\(route\)/);
});