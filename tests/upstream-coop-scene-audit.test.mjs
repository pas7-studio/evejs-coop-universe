// Runs the read-only scene audit against a scene obtained from real EveJS runtime.
// Uses in-memory synthetic sessions only: not protocol, network or gameplay acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { auditCoopScene } from '../scripts/coop-scene-audit.mjs';

if(!process.env.EVEJS_CODE_PATH)throw new Error('EVEJS_CODE_PATH required');
process.env.EVEJS_SKIP_NPC_STARTUP='1';
process.env.EVEJS_DISABLE_NPC_ANCHOR_RELEVANCE='1';
const require=createRequire(import.meta.url);
const runtime=require(resolve(process.env.EVEJS_CODE_PATH,'server/src/space/runtime'));
const registry=require(resolve(process.env.EVEJS_CODE_PATH,'server/src/services/chat/sessionRegistry.js'));
const pilot=(clientID,characterID,shipID,visible)=>({clientID,characterID,socket:{destroyed:false},_space:{shipID,initialStateSent:true,visibleDynamicEntityIDs:new Set(visible)}});
test('actual EveJS scene stores two distinct pilot identities and visible ships',()=>{
  runtime._testing.clearScenes();
  const scene=runtime.ensureScene(30000142,{refreshStargates:false});
  const a=pilot(701,1701,9701,[9702]);
  const b=pilot(702,1702,9702,[9701]);
  const shipA={itemID:9701,kind:'ship'}, shipB={itemID:9702,kind:'ship'};
  scene.sessions.set(a.clientID,a);scene.sessions.set(b.clientID,b);
  scene.dynamicEntities.set(shipA.itemID,shipA);scene.dynamicEntities.set(shipB.itemID,shipB);
  registry.register(a);registry.register(b);
  try {
    const before=auditCoopScene(scene,{registryLookup:registry.findSessionByCharacterID});
    assert.equal(before.status,'PASS',JSON.stringify(before.findings));
    assert.equal(before.livePilotCount,2);
    a.socket.destroyed=true;
    const stale=auditCoopScene(scene,{registryLookup:registry.findSessionByCharacterID});
    assert.equal(stale.status,'FAIL');
    assert.ok(stale.findings.some(x=>x.code==='STALE_SESSION'));
    scene.sessions.delete(a.clientID);registry.unregister(a);
    const a2=pilot(703,1701,9701,[9702]);
    scene.sessions.set(a2.clientID,a2);registry.register(a2);
    try {
      const rejoined=auditCoopScene(scene,{registryLookup:registry.findSessionByCharacterID});
      assert.equal(rejoined.status,'PASS',JSON.stringify(rejoined.findings));
      assert.deepEqual(rejoined.pilots.map(x=>x.characterID).sort(),[1701,1702]);
    } finally { scene.sessions.delete(a2.clientID);registry.unregister(a2); }
  } finally {
    scene.sessions.delete(a.clientID);scene.sessions.delete(b.clientID);
    scene.dynamicEntities.delete(9701);scene.dynamicEntities.delete(9702);
    registry.unregister(a);registry.unregister(b);runtime._testing.clearScenes();
  }
});
