import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(
 new URL("../integration/coopNativeMiningFleetDurable.cjs",import.meta.url),"utf8");
// A blocked slot must never materialize a hull: the identity audit reads the
// persisted authority rows, so it has to run BEFORE any controller is attached.
// (Measured live: a slot whose hauler loses its runtime controller is pruned from
// the native fleet record while its hull, cargo and rows are all intact - that
// one is healed by the fleet-record adoption path, not by re-attaching first.)
test("the identity audit runs before any controller is attached",()=>{
 const restore=source.slice(source.indexOf("const healed=repairPartialSlot"),
  source.indexOf("const registered=registerOnce"));
 const audit=restore.indexOf("verifyActors({scene,store,systemID,slot,minerIDs,haulerIDs});");
 assert.ok(audit>0,"restore path audits the actors");
 const tail=restore.slice(audit);
 assert.ok(tail.indexOf("ensureControllers([...minerIDs,...haulerIDs]);")>0,
  "an unconditional controller attach follows the audit");
 // The only attach allowed before the audit belongs to the repair branch, which
 // already verified the merged witness against the native store.
 const head=restore.slice(0,audit);
 assert.equal((head.match(/ensureControllers\(\[/g)||[]).length,1);
 assert.match(head,/if\(healed\)\{/);
});
test("a slot blocked by the audit is never materialized",()=>{
 const catchBlock=source.slice(source.indexOf("}catch(error){",source.indexOf("const registered=registerOnce")));
 assert.match(catchBlock,/NEEDS_OPERATOR_REPAIR/);
 assert.doesNotMatch(catchBlock,/materializeStoredNativeController/);
});
// The slot status used to be invisible: start() was called without a log
// callback and the result was discarded, so a blocked slot looked healthy.
test("slot status is reported once per change and cannot throw",()=>{
 assert.match(source,/living-native-durable-slot/);
 assert.match(source,/const lastSlotStatus=new Map\(\)/);
 const helper=source.slice(source.indexOf("function noteSlotStatus"),source.indexOf("function slotKey"));
 assert.match(helper,/catch\(_error\)\{return;\}/);
 assert.match(helper,/if\(lastSlotStatus\.get\(key\)===signature\)continue;/);
 assert.match(source,/noteSlotStatus\(systemID,reports\);/);
});
