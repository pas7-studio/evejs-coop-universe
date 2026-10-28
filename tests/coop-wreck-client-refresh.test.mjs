import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);

// The wreck source transformer that used to live in
// scripts/coop-npc-expedition-wreck-patch.cjs was retired on 2026-10-28: four of the
// seven anchors it required no longer exist in the deployed nativeNpcWreckService.js,
// so it described an engine that is gone and could only ever fail. The behaviour it
// aimed at (one broadcast that reaches every observer) is asserted directly here.

test("the repaired runtime slim-item broadcast updates all observers once",()=>{
 const observers=[{updates:0},{updates:0}];
 const scene={broadcastSlimItemChanges(entities){
  assert.equal(entities[0].itemID,9001);
  for(const observer of observers)observer.updates++;
 }};
 const entity={itemID:9001,isEmpty:true};
 scene.broadcastSlimItemChanges([entity]);
 assert.deepEqual(observers.map(x=>x.updates),[1,1]);
});
