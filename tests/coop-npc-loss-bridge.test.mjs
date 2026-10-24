import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {createLossBridge}=require('../integration/coopNpcLossBridge.cjs');
test('confirmed NPC wreck creates exactly one economic loss across restarts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-loss-'));
 try{
  const file=join(dir,'loss.json');let count=0;
  const spawn=()=>createLossBridge({file,recordLoss:()=>{count++;}});
  assert.equal(spawn().accept({systemID:30000142,npcID:4001,wreckID:9001}).status,'COMMITTED');
  assert.equal(spawn().accept({systemID:30000142,npcID:4001,wreckID:9001}).status,'DUPLICATE');
  assert.equal(count,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid wreck cannot affect the economy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-loss-'));
 try{
  let count=0;const b=createLossBridge({file:join(dir,'loss.json'),recordLoss:()=>count++});
  assert.equal(b.accept({systemID:30000142,npcID:4001,wreckID:0}).status,'INVALID');
  assert.equal(count,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
