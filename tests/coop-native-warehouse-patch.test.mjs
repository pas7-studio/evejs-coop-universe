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
test('actual injected helper keeps distinct native ore stacks for distinct cargoIDs',()=>{
 const source=`"use strict";
 const ITEM_FLAGS={HANGAR:4}, CLIENT_INVENTORY_STACK_LIMIT=999999;
 let items={};let next=1000;
 const repo={};
 function ensureMigrated(){}
 function writeItems(nextItems){items=nextItems;return true;}
 function readItems(){return items;}
 function nextItemID(){return ++next;}
 function cloneValue(x){return JSON.parse(JSON.stringify(x));}
 function resolveItemTypeReference(x){return {typeID:Number(x.typeID),name:'Ore'};}
 function shouldItemDefaultToSingleton(){return false;}
 function buildInventoryItem(x){return {...x,quantity:x.quantity,customInfo:x.customInfo};}
 module.exports = {
  readItems,
 };
 `;
 const mod={exports:{}};new Function('module','exports',patch(source,FILE))(mod,mod.exports);
 const input={ownerID:1000035,stationID:6001,typeID:1230,quantity:100,cargoID:55};
 const first=mod.exports.grantUniqueNpcDepotItem(input);
 assert.equal(first.success,true);assert.equal(first.data.existing,false);
 const second=mod.exports.grantUniqueNpcDepotItem({...input,cargoID:56});
 assert.equal(second.success,true);assert.notEqual(first.data.itemID,second.data.itemID);
 assert.equal(Object.keys(mod.exports.readItems()).length,2);
 assert.equal(mod.exports.grantUniqueNpcDepotItem(input).data.existing,true);
 assert.equal(Object.keys(mod.exports.readItems()).length,2);
 assert.equal(mod.exports.findWarehouseItem({cargoID:55}).quantity,100);
 assert.equal(mod.exports.grantUniqueNpcDepotItem({...input,quantity:999}).errorMsg,'NATIVE_WAREHOUSE_TAG_COLLISION');
 assert.equal(mod.exports.grantUniqueNpcDepotItem({...input,quantity:1000000}).errorMsg,'INVALID_NATIVE_WAREHOUSE_GRANT');
 const forged={...mod.exports.readItems()[String(first.data.itemID)],itemID:9000};
 mod.exports.readItems()['9000']=forged;
 assert.throws(()=>mod.exports.findWarehouseItem({cargoID:55}),/DUPLICATE_NATIVE_ITEM_TAG/);
});