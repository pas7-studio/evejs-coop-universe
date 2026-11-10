'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const proof=require('../native/coopPersonalFleetOriginalIngressProof');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalIngressRecovery.js'),'utf8');
const F='coop-personal-fleet\u001f',NE='npcEntities',T='corporationRuntime',CH='characters';
function fixture(){
 const row={assignmentID:'assignment-1',shipItemID:2301,systemID:30000142,
  ownerCharacterID:500,pilotID:'coop-pilot-123456',actorGeneration:1},
  original={...row,version:1,phase:'RETURN_ISSUING',operationID:'pf56-1',
   signature:'a'.repeat(64),stationID:60000123},
  station={stationID:original.stationID,solarSystemID:row.systemID,
   position:{x:100000,y:0,z:0},radius:6500};
 const stored={entityID:2301,systemID:row.systemID,ownerID:500,mode:'STOP',
  position:{x:0,y:0,z:0},personalFleetOriginal:true,
  personalFleetAssignmentID:row.assignmentID,personalFleetPilotID:row.pilotID};
 const live={kind:'ship',itemID:2301,nativeNpc:true,ownerID:500,
  session:null,position:{x:0,y:0,z:0},transient:false,
  sessionlessWarpIngress:{origin:{x:0,y:0,z:0},targetPoint:{x:107250,y:0,z:0},
   startTimeMs:10000,travelCompleteAtMs:20000,completeAtMs:20200}};
 const snap=proof.captureOriginalReturnIngress(original,{ship:live,stored,station},11000);
 if(!snap)throw Error('TEST_SOURCE_INGRESS_MISSING');
 stored.mode='WARP';stored.targetPoint=snap.targetPoint;
 stored.personalFleetReturnIngress=snap;
 stored.personalFleetReturnOrder={version:1,operationID:original.operationID,
  signature:original.signature,assignmentID:original.assignmentID,
  ownerCharacterID:500,pilotID:original.pilotID,shipItemID:2301,systemID:row.systemID,
  stationID:original.stationID,actorGeneration:1,requestedByAccountID:77,committedAtMs:11000};
 const receipt={...stored.personalFleetReturnOrder,
  source:'EVEJS_ORIGINAL_NATIVE_RETURN_COMMITTED_V1',ingressHash:snap.hash};
 const intent={...original,phase:'RETURNING'},
  operations={operations:{[original.operationID]:{signature:original.signature,
    assignmentID:row.assignmentID}}};
 const character={characterID:500,accountId:77};
 const db={
  [NE]:{['entities\u001f2301']:stored},
  [T]:{[F+'return-dock-v1:'+row.assignmentID]:intent,
    [F+'return-ops-v1']:operations,
    [F+'native-return-receipt-v1:'+original.operationID]:receipt},
  [CH]:{'500':character}};
 let now=13000,enabled=true,fenced=true,poison=false,warpCalls=0;
 const nativeController={entityID:2301,systemID:row.systemID,personalFleetOriginal:true,
  personalFleetAssignmentID:row.assignmentID,personalFleetPilotID:row.pilotID};
 const npcStore={getNativeEntity:()=>stored,getNativeController:()=>nativeController};
 const entity={kind:'ship',itemID:2301,nativeNpc:true,ownerID:500,session:null,
  position:{x:0,y:0,z:0},transient:false,mode:'WARP'};
 const stationBall={kind:'station',itemID:original.stationID,
  position:{...station.position},radius:station.radius};
 const scene={systemID:row.systemID,getEntityByID:id=>id===2301?entity:
  id===stationBall.itemID?stationBall:null};
 const deps={
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
   isPoisoned:()=>poison,transact:(tables,fn)=>{
    a.deepEqual(Array.from(tables),[T,NE,CH]);
    return fn({get:(t,k)=>db[t]?.[k]??null});}}},
  './npc/nativeNpcStore':npcStore,
  './npc/npcRegistry':{getControllerByEntityID:id=>id===2301?nativeController:null},
  './coopPersonalFleetReturnDock':{key:id=>F+'return-dock-v1:'+id,
   OPS:F+'return-ops-v1',signature:()=>original.signature},
  './coopPersonalFleetOriginalIngressProof':proof,
  './worldData':{getStationByID:id=>id===station.stationID?station:null}
 };
 const m={exports:{}};
 vm.runInNewContext(source,{require:id=>{if(!(id in deps))throw Error('BAD_IMPORT:'+id);return deps[id]},
  module:m,exports:m.exports,Date,Number,Object,Set,Array,Math},{filename:'pf94.js'});
 const create=()=>m.exports.createOriginalIngressRecovery({
  enabled:()=>enabled,allWritersFenced:()=>fenced,clock:()=>now});
 return {row,original,stored,receipt,intent,operations,character,db,scene,entity,
  station,stationBall,controller:nativeController,create,warpCalls:()=>warpCalls,
  clock:t=>now=t,disable:()=>enabled=false,unfence:()=>fenced=false,poison:()=>poison=true};
}
test('PF94 source-owned return after restart has independent durable ingress',()=>{
 const f=fixture(),r=f.create().inspect(f.row);
 a.equal(r.status,'VERIFIED_ORIGINAL_INGRESS');
 a.equal(r.ingress.operationID,'pf56-1');
});
test('PF94 returns exact original physical interpolation and no second warp',()=>{
 const f=fixture(),r=f.create().restore(f.row,f.scene);
 a.equal(r.status,'RESTORED_ORIGINAL_INGRESS');
 a.equal(f.entity.sessionlessWarpIngress.origin.x,0);
 a.equal(f.entity.sessionlessWarpIngress.targetPoint.x,107250);
 a.equal(f.entity.sessionlessWarpIngress.startTimeMs,10000);
 a.equal(f.warpCalls(),0);
});
test('PF94 already restored same ingress is safe and idempotent',()=>{
 const f=fixture(),owner=f.create();
 a.equal(owner.restore(f.row,f.scene).status,'RESTORED_ORIGINAL_INGRESS');
 a.equal(owner.restore(f.row,f.scene).status,'ALREADY_ORIGINAL_INGRESS');
});
test('PF94 missing original PF56 ACK refuses restore',()=>{
 const f=fixture();delete f.db[T][F+'native-return-receipt-v1:pf56-1'];
 a.equal(f.create().inspect(f.row).status,'BLOCKED');
 a.equal(f.create().restore(f.row,f.scene).status,'BLOCKED');
});
test('PF94 original receipt hash mismatch is never physical proof',()=>{
 const f=fixture();f.receipt.ingressHash='0'.repeat(64);
 a.equal(f.create().restore(f.row,f.scene).status,'BLOCKED');
});
test('PF94 mutated original NPC position refuses a teleport-like restore',()=>{
 const f=fixture();f.entity.position.x=30000;
 a.equal(f.create().restore(f.row,f.scene).reason,'PF94_NATIVE_SCENE_POSITION_OR_WARP_CONFLICT');
});
test('PF94 refuses expired in-flight restore rather than teleporting on restart',()=>{
 const f=fixture();f.clock(20500);
 a.equal(f.create().restore(f.row,f.scene).status,'BLOCKED');
});
test('PF94 original issuer account change blocks NPC warp reconstitution',()=>{
 const f=fixture();f.character.accountId=99;
 a.equal(f.create().restore(f.row,f.scene).status,'BLOCKED');
});
test('PF94 cannot resume a destroyed or foreign native NPC',()=>{
 const f=fixture();f.controller.personalFleetAssignmentID='foreign';
 a.equal(f.create().inspect(f.row).status,'BLOCKED');
});
test('PF94 scene cannot redirect ship to different original station',()=>{
 const f=fixture();f.stationBall.itemID=987654;
 a.equal(f.create().restore(f.row,f.scene).status,'BLOCKED');
});
test('PF94 stock native ingress never overwrites unrelated in-flight warp',()=>{
 const f=fixture();f.entity.sessionlessWarpIngress={origin:{x:999,y:0,z:0},
 targetPoint:{x:107250,y:0,z:0},startTimeMs:10000,travelCompleteAtMs:20000};
 a.equal(f.create().restore(f.row,f.scene).reason,'PF94_FOREIGN_IN_FLIGHT_WARP');
});
test('PF94 feature kill-switch and original writer fence reject restore',()=>{
 const f=fixture(),x=f.create();f.unfence();
 a.equal(x.inspect(f.row).status,'BLOCKED');
 a.equal(x.restore(f.row,f.scene).status,'BLOCKED');
});
test('PF94 no source writes, money movements or warp commands',()=>{
 const f=fixture(),before=JSON.stringify(f.db);
 const restored=f.create().restore(f.row,f.scene);
 a.equal(restored.status,'RESTORED_ORIGINAL_INGRESS');
 a.equal(JSON.stringify(f.db),before);
 a.equal(f.warpCalls(),0);
});
