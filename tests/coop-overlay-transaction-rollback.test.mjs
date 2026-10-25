import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {executePlan}=require('../scripts/patch-evejs-coop.cjs');
function fixture(start,{failFile='b',failRollback=false}={}){
 const files=new Map(Object.entries(start));let failed=false;
 const ops={existsSync:p=>files.has(p),unlinkSync:p=>{if(!files.delete(p))throw Error('ENOENT '+p)},
  writeFileSync:(p,content)=>{if(p===failFile&&!failed){failed=true;files.set(p,'PARTIAL');throw Error('IO_FAULT')}
   if(failRollback&&failed&&p==='a')throw Error('ROLLBACK_IO_FAULT');files.set(p,content)}};
 return {files,ops};
}
test('failed write restores the already-written file and failing file',()=>{
 const f=fixture({a:'A',b:'B'});
 assert.throws(()=>executePlan([{file:'a',before:'A',after:'new A'},
  {file:'b',before:'B',after:'new B'}],f.ops),/IO_FAULT/);
 assert.deepEqual(Object.fromEntries(f.files),{a:'A',b:'B'});
});
test('a partially created module is unlinked during rollback',()=>{
 const f=fixture({a:'A'});
 assert.throws(()=>executePlan([{file:'a',before:'A',after:'new A'},
  {file:'b',before:null,after:'new B'}],f.ops),/IO_FAULT/);
 assert.deepEqual(Object.fromEntries(f.files),{a:'A'});
});
test('incomplete rollback is explicit and retains original cause',()=>{
 const f=fixture({a:'A',b:'B'},{failRollback:true});
 assert.throws(()=>executePlan([{file:'a',before:'A',after:'new A'},
  {file:'b',before:'B',after:'new B'}],f.ops),e=>
   e.message.includes('Overlay rollback incomplete: a')&&e.cause?.message==='IO_FAULT');
});
test('successful plan makes exactly one change per item',()=>{
 const f=fixture({a:'A'},{failFile:'unused'});
 executePlan([{file:'a',before:'A',after:'B'}],f.ops);
 assert.equal(f.files.get('a'),'B');
});
