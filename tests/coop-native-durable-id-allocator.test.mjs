import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import vm from "node:vm";
const require=createRequire(import.meta.url);
const {transform,specs}=require("../scripts/patch-evejs-coop.cjs");
const spec=specs.find(s=>s.file==="server/src/space/npc/nativeNpcStore.js");
const allocatorSource=`
const TABLE={ENTITIES:"npcEntities"};
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
  );
  const updatedRoot = {...root,[counterKey]:nextID+1};
  const writeResult = writeRoot(tableName,updatedRoot);
  if(!writeResult.success)return {success:false,errorMsg:writeResult.errorMsg};
  return {
    success: true,
    data: nextID,
  };
}
({allocate:(transient)=>allocateID("npcEntities","nextEntityID",{transient}),
 root:()=>root,transientCounters,fail:()=>{shouldFail=true}});
`;
function evaluator(source){
 const context={};
 const result=vm.runInNewContext(source,context);
 return result;
}
test("mixed transient and durable native IDs never collide while co-op mining fleet exists",()=>{
 const a=evaluator(transform(allocatorSource,spec,false));
 const t1=a.allocate(true).data,t2=a.allocate(true).data,p1=a.allocate(false).data;
 const t3=a.allocate(true).data,p2=a.allocate(false).data;
 assert.deepEqual([t1,t2,p1,t3,p2],[980000000000,980000000001,
  980000000002,980000000003,980000000004]);
 assert.equal(a.root().nextEntityID,980000000005);
});
test("persistent ID allocated first updates transient high-watermark",()=>{
 const a=evaluator(transform(allocatorSource,spec,false));
 assert.equal(a.allocate(false).data,980000000000);
 assert.equal(a.allocate(true).data,980000000001);
 assert.equal(a.allocate(false).data,980000000002);
});
test("a failed persistent store write does not advance allocator or mint a phantom NPC",()=>{
 const a=evaluator(transform(allocatorSource,spec,false));
 assert.equal(a.allocate(true).data,980000000000);
 a.fail();
 assert.equal(a.allocate(false).success,false);
 assert.equal(a.root().nextEntityID,980000000000);
});
test("allocator overlay applies idempotently and exactly restores source",()=>{
 assert.ok(spec);
 const patched=transform(allocatorSource,spec,false);
 assert.equal(transform(patched,spec,false),patched);
 assert.equal(transform(patched,spec,true),allocatorSource);
 assert.ok(patched.includes("transientCounters[tableName] = Math.max"));
});
