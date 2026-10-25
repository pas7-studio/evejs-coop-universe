import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const patcher=require('../scripts/patch-evejs-coop.cjs');
const {inventoryPath,tradePath}=require('../scripts/coop-atomic-trade-patch.cjs');
test('installer registers native itemStore and tradeMgr as pinned native hooks',()=>{
 for(const file of [inventoryPath,tradePath]){
  const spec=patcher.specs.find(s=>s.file===file);
  assert.ok(spec,`missing source spec ${file}`);
 }
 const deploy=fs.readFileSync(path.join(import.meta.dirname,'../scripts/Deploy-Coop-RuntimeProbe.ps1'),'utf8');
 assert.match(deploy,/\[switch\]\$EnableAtomicCoopTrade/);
 assert.match(deploy,/EVEJS_COOP_ATOMIC_TRADE: '1'/);
 assert.match(deploy,/if \(\$EnableAtomicCoopTrade\)/);
});
const codePath=process.env.EVEJS_COOP_CODE_PATH||'';
for(const file of [inventoryPath,tradePath]){
 const source=codePath?path.join(codePath,file):'';
 test(`pinned native source one-statement patch is byte-exact reversible: ${file}`,
  {skip:!codePath||!fs.existsSync(source)},()=>{
   const spec=patcher.specs.find(x=>x.file===file);
   const original=fs.readFileSync(source,'utf8');
   const patched=patcher.transform(original,spec,false);
   assert.notEqual(patched,original);
   assert.equal(patcher.transform(patched,spec,false),patched);
   assert.equal(patcher.transform(patched,spec,true),original);
  });
}