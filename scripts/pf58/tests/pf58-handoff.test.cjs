'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,F,api}=require('./fixture.cjs');
function withDb(callback){const t=F.tempDb();try{return callback(setup(t.file));}finally{t.cleanup();}}
function caseTest(name,change,expected){test(name,()=>withDb(f=>{try{
 f.prepare();change(f);const res=f.pending();
 if(expected==='BLOCKED')assert.equal(f.state.attempts,0);
 assert.equal(res.status,'AWAITING_NATIVE_RECONCILIATION');
 const locked=f.handoff.inspect({assignmentID:F.ASSIGNMENT});
 if(expected==='BLOCKED')assert.equal(locked.status,'NOT_FOUND');
 else assert.equal(locked.status,'CONSUMED');
}finally{f.close();}}));}
test('PF58 full PF53 -> PF52 -> PF54 -> PF58 -> PF54 reconcile reuses original itemID',()=>withDb(f=>{try{
 f.prepare();const res=f.pending();assert.equal(res.status,'AWAITING_NATIVE_RECONCILIATION');
 assert.equal(res.executorStatus,'REPORTED_COMPLETED');
 assert.equal(f.state.attempts,1);assert.equal(f.state.adoptions,1);
 const item=f.get('items','items')[F.SHIP];assert.equal(item.itemID,F.SHIP);
 assert.equal(item.locationID,F.SYSTEM);assert.equal(item.flagID,0);
 assert.equal(Object.keys(f.get('items','items')).length,1);
 const final=f.bridge.reconcile(f.c);assert.equal(final.status,'ACTIVE');
 assert.equal(final.shipItemID,F.SHIP);
 assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'CONSUMED');
 assert.equal(f.state.attempts,1);
}finally{f.close();}}));
test('dispatch same PF54 command twice cannot spawn twice',()=>withDb(f=>{try{
 f.prepare();assert.equal(f.pending().executorStatus,'REPORTED_COMPLETED');
 assert.equal(f.pending().status,'BLOCKED');assert.equal(f.state.attempts,1);
}finally{f.close();}}));
test('manual PF58 replay on committed ISSUING permanently blocked',()=>withDb(f=>{try{
 f.prepare();f.pending();const row=f.get('corporationRuntime',F.pf54.key(F.ASSIGNMENT));
 assert.equal(f.handoff.execute(row).reason,'PF58_HANDOFF_ALREADY_ATTEMPTED');
 assert.equal(f.state.adoptions,1);
}finally{f.close();}}));
test('PF58 cannot bypass PF54 durable ISSUING using attacker-supplied row',()=>withDb(f=>{try{
 f.prepare();const row=f.get('corporationRuntime',F.pf54.key(F.ASSIGNMENT));
 assert.equal(f.handoff.execute({...row,phase:'ISSUING',dispatchCount:1}).reason,'PF58_PF54_ISSUING_DURABLE_MISMATCH');
 assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 source refuses player ship that is still active',()=>withDb(f=>{try{
 f.prepare();f.state.sessionFree=false;f.pending();
 assert.equal(f.state.attempts,0);assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'NOT_FOUND');
}finally{f.close();}}));
test('PF58 refuses if original physical actor exists',()=>withDb(f=>{try{
 f.prepare();f.state.physicalFree=false;f.pending();
 assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses other-owner claim',()=>withDb(f=>{try{
 f.prepare();f.state.exclusive=false;f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses invalid native station undock source',()=>withDb(f=>{try{
 f.prepare();f.state.stationValid=false;f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses NaN source position',()=>withDb(f=>{try{
 f.prepare();f.state.station.position.x=NaN;f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses equipment changed before permit',()=>withDb(f=>{try{
 f.prepare();f.state.equipmentValid=false;f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses revoked original owner fence',()=>withDb(f=>{try{
 f.prepare();f.state.writers=false;f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses revoked feature flag',()=>withDb(f=>{try{
 f.prepare();f.state.auth=false;f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses missing PF52 reservation',()=>withDb(f=>{try{
 f.prepare();f.put('corporationRuntime',F.pf52.REGISTRY_KEY,null);f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses missing original ship',()=>withDb(f=>{try{
 f.prepare();f.put('items','items',{});f.pending();assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 refuses modified stock ship itemID owner or station',()=>withDb(f=>{try{
 f.prepare();const root=f.get('items','items');root[F.SHIP].ownerID=F.EMPLOYER;f.put('items','items',root);f.pending();
 assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 original stock move rejection does not issue adoption',()=>withDb(f=>{try{
 f.prepare();f.state.allowMove=false;f.pending();
 assert.equal(f.state.attempts,1);assert.equal(f.state.adoptions,0);
 assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'CONSUMED');
}finally{f.close();}}));
test('PF58 native adoption refusal leaves original ship in space but locked for operator',()=>withDb(f=>{try{
 f.prepare();f.state.allowAdopt=false;f.pending();
 assert.equal(f.state.attempts,1);assert.equal(f.state.adoptions,1);
 assert.equal(f.get('items','items')[F.SHIP].flagID,0);
 assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'CONSUMED');
 assert.equal(f.bridge.reconcile(f.c).status,'BLOCKED');
}finally{f.close();}}));
test('PF58 native actor readback mismatch cannot report a completed handoff',()=>withDb(f=>{try{
 f.prepare();f.state.directProof=false;const response=f.pending();
 assert.equal(response.executorStatus,'UNVERIFIED');
 assert.equal(f.state.attempts,1);assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'CONSUMED');
 // PF54 reconciliation is an independent authority: never infer its outcome
 // solely from this bridge's inspect callback.
}finally{f.close();}}));
test('PF58 item moved to space but not duplicated if readback unavailable',()=>withDb(f=>{try{
 f.prepare();f.native.readOriginalShip=()=>null;f.pending();
 assert.equal(f.state.adoptions,0);assert.equal(Object.keys(f.get('items','items')).length,1);
}finally{f.close();}}));
test('PF58 row input shape validation is fail closed',()=>{
 assert.equal(api.validPF54({}),false);
 assert.equal(api.validPF54({phase:'ISSUING'}),false);
 assert.equal(api.validStockSpace({itemID:1},{shipItemID:2}),false);
 assert.equal(api.verifyNativeOutcome({entityID:1},{shipItemID:1}),false);
});
test('PF58 new adapter requires all real native functions at creation',()=>{
 assert.throws(()=>api.createOriginalShipHandoff({}),/AUTHORITIES/);
});
test('PF58 no remote client data can alter source station or ship item',()=>withDb(f=>{try{
 f.prepare();f.state.station={...f.state.station,stationID:99999};f.pending();
 assert.equal(f.state.attempts,0);
}finally{f.close();}}));
test('PF58 does not allow in-memory reentrant execute before original move',()=>withDb(f=>{try{
 f.prepare();let inner;
 f.state.beforeMove=(row)=>{inner=f.handoff.execute(row)};
 f.pending();assert.equal(inner.reason,'PF58_HANDOFF_ALREADY_ATTEMPTED');
 assert.equal(f.state.attempts,1);assert.equal(f.state.adoptions,1);
}finally{f.close();}}));
test('PF58 no false ACK if native callback returns Promise',()=>withDb(f=>{try{
 f.prepare();f.native.adoptOriginalShipAsNpc=()=>Promise.resolve({success:true});f.pending();
 assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'CONSUMED');
 assert.equal(f.bridge.reconcile(f.c).status,'BLOCKED');
}finally{f.close();}}));
