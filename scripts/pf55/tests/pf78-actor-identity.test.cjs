'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {matchesOriginalPersonalFleetActor:proof}=require('../native/coopPersonalFleetNativeActorProof.cjs');
function fixture(){
 const row={shipItemID:1001,systemID:300,ownerCharacterID:202,
  assignmentID:'pf78-assignment',pilotID:'coop-pilot-123',
  actorGeneration:9,reservationGeneration:3};
 // Exact PF58 adoption + original nativeNpcService presentation fields.
 const entity={kind:'ship',itemID:1001,nativeNpc:true,nativeNpcOccupied:true,
  npcEntityType:'personalFleet',operatorKind:'PERSONAL_FLEET',
  selectionKind:'PERSONAL_FLEET',selectionID:'pf78-assignment',
  ownerID:202,characterID:0,pilotCharacterID:0,session:null};
 const controller={entityID:1001,systemID:300,personalFleetOriginal:true,
  operatorKind:'PERSONAL_FLEET',entityType:'personalFleet',
  selectionKind:'PERSONAL_FLEET',selectionID:'pf78-assignment',
  personalFleetAssignmentID:'pf78-assignment',personalFleetPilotID:'coop-pilot-123',
  personalFleetGeneration:3,runtimeKind:'nativeAmbient'};
 return {row,entity,controller};
}
test('PF78 accepts actual PF58 original actor+controller and distinct actor/reservation generations',()=>{
 const f=fixture();assert.equal(proof(f.row,f.entity,f.controller),true);
 assert.notEqual(f.row.actorGeneration,f.row.reservationGeneration);
 const {reservationGeneration,...pf55}=f.row;
 assert.equal(proof(pf55,f.entity,f.controller),true);
});
const corruptions=[
 ['row.itemID','row','shipItemID',1002],
 ['row.system','row','systemID',null],
 ['row.owner','row','ownerCharacterID',303],
 ['row.assignment','row','assignmentID','other'],
 ['row.pilot','row','pilotID','bad'],
 ['row.reservation generation','row','reservationGeneration',4],
 ['row.unsafe generation','row','reservationGeneration',-1],
 ['entity.kind','entity','kind','station'],
 ['entity.itemID','entity','itemID',1002],
 ['entity.nativeNpc','entity','nativeNpc',false],
 ['entity.nativeNpcOccupied','entity','nativeNpcOccupied',false],
 ['entity.npcEntityType','entity','npcEntityType','war'],
 ['entity.operatorKind','entity','operatorKind','WAR'],
 ['entity.selectionKind','entity','selectionKind','WAR'],
 ['entity.selectionID','entity','selectionID','foreign'],
 ['entity.ownerID','entity','ownerID',303],
 ['entity.characterID','entity','characterID',202],
 ['entity.pilotCharacterID','entity','pilotCharacterID',202],
 ['entity.session object','entity','session',{socket:{}}],
 ['controller.entityID','controller','entityID',1002],
 ['controller.systemID','controller','systemID',301],
 ['controller.personalFleetOriginal','controller','personalFleetOriginal',false],
 ['controller.operatorKind','controller','operatorKind','RAID'],
 ['controller.entityType','controller','entityType','war'],
 ['controller.selectionKind','controller','selectionKind','WAR'],
 ['controller.selectionID','controller','selectionID','foreign'],
 ['controller.personalFleetAssignmentID','controller','personalFleetAssignmentID','foreign'],
 ['controller.personalFleetPilotID','controller','personalFleetPilotID','coop-pilot-999'],
 ['controller.personalFleetGeneration','controller','personalFleetGeneration',0],
 ['controller.runtimeKind','controller','runtimeKind','foreignRuntime'],
];
for(const [name,part,field,bad] of corruptions){
 test('PF78 refuses '+name,()=>{const f=fixture();f[part][field]=bad;
  assert.equal(proof(f.row,f.entity,f.controller),false);});
}
test('PF78 null and unknown native actor or controller never pass',()=>{
 const f=fixture();for(const v of [undefined,null,{},[]]){
  assert.equal(proof(f.row,v,f.controller),false);
  assert.equal(proof(f.row,f.entity,v),false);
  assert.equal(proof(v,f.entity,f.controller),false);
 }
});
test('PF78 never writes to native caller objects',()=>{
 const f=fixture();const before=JSON.stringify(f);
 assert.equal(proof(f.row,f.entity,f.controller),true);
 assert.equal(JSON.stringify(f),before);
});
test('PF82 accepts independently authenticated LIVE nativeCombat controller after stock ATTACK',()=>{
 const f=fixture();
 f.controller.runtimeKind='nativeCombat';
 f.controller.manualOrder={type:'attack',targetID:5001,allowWeapons:true};
 assert.equal(proof(f.row,f.entity,f.controller),true);
 // The persisted PF58 record is still required to remain nativeAmbient by
 // PF69 stock pair validation; this is only a live scene controller witness.
});
