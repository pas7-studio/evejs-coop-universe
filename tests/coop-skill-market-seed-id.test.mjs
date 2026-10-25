import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const path=new URL('../scripts/balance-skill-market.cjs',import.meta.url);
const source=fs.readFileSync(path,'utf8');
test('CCP 2026 skill injector ids are mapped to correct names without 40521',()=>{
 const captured=[];
 const mockedDB=class {prepare(){return {all: id => {captured.push(id);return []}}}};
 const log=[];
 assert.throws(()=>new vm.Script(source).runInNewContext({
  require: name=>name==='fs'?{copyFileSync(){throw Error('WRITE_NOT_EXPECTED')}}:
   name==='node:sqlite'?{DatabaseSync:mockedDB}:(()=>{throw Error('Unexpected '+name)})(),
  process:{argv:['node','script'],exit:code=>{throw Error('EXIT_'+code)}},
  console:{log:(...args)=>log.push(args.join(' '))}, Date
 }),/EXIT_0/);
 assert.deepEqual(captured,[40519,40520,45635]);
 assert.ok(!captured.includes(40521));
 assert.ok(log.join('\n').includes('Small Skill Injector: not seeded'));
});
test('no static market balancing can silently import new ship/module type IDs',()=>{
 assert.equal((source.match(/\{ typeID:\s*\d+, name:/g)||[]).length,3);
 assert.ok(source.includes('if (!APPLY)'));
 assert.ok(source.includes('const backup'));
});
