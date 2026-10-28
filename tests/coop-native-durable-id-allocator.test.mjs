import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {engineSource, skipWithoutEngine} from "./_support/engineCheckout.mjs";

// The native ID allocator fix is committed in the fork, so the deployed
// nativeNpcStore.js already contains it. Two things are worth pinning:
//   1. the algorithm - a transient (co-op) id and a persistent id must never
//      collide, and a failed store write must not advance either counter;
//   2. that the deployed file still carries exactly those three guards.
// This used to run the legacy transform over a hand-written copy of the stock code.
// When the fix moved into the fork the transform became a no-op and the test failed
// for a reason that had nothing to do with the allocator, so the copy below is the
// algorithm as it ships and the last case ties it back to the real file.
const allocatorSource = `
const ROOT={npcEntities:{nextEntityID:980000000000}};
let root={nextEntityID:980000000000};
const transientCounters={npcEntities:null};
const toPositiveInt=(v,fallback=0)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):fallback;
const ensureRootShape=()=>({...root});
let shouldFail=false;
const writeRoot=(table,updated)=>{if(shouldFail)return {success:false,errorMsg:"DISK_ERROR"};root=updated;return {success:true}};
function allocateID(tableName,counterKey,options={}){
  if (options.transient === true) {
    if (!Number.isInteger(transientCounters[tableName])) {
      const root = ensureRootShape(tableName);
      transientCounters[tableName] = Math.max(
        toPositiveInt(root && root[counterKey], 0),
        toPositiveInt(ROOT[tableName] && ROOT[tableName][counterKey], 0),
      );
    }
    const nextID = transientCounters[tableName];
    transientCounters[tableName] += 1;
    return {success:true,data:nextID};
  }
  const root = ensureRootShape(tableName);
  const nextID = Math.max(
    toPositiveInt(root && root[counterKey], 0),
    toPositiveInt(ROOT[tableName] && ROOT[tableName][counterKey], 0),
    Number.isSafeInteger(transientCounters[tableName]) ? transientCounters[tableName] : 0,
  );
  const updatedRoot = {...root,[counterKey]:nextID+1};
  const writeResult = writeRoot(tableName,updatedRoot);
  if (!writeResult.success) return {success:false,errorMsg:writeResult.errorMsg || "NPC_NATIVE_ID_ALLOCATE_FAILED"};
  if (Number.isSafeInteger(transientCounters[tableName]))
    transientCounters[tableName] = Math.max(transientCounters[tableName], nextID + 1);
  return {success:true,data:nextID};
}
({allocate:(transient)=>allocateID("npcEntities","nextEntityID",{transient}),
 root:()=>root,transientCounters,fail:()=>{shouldFail=true}});
`;

const evaluator = (source) => vm.runInNewContext(source, {});

test("mixed transient and durable native IDs never collide while co-op mining fleet exists", () => {
  const a = evaluator(allocatorSource);
  const t1 = a.allocate(true).data, t2 = a.allocate(true).data, p1 = a.allocate(false).data;
  const t3 = a.allocate(true).data, p2 = a.allocate(false).data;
  assert.deepEqual([t1, t2, p1, t3, p2], [980000000000, 980000000001, 980000000002, 980000000003, 980000000004]);
  assert.equal(a.root().nextEntityID, 980000000005);
});

test("persistent ID allocated first updates transient high-watermark", () => {
  const a = evaluator(allocatorSource);
  assert.equal(a.allocate(false).data, 980000000000);
  assert.equal(a.allocate(true).data, 980000000001);
  assert.equal(a.allocate(false).data, 980000000002);
});

test("a failed persistent store write does not advance allocator or mint a phantom NPC", () => {
  const a = evaluator(allocatorSource);
  assert.equal(a.allocate(true).data, 980000000000);
  a.fail();
  assert.equal(a.allocate(false).success, false);
  assert.equal(a.root().nextEntityID, 980000000000);
});

test("the deployed allocator still carries all three guards", (t) => {
  if (skipWithoutEngine(t)) return;
  const source = engineSource("server/src/space/npc/nativeNpcStore.js");
  const flat = source.replace(/\s+/g, " ");
  // A transient allocation seeds from the durable counter...
  assert.match(flat, /transientCounters\[tableName\] = Math\.max\(/);
  // ...a durable allocation reads the transient high-watermark...
  assert.match(flat, /Number\.isSafeInteger\(transientCounters\[tableName\]\) \? transientCounters\[tableName\] : 0/);
  // ...and the store is written before anything is considered allocated.
  assert.match(flat, /const writeResult = writeRoot\(tableName, updatedRoot\);/);
  assert.match(flat, /if \(!writeResult\.success\)/);
});
