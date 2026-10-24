import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {transform,specs}=require("../scripts/patch-evejs-coop.cjs");
const patch=specs.find(x=>x.file==="server/src/space/npc/nativeNpcWreckService.js");
const source=[
 'function refreshNativeWreckRuntimeEntity(systemID,wreckID,options={}) {',
 ' const scene={broadcastSlimItemChanges(){}};',
 ' const entity={itemID:wreckID};',
 ' if(options.broadcast===true){',
 '    scene.sendSlimItemChangesToAllSessions([entity]);',
 ' }',
 ' return {success:true};',
 '}',
 'function transferNativeWreckItemToCharacterLocation() {',
 ' const wreckRecord={systemID:30000142,wreckID:9001};',
 '  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID);',
 ' return true;',
 '}',
 'function destroyNativeNpcEntityWithWreck(){',
 ' const normalizedSystemID=30000142,entityID=12,wreckRecord={wreckID:9001},shipEntity=null,options=null,controller=null,scene=null;',
 '  try {',
 '    const dungeonUniverseSiteService = require(path.join("a","b"));',
 '  } catch(error) {}',
 '}'
].join("\n");
test("the pinned wreck source patch uses actual EveJS broadcastSlimItemChanges API",()=>{
 assert.ok(patch);
 const patched=transform(source,patch,false);
 assert.ok(patched.includes("scene.broadcastSlimItemChanges([entity]);"));
 assert.ok(!patched.includes("sendSlimItemChangesToAllSessions"));
 assert.ok(patched.includes("refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });"));
});
test("reversible native wreck patch can be reapplied and restored without damaging the pinned source",()=>{
 const patched=transform(source,patch,false);
 assert.equal(transform(patched,patch,false),patched);
 assert.equal(transform(patched,patch,true),source);
});
test("native wreck patch rejects ambiguous duplicate broadcaster definitions",()=>{
 const invalid=source.replace("    scene.sendSlimItemChangesToAllSessions([entity]);",
  "    scene.sendSlimItemChangesToAllSessions([entity]);\n    scene.sendSlimItemChangesToAllSessions([entity]);");
 assert.throws(()=>transform(invalid,patch,false),/Ambiguous native wreck client slim-item broadcast/);
});
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
