import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const repo=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const {patch:legacy,LINE,ANCHOR}=require('../scripts/coop-npc-market-buy-safety-patch.cjs');
const {patch:corporate,NEW}=require('../scripts/coop-npc-corporate-buy-patch.cjs');
const MARKET='server/src/services/market/marketProxyService.js';
const base='async function matchSellOrdersForBuyer() {\n'+ANCHOR+'\n}\n';

for(const eol of ['\n','\r\n']){
 test('COOP-034/035 composed buyer guard is idempotent, reversible ('+(eol==='\n'?'LF':'CRLF')+')',()=>{
  const pristine=base.replaceAll('\n',eol);
  const step1=legacy(pristine),step2=corporate(step1);
  assert.equal(legacy(step2),step2,'corporate replacement must satisfy old guard');
  assert.equal(corporate(legacy(step2)),step2,'full reapply must be stable');
  assert.equal(legacy(corporate(step2,{remove:true}),{remove:true}),pristine);
  assert.doesNotThrow(()=>new vm.Script(step2));
 });
}

test('a truncated corporate NPC market hook cannot masquerade as an installed guard',()=>{
 const complete=corporate(legacy(base));
 for(const damaged of [
  complete.replace('    // COOP-035 END','    // COOP-035 END-UNVERIFIED'),
  complete.replace('      totalBought += availableQuantity;','      // MISSING TOTAL BOUGHT UPDATE'),
  complete.replace(NEW,'    // COOP-035 native NPC corporate seller branch: incomplete'),
  base.replace(ANCHOR,'    // COOP-035 END\n'+ANCHOR),
 ])assert.throws(()=>legacy(damaged),/NPC_BUY_GUARD_CORPORATE_PATCH_DRIFT/);
});

test('original COOP-034 partial/double legacy hook remains rejected',()=>{
 assert.ok(legacy(base).includes(LINE));
 assert.throws(()=>legacy(legacy(base)),/NPC_BUY_GUARD_ALREADY_PATCHED/);
 assert.throws(()=>legacy(base.replace(ANCHOR,'return;')),/UPSTREAM_ANCHOR_MISMATCH/);
});

test('single overlay registers all five chat modules and keeps native routes separated',()=>{
 const {names,specs,PIN}=require('../scripts/patch-evejs-coop.cjs');
 const script=fs.readFileSync(path.join(repo,'scripts/patch-evejs-coop.cjs'),'utf8');
 assert.equal(PIN,'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f');
 for(const moduleName of ['coopNpcWeaponAmmoGate','coopNpcTactics','coopNativeScanProof',
  'coopMarketCancelCustody','coopMarketSellCustody','coopPlayerMarketFill',
  'coopPochvenConduit','coopWormholeJumpFence']){
  assert.equal(names.filter(n=>n===moduleName).length,1,moduleName);
 }
 for(const native of [MARKET,'server/src/space/transitions.js',
  'server/src/services/exploration/wormholes/wormholeMgrService.js',
  'server/src/services/exploration/scanMgrService.js',
  'server/src/services/ship/beyonceService.js'])
  assert.equal(specs.filter(s=>s.file===native).length,1,native);
 assert.equal(script.includes('if(spec.file==="server/src/space/runtime.js")if('),false,
  'accidental duplicated runtime conditional after concurrent merges');
 assert.equal(names.length,new Set(names).size,'no duplicate deployed modules');
});

test('actual pinned market and region/scan native overlays apply twice, then rollback byte-for-byte',t=>{
 const codePath=process.env.EVEJS_COOP_CODE_PATH;
 if(!codePath){t.skip('Requires an authorized local pristine pinned EveJS/Code checkout');return;}
 const {specs,transform}=require('../scripts/patch-evejs-coop.cjs');
 for(const native of [MARKET,'server/src/space/transitions.js',
  'server/src/services/exploration/wormholes/wormholeMgrService.js',
  'server/src/services/exploration/scanMgrService.js',
  'server/src/services/ship/beyonceService.js']){
  const spec=specs.find(s=>s.file===native);
  const existing=fs.readFileSync(path.join(codePath,native),'utf8');
  const pristine=transform(existing,spec,true);
  const applied=transform(pristine,spec,false);
  assert.equal(transform(applied,spec,false),applied,native+' reapply');
  assert.equal(transform(applied,spec,true),pristine,native+' rollback');
  assert.doesNotThrow(()=>new vm.Script(applied,{filename:native}));
 }
});
