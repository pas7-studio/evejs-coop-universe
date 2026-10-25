import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,inventoryPath,tradePath}=require("../scripts/coop-native-trade-custody-patch.cjs");
const installer=require("../scripts/patch-evejs-coop.cjs");

test("P0 custody hook registered in current native overlay without replacing atomic trade or dialogue",()=>{
 for(const file of [inventoryPath,tradePath])
  assert.ok(installer.specs.some(x=>x.file===file));
 const installed=fs.readFileSync(path.join(import.meta.dirname,"../scripts/patch-evejs-coop.cjs"),"utf8");
 assert.match(installed,/"coopNativeTradeCustody"/);
 assert.match(installed,/coop-native-trade-custody-patch\.cjs/);
 assert.match(installed,/coop-atomic-trade-patch\.cjs/);
 assert.match(installed,/coop-agent-dialogue-patch\.cjs/);
 const deploy=fs.readFileSync(path.join(import.meta.dirname,"../scripts/Deploy-Coop-RuntimeProbe.ps1"),"utf8");
 assert.match(deploy,/\[switch\]\$EnableAtomicCoopTrade/);
 assert.match(deploy,/if \(\$EnableAtomicCoopTrade\)/);
 assert.match(deploy,/EVEJS_COOP_ATOMIC_TRADE: '1'/);
});
const codePath=process.env.EVEJS_COOP_CODE_PATH||"";
for(const file of [inventoryPath,tradePath]){
 test("P0 official pinned source roundtrip remains byte-exact after custody and atomic hooks: "+file,
  {skip:!codePath||!fs.existsSync(path.join(codePath,file))},()=>{
   const source=fs.readFileSync(path.join(codePath,file),"utf8");
   const spec=installer.specs.find(x=>x.file===file);
   const first=installer.transform(source,spec,false);
   assert.notEqual(first,source);
   assert.equal(installer.transform(first,spec,false),first);
   assert.equal(installer.transform(first,spec,true),source);
  });
}
test("P0 custody patch helper rejects partial installs and preserves native sources without double insertion",()=>{
 const method='  _stageItemIntoTrade(trade, session, itemID, sourceLocationID, quantity = null) {';
 const next='  _resolveSourceAccessibility(item, session)';
 const raw=[
  'class Example {',
  '    this._tradeOrdinal = 1;',
  '    trade.status = "aborted";',
  method,
  '    const moveResult = moveItemToLocation(',
  '    this._notifyChangeList(trade, changes);',
  '  }',
  next,
  '  Handle_InitiateTrade(args, session) {',
  '  }',
  '    trade.status = "completed";',
  '}'
 ].join("\n");
 const patched=patch(raw,tradePath);
 assert.match(patched,/coopNativeTradeCustody/);
 assert.equal(patch(patched,tradePath),patched);
 assert.equal(patch(patched,tradePath,true),raw);
 assert.throws(()=>patch(patched.replace(
  /.*coopNativeTradeCustody"\)\.afterStage.*\n/,""),tradePath),/PARTIAL_TRADE_CUSTODY_PATCH/);
});
