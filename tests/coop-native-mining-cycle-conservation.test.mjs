import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {settle}=require("../integration/coopNativeMiningCycleConservation.cjs");
const {patch}=require("../scripts/coop-native-mining-cycle-conservation-patch.cjs");
function harness(t,overrides={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"alife06-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const old={...process.env};
 t.after(()=>{if(old.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY===undefined)
   delete process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY;
  else process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY=old.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY;
  if(old.EVEJS_COOP_MINING_CYCLE_JOURNAL_DIR===undefined)
   delete process.env.EVEJS_COOP_MINING_CYCLE_JOURNAL_DIR;
  else process.env.EVEJS_COOP_MINING_CYCLE_JOURNAL_DIR=old.EVEJS_COOP_MINING_CYCLE_JOURNAL_DIR;});
 process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY="1";
 process.env.EVEJS_COOP_MINING_CYCLE_JOURNAL_DIR=dir;
 const scene={systemID:30000144},entity={itemID:980000000001},targetEntity={itemID:400001};
 let source={yieldTypeID:34,remainingQuantity:100};
 const sequence=[];
 const input={scene,entity,targetEntity,mineableState:{...source},
  miningResult:{normalQuantity:6,wastedQuantity:2},transferredQuantity:6,
  cycleBoundaryMs:1710000000000,
  debit:()=>{sequence.push("debit");source={...source,remainingQuantity:92};return{success:true,data:{}};},
  credit:()=>{sequence.push("credit");return true;},
  readState:()=>({...source}),...overrides};
 const filename=path.join(dir,"alife06-30000144-400001-980000000001.json");
 return {input,entity,scene,targetEntity,sequence,dir,filename,getSource:()=>source,
  setSource:x=>source={...source,...x}};
}
test("positive source debit is verified before native cargo credit and journal committed",t=>{
 const f=harness(t);
 const r=settle(f.input);
 assert.equal(r.success,true);
 assert.deepEqual(f.sequence,["debit","credit"]);
 assert.equal(r.receipt.qty,6);assert.equal(r.receipt.consumed,8);
 const saved=JSON.parse(fs.readFileSync(f.filename,"utf8"));
 assert.equal(saved.status,"COMMITTED");assert.equal(saved.afterRock,92);
});
test("consecutive verified cycles may proceed from exact prior rock state",t=>{
 const f=harness(t);
 assert.equal(settle(f.input).success,true);
 f.input.mineableState.remainingQuantity=92;
 f.input.cycleBoundaryMs++;
 f.input.debit=()=>{f.sequence.push("debit2");f.setSource({remainingQuantity:84});return {success:true};};
 assert.equal(settle(f.input).success,true);
 assert.equal(JSON.parse(fs.readFileSync(f.filename)).afterRock,84);
});
test("failure or ambiguity in source debit never mints cargo",t=>{
 const f=harness(t,{debit:()=>({success:false})});
 assert.equal(settle(f.input).success,false);
 assert.deepEqual(f.sequence,[]);
 assert.equal(f.entity.coopMiningCargoNeedsOperatorRepair,"ALIFE06_DEBIT_REJECTED");
 assert.equal(JSON.parse(fs.readFileSync(f.filename)).status,"UNCERTAIN");
});
test("source threw after possible depletion: journal survives; restarted actor cannot replay",t=>{
 const f=harness(t,{debit:()=>{throw Error("after source commit")}});
 assert.equal(settle(f.input).success,false);
 const restored={...f.input,entity:{itemID:f.entity.itemID}};
 assert.equal(settle(restored).success,false);
 assert.equal(restored.entity.coopMiningCargoNeedsOperatorRepair,"ALIFE06_UNRESOLVED_SOURCE_OR_SHIP");
 assert.equal(JSON.parse(fs.readFileSync(f.filename)).reason,"DEBIT_THROW");
});
test("write of ore fails after depletion: durable unresolved journal and local repair latch",t=>{
 const f=harness(t,{credit:()=>false});
 assert.equal(settle(f.input).success,false);
 assert.equal(f.getSource().remainingQuantity,92);
 assert.equal(f.entity.coopMiningCargoNeedsOperatorRepair,"ALIFE06_CARGO_REJECTED");
 assert.equal(JSON.parse(fs.readFileSync(f.filename)).status,"UNCERTAIN");
});
test("credit exception is not retried by same or new actor",t=>{
 const f=harness(t,{credit:()=>{throw Error("unknown");}});
 assert.equal(settle(f.input).success,false);
 const restarted={...f.input,entity:{itemID:f.entity.itemID}};
 assert.equal(settle(restarted).success,false);
 assert.equal(JSON.parse(fs.readFileSync(f.filename)).reason,"CARGO_THROW");
});
test("source readback mismatch never credits cargo",t=>{
 const f=harness(t,{readState:()=>({remainingQuantity:100,yieldTypeID:34})});
 assert.equal(settle(f.input).success,false);
 assert.deepEqual(f.sequence,["debit"]);
 assert.equal(JSON.parse(fs.readFileSync(f.filename)).reason,"DEBIT_READBACK");
});
test("strict cargo flag must be ON before any source debit",t=>{
 const f=harness(t);delete process.env.EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY;
 assert.equal(settle(f.input).success,false);
 assert.deepEqual(f.sequence,[]);
 assert.equal(fs.existsSync(f.filename),false);
});
test("missing or relative journal dir blocks before source mutation",t=>{
 const f=harness(t);process.env.EVEJS_COOP_MINING_CYCLE_JOURNAL_DIR="relative-path";
 assert.equal(settle(f.input).success,false);
 assert.equal(f.sequence.length,0);
});
test("missing source quantity, overdraw and bad identity are all rejected pre-mutation",t=>{
 const f=harness(t);
 for (const change of [{mineableState:{yieldTypeID:34,remainingQuantity:0}},
  {miningResult:{normalQuantity:101,wastedQuantity:0}},
  {scene:{systemID:-1}},
  {transferredQuantity:-1}]){
  assert.equal(settle({...f.input,...change}).success,false);
 }
 assert.equal(f.sequence.length,0);
});
test("corrupt on-disk journal fails closed rather than silently resetting",t=>{
 const f=harness(t);
 fs.writeFileSync(f.filename,"{corrupt");
 assert.equal(settle(f.input).success,false);
 assert.equal(f.sequence.length,0);
 assert.equal(fs.readFileSync(f.filename,"utf8"),"{corrupt");
});
test("same-tick nonreentrant guard blocks recursive source debit",t=>{
 let inner;
 const f=harness(t,{debit:()=>{inner=settle(f.input);return {success:false};}});
 assert.equal(settle(f.input).success,false);
 assert.equal(inner.success,false);
 assert.equal(inner.reason,"ALIFE06_CYCLE_REENTRANT");
});
const runtime=[
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
const state=[
 'function writePersistedState(scene, state, options = {}) {',
 '  repo.write(',
 '    MINING_RUNTIME_TABLE,',
 '    `/systems/${String(toInt(scene && scene.systemID, 0))}/entities/${String(toInt(state && state.entityID, 0))}`,',
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
for(const [name,source] of [["miningRuntime.js",runtime],["miningRuntimeState.js",state]]) {
 for(const orig of [source,source.replace(/\n/g,"\r\n")]) {
  test(name+" original pinned anchors are reversible "+(orig.includes("\r")?"CRLF":"LF"),()=>{
   const pathName="server/src/services/mining/"+name;
   const once=patch(orig,pathName);
   assert.notEqual(once,orig);
   assert.equal(patch(once,pathName),once);
   assert.equal(patch(once,pathName,true),orig);
   assert.equal(patch(orig,pathName,true),orig);
  });
 }
}
test("wiring deploys cycle helper and modifies both stock mining authorities",()=>{
 const src=fs.readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 assert.match(src,/coopNativeMiningCycleConservation/);
 assert.match(src,/coop-native-mining-cycle-conservation-patch/);
 assert.match(src,/server\/src\/services\/mining\/miningRuntimeState\.js/);
 assert.match(src,/server\/src\/services\/mining\/miningRuntime\.js/);
});

test("unresolved asteroid debit blocks another miner on the same rock after restart",t=>{
 const f=harness(t,{credit:()=>false});
 assert.equal(settle(f.input).success,false);
 const other={...f.input,entity:{itemID:980000000002}};
 assert.equal(settle(other).success,false);
 assert.equal(other.entity.coopMiningCargoNeedsOperatorRepair,"ALIFE06_UNRESOLVED_SOURCE_OR_SHIP");
});
test("unresolved ship journal blocks a different asteroid after restart",t=>{
 const f=harness(t,{credit:()=>false});
 assert.equal(settle(f.input).success,false);
 const another={...f.input,entity:{itemID:f.entity.itemID},
   targetEntity:{itemID:400002}};
 assert.equal(settle(another).success,false);
 assert.equal(another.entity.coopMiningCargoNeedsOperatorRepair,"ALIFE06_UNRESOLVED_SOURCE_OR_SHIP");
});
test("other miner depletion between committed ticks is allowed, never rock restoration",t=>{
 const f=harness(t);
 assert.equal(settle(f.input).success,true);
 f.input.mineableState.remainingQuantity=88;
 f.setSource({remainingQuantity:88});
 f.input.debit=()=>{f.setSource({remainingQuantity:80});return{success:true}};
 assert.equal(settle(f.input).success,true);
 f.input.mineableState.remainingQuantity=99;
 assert.equal(settle({...f.input,entity:{itemID:f.entity.itemID}}).success,false);
});
