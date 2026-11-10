'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,F}=require('./fixture.cjs');
const {createPermitVerifier}=require('../native/coopPersonalFleetOriginalNativePermit.cjs');
function withPermit(fn){const t=F.tempDb(),f=setup(t.file);try{
 f.prepare();const verifier=createPermitVerifier({gameStore:f.gameStore,
  enabled:()=>f.shared.enabled,allWritersFenced:()=>f.shared.writers});
 const entity=()=>({personalFleetOriginal:true,entityID:F.SHIP,systemID:F.SYSTEM,
 ownerID:F.OWNER,typeID:606,personalFleetGeneration:1,
 personalFleetAssignmentID:F.ASSIGNMENT,personalFleetPilotID:F.PILOT});
 return fn({f,verifier,entity});}finally{f.close();t.cleanup();}}
test('PF58 native materializer cannot accept a mere PF54 PREPARED row',()=>withPermit(({verifier,entity})=>{
 assert.equal(verifier.verify({entityRecord:entity(),allowIssuing:true}),false);
}));
test('PF58 native materializer accepts explicit ISSUING only with consumed permit',()=>withPermit(({f,verifier,entity})=>{
 f.pending();assert.equal(verifier.verify({entityRecord:entity(),allowIssuing:true}),true);
 assert.equal(verifier.verify({entityRecord:entity()}),false);
}));
test('PF58 ordinary startup accepted only with original PF54 ACTIVE and actor claim',()=>withPermit(({f,verifier,entity})=>{
 f.pending();assert.equal(f.bridge.reconcile(f.c).status,'ACTIVE');
 assert.equal(verifier.verify({entityRecord:entity()}),true);
}));
test('PF58 native materialization refuses fake actor owner',()=>withPermit(({f,verifier,entity})=>{
 f.pending();f.bridge.reconcile(f.c);
 assert.equal(verifier.verify({entityRecord:{...entity(),ownerID:77}}),false);
}));
test('PF58 native materialization refuses wrong assignment generation',()=>withPermit(({f,verifier,entity})=>{
 f.pending();f.bridge.reconcile(f.c);
 assert.equal(verifier.verify({entityRecord:{...entity(),personalFleetGeneration:2}}),false);
}));
test('PF58 native materialization refuses deleted global handoff ship lock',()=>withPermit(({f,verifier,entity})=>{
 f.pending();f.bridge.reconcile(f.c);
 f.put('corporationRuntime','coop-personal-fleet\u001fhandoff-ship-v1:'+F.SHIP,null);
 assert.equal(verifier.verify({entityRecord:entity()}),false);
}));
test('PF58 native materialization refuses revoked writer fence',()=>withPermit(({f,verifier,entity})=>{
 f.pending();f.bridge.reconcile(f.c);f.shared.writers=false;
 assert.equal(verifier.verify({entityRecord:entity()}),false);
}));
test('PF58 native materialization refuses revoked feature flag',()=>withPermit(({f,verifier,entity})=>{
 f.pending();f.bridge.reconcile(f.c);f.shared.enabled=false;
 assert.equal(verifier.verify({entityRecord:entity()}),false);
}));
test('PF58 native materialization refuses moved/docked original ship',()=>withPermit(({f,verifier,entity})=>{
 f.pending();f.bridge.reconcile(f.c);
 const items=f.get('items','items');items[F.SHIP].flagID=4;
 f.put('items','items',items);
 assert.equal(verifier.verify({entityRecord:entity()}),false);
}));
test('PF58 native materialization refuses missing real claim after PF54 ACTIVE',()=>withPermit(({f,verifier,entity})=>{
 f.pending();f.bridge.reconcile(f.c);
 f.put('corporationRuntime','coop-personal-fleet\u001factor-claims-v1',null);
 assert.equal(verifier.verify({entityRecord:entity()}),false);
}));
test('PF58 native materialization refuses arbitrary malformed entity',()=>withPermit(({verifier})=>{
 assert.equal(verifier.verify({entityRecord:{}}),false);
}));
test('PF58 native binding requires explicit install; default cannot authorize',()=>{
 const bindings=require('../native/coopPersonalFleetNativeBindings.cjs');
 assert.equal(bindings.authorize({personalFleetOriginal:true}),false);
 assert.equal(bindings.isInstalled(),false);
 assert.throws(()=>bindings.install({}),/AUTHORITIES_REQUIRED/);
 const proof={verify:()=>true};
 assert.equal(bindings.install({permitVerifier:proof,featureEnabled:()=>true,
  allWritersFenced:()=>true}),true);
 assert.equal(bindings.authorize({}),true);
 assert.throws(()=>bindings.install({permitVerifier:proof,featureEnabled:()=>true,
  allWritersFenced:()=>true}),/ALREADY_INSTALLED/);
});
