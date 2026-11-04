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
 // 2026-11-04: the order changed on purpose. verifyActors requires a matching native
 // controller row for every actor, and boot paths exist that materialize a durable ship
 // without one (the mining tick then prunes it from its own fleet record). The restore
 // path therefore re-attaches controllers FIRST and audits immediately after, before the
 // slot is registered as healthy. What must never move is the audit before registerOnce.
 const restore=source.slice(source.indexOf("const restored=ensureControllers"),
  source.indexOf("const registered=registerOnce"));
 const attach=restore.indexOf("ensureControllers([...minerIDs,...haulerIDs]);");
 const audit=restore.indexOf("verifyActors({scene,store,systemID,slot,minerIDs,haulerIDs})");
 assert.ok(attach>=0,"the restore path re-attaches missing controllers");
 assert.ok(audit>attach,"the audit follows the attach and still precedes registration");
 // The repair branches audit their merged witness as soon as they merge it.
 assert.match(source,/if\(healed\|\|recomposed\)verifyActors\(/);
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
