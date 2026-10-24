import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {createEconomy}=require('../integration/coopVirtualEconomy.cjs');
const pilots=Array.from({length:4},(_,i)=>({id:'coop-pilot-'+String(i+1).padStart(3,'0'),systemID:30000142}));
test('economy mines, hauls, trades, patrols and survives restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-economy-'));
 try{
  let now=100000;const file=join(dir,'state.json'),clock=()=>now;
  const a=createEconomy({file,clock,stepMs:10000});
  assert.equal(a.advance(pilots).steps,0);
  now+=30000;
  assert.equal(a.advance(pilots).steps,3);
  const s=a.snapshot();
  assert.ok(s.pilots['coop-pilot-001'].completed>0);
  assert.ok(s.pilots['coop-pilot-002'].completed>0);
  assert.ok(s.pilots['coop-pilot-003'].completed>0);
  assert.ok(s.pilots['coop-pilot-004'].completed>0);
  assert.ok(s.systems['30000142'].security>50);
  assert.deepEqual(createEconomy({file,clock,stepMs:10000}).snapshot(),s);
  a.recordLoss(30000142,2);
  assert.equal(a.snapshot().systems['30000142'].losses,2);
  assert.equal(a.snapshot().events.length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('offline catchup is bounded and debt remains for later ticks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-economy-'));
 try{
  let now=1000;const e=createEconomy({file:join(dir,'e.json'),clock:()=>now,stepMs:10000,maxCatchup:2});
  e.advance(pilots);now+=90000;
  const result=e.advance(pilots);
  assert.equal(result.steps,2);
  assert.equal(result.remaining,7);
  assert.equal(result.status,'CATCHUP_REMAINING');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
