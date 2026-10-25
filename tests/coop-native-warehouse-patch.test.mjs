import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const vm=require('node:vm');
const {patch,FILE,BEGIN}=require('../scripts/coop-native-warehouse-item-patch.cjs');
const pinnedShape='"use strict";\nfunction writeItems() {}\nfunction nextItemID() {}\nmodule.exports = {\n  writeItems,\n};\n';
test('pinned hook is reversible and exactly one export, CRLF and LF',()=>{
 for(const source of [pinnedShape,pinnedShape.replaceAll('\n','\r\n')]){
  const fixed=patch(source,FILE);
  new vm.Script(fixed);
  assert.ok(fixed.includes('function findWarehouseItem('));
  assert.ok(fixed.includes('function grantUniqueNpcDepotItem('));
  assert.equal(fixed.split(BEGIN).length-1,1);
  assert.equal(patch(fixed,FILE),fixed);
  assert.equal(patch(fixed,FILE,true),source);
 }
});
test('wrong target file and unknown source blocked safely',()=>{
 assert.equal(patch(pinnedShape,'somewhere-else'),pinnedShape);
 assert.throws(()=>patch('module.exports = {};',FILE),/PINNED_SOURCE_MISMATCH/);
 assert.throws(()=>patch(pinnedShape.replace('writeItems','other'),FILE),/PINNED_SOURCE_MISMATCH/);
});
test('modified existing patch cannot silently rewrite',()=>{
 const patched=patch(pinnedShape,FILE).replace('WAREHOUSE_CARGO_TYPE_INVALID','WAREHOUSE_OVERRIDE');
 assert.throws(()=>patch(patched,FILE),/PATCH_DRIFT/);
 assert.throws(()=>patch(patched,FILE,true),/PATCH_DRIFT/);
});