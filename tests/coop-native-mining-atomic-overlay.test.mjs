import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
const require=createRequire(import.meta.url);
const {patch:stage6}=require("../scripts/coop-native-mining-cycle-conservation-patch.cjs");
const {patch:stage7}=require("../scripts/coop-native-mining-atomic-source-patch.cjs");
const {assertTables}=require("../integration/coopGameStoreAtomic.cjs");
const root=path.resolve(import.meta.dirname,"..");
const src=p=>fs.readFileSync(path.join(root,p),"utf8");
const runtime=[
 'function appendNpcCargo(entity,typeID,quantity){',
 '  const miningNpcOperations = require("./miningNpcOperations");',
 '  miningNpcOperations.appendNpcMiningCargo(entity, typeID, quantity);',
 '}',
 'function executeMiningCycle(scene, entity, effectState, cycleBoundaryMs) {',
 '  const transferredQuantity = miningResult.getTotalTransferredQuantity();',
 '  if (transferredQuantity <= 0 && miningResult.wastedQuantity <= 0) {',
 '    return { success: false, stopReason: "cargo" };',
 '  }',
 '  if (isNativeNpcEntity(entity)) {',
 '    appendNpcCargo(entity, mineableState.yieldTypeID, transferredQuantity);',
 '  } else {',
 '    grantItemsToCharacterLocation();',
 '  }',
 '  const deltaResult = applyMiningDelta(',
 '    scene, targetEntity, miningResult.normalQuantity, miningResult.wastedQuantity);',
 '  if (!deltaResult.success) return {success:false};',
 '}',
].join("\n");
const sourceLine='    '+String.fromCharCode(96)+
 '/systems/'+'$'+'{String(toInt(scene && scene.systemID, 0))}/entities/'+'$'+
 '{String(toInt(state && state.entityID, 0))}'+String.fromCharCode(96)+',';
const state=[
 'function writePersistedState(scene, state, options = {}) {',
 '  repo.write(',
 '    MINING_RUNTIME_TABLE,',
 sourceLine,
 '    cloneValue(state),',
 '  );',
 '}',
 'function updateMineableState(scene,entity,nextState,options={}) {',
 '  const normalizedState=normalizeStateRecord(nextState);',
 '  if (shouldPersistMineableState(entity)) {',
 '    writePersistedState(scene, normalizedState, {',
 '      existingPersistedState:',
 '        cache.persistedByEntityID[String(normalizedState.entityID)] || null,',
 '      persistBaseline: true,',
 '    });',
 '  }',
 '  cache.byEntityID.set(normalizedState.entityID, normalizedState);',
 '}',
].join("\n");
for(const [file,original] of [["miningRuntime.js",runtime],["miningRuntimeState.js",state]]) {
 for(const mode of ["LF","CRLF"]) {
  test("ALIFE-07 "+file+" "+mode+" is reversible",()=>{
   const orig=mode==="LF"?original:original.replace(/\n/g,"\r\n");
   const name="server/src/services/mining/"+file;
   const six=stage6(orig,name),seven=stage7(six,name);
   assert.notEqual(seven,six);
   assert.equal(stage7(seven,name),seven);
   assert.equal(stage6(stage7(seven,name,true),name,true),orig);
   new Function(seven);
  });
 }
}
test("atomic path is native-only, never double-credits cargo",()=>{
 const result=stage7(stage6(runtime,"server/src/services/mining/miningRuntime.js"),
  "server/src/services/mining/miningRuntime.js");
 assert.match(result,/coopNativeMiningAtomic/);
 assert.match(result,/coopNativeAtomicCommitConfirmed:true/);
 assert.match(result,/if \(!coopStrictNative\) appendNpcCargo/);
});
test("existing SQLite rows permitted but virtual economy table forbidden",()=>{
 assert.deepEqual(assertTables(["miningRuntimeState","npcCargo"]),
  ["miningRuntimeState","npcCargo"]);
 assert.throws(()=>assertTables(["miningVirtualInventory"]),/ALLOWLIST/);
});
test("installer wires both modules without touching player mining",()=>{
 const s=src("scripts/patch-evejs-coop.cjs");
 assert.match(s,/coopNativeMiningAtomic/);
 assert.match(s,/coop-native-mining-atomic-source-patch/);
});
test("strict mining uses four explicit feature flags",()=>{
 const s=src("integration/coopNativeMiningAtomic.cjs");
 for(const flag of ["EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC",
   "EVEJS_COOP_NATIVE_ATOMIC_ROWS",
   "EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION",
   "EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY"])
  assert.ok(s.includes(flag));
});
test("SQLite transactor demands durable FULL WAL sync",()=>{
 const s=src("integration/coopGameStoreAtomic.cjs");
 assert.match(s,/db\.exec\("PRAGMA synchronous = FULL"\)/);
 assert.match(s,/ALIFE07_SQLITE_DURABILITY_NOT_FULL/);
});
