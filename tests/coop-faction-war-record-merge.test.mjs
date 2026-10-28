import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {empty,validateState,mergeWarRecords}=require("../integration/coopFactionWarCore.cjs");

// Every war phase reads the whole state, changes one thing and writes the whole state
// back. The write is unconditional, so a phase that read a moment before another one
// wrote would put its older copy over the newer one. Measured on the live world: the
// opening published "war opened" every 30 seconds while the durable row kept answering
// with the same four campaigns - the new campaign was erased by the next phase.
const campaign=(id,state="PREPARING")=>({campaignID:id,state,startedAt:1000,revision:1,
 objectiveEvidence:[]});

test("a stale writer cannot erase a campaign it never saw",()=>{
 const before=empty();
 before.campaigns["c1"]=campaign("c1");
 const staleWriter={...structuredClone(before)};            // read before c2 existed
 const freshWriter=structuredClone(before);
 freshWriter.campaigns["c2"]=campaign("c2");
 const merged=mergeWarRecords(freshWriter,staleWriter);
 assert.ok(merged.campaigns.c2,"the campaign added by the other writer survives");
 assert.ok(merged.campaigns.c1);
});

test("the caller's own change still wins for a record both of them carry",()=>{
 const before=empty();
 before.campaigns["c1"]=campaign("c1","PREPARING");
 const stale={...structuredClone(before)};
 const next=structuredClone(before);
 next.campaigns["c1"]={...campaign("c1","ASSAULT"),revision:2};
 // The caller's copy wins for a record both carry, so a real transition is never reverted.
 const merged=mergeWarRecords(stale,next);
 assert.equal(merged.campaigns.c1.state,"ASSAULT","the newer transition is not reverted");
 assert.equal(merged.campaigns.c1.revision,2);
});

test("wars merge the same way, so a declared war cannot disappear",()=>{
 const before=empty();
 before.wars["w1"]={warID:"w1",state:"ACTIVE"};
 const stale={...structuredClone(before)};
 const next=structuredClone(before);
 next.wars["w2"]={warID:"w2",state:"ACTIVE"};
 const merged=mergeWarRecords(stale,next);
 assert.deepEqual(Object.keys(merged.wars).sort(),["w1","w2"]);
});

test("territories are NOT merged: releasing ground must still be able to remove one",()=>{
 const before=empty();
 before.territories["30003837"]={systemID:30003837,state:"SECURE",revision:1};
 const stale={...structuredClone(before)};
 const next=structuredClone(before);
 delete next.territories["30003837"];                        // bootstrap release
 const merged=mergeWarRecords(stale,next);
 assert.equal(merged.territories["30003837"],undefined,
  "a released territory stays released");
});

test("a merged state is still a valid war record",()=>{
 const before=empty();
 before.campaigns["c1"]=campaign("c1");
 const merged=mergeWarRecords({...structuredClone(before),
  campaigns:{...before.campaigns,c2:campaign("c2")}},before);
 assert.equal(validateState(merged),true);
 assert.equal(mergeWarRecords(null,before),before,"no stored record: write what we have");
});
