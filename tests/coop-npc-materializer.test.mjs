import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createBridge}=require('../integration/coopNpcMaterializer.cjs');
test('same persistent pilot maps to same live native NPC, no duplicate spawn',()=>{
 let next=100,spawns=0;
 const live=new Set();
 const bridge=createBridge({limit:2,exists:(_sys,id)=>live.has(id),spawn:()=>{const id=++next;live.add(id);spawns++;return {success:true,data:{spawned:[{entity:{itemID:id}}]}};}});
 const pilots=[{id:'pilot-a'},{id:'pilot-b'},{id:'pilot-c'}];
 assert.equal(bridge.reconcile(30000142,pilots).filter(x=>x.entityID).length,2);
 assert.equal(spawns,2);
 bridge.reconcile(30000142,pilots);
 assert.equal(spawns,2);
 assert.equal(bridge.snapshot().length,2);
 live.delete(101);
 bridge.reconcile(30000142,pilots);
 assert.equal(spawns,3);
 assert.equal(bridge.snapshot().length,2);
});
test('failed native spawn is not assigned to a virtual identity',()=>{
 const b=createBridge({spawn:()=>({success:false,errorMsg:'NO_POOL'}),exists:()=>false});
 assert.equal(b.reconcile(30000142,[{id:'p1'}])[0].error,'NO_POOL');
 assert.deepEqual(b.snapshot(),[]);
});
test('invalid bridge limits are rejected',()=>assert.throws(()=>createBridge({spawn:()=>{},exists:()=>true,limit:11}),/limit/));
