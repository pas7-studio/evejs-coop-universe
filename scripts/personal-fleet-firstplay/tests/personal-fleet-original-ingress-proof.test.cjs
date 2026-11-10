'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const proof=require('../native/coopPersonalFleetOriginalIngressProof');
const ROW={version:1,operationID:'pf56-1',signature:'a'.repeat(64),
 assignmentID:'assignment-1',ownerCharacterID:500,pilotID:'coop-pilot-123456',
 shipItemID:2301,systemID:30000142,stationID:60000123,actorGeneration:1};
function fixture(){
 const station={stationID:ROW.stationID,position:{x:100000,y:0,z:0},radius:6500};
 const stored={entityID:ROW.shipItemID,systemID:ROW.systemID,ownerID:500,
  personalFleetOriginal:true,personalFleetAssignmentID:ROW.assignmentID,
  personalFleetPilotID:ROW.pilotID,position:{x:0,y:0,z:0},mode:'STOP'};
 const ship={kind:'ship',nativeNpc:true,itemID:ROW.shipItemID,ownerID:500,
  session:null,transient:false,position:{x:0,y:0,z:0},
  sessionlessWarpIngress:{origin:{x:0,y:0,z:0},
   targetPoint:{x:107250,y:0,z:0},
   startTimeMs:10000,travelCompleteAtMs:20000,completeAtMs:20200}};
 return {station,stored,ship,physical:{ship,stored,station},row:ROW,at:11000};
}
function capture(f){return proof.captureOriginalReturnIngress(f.row,f.physical,f.at);}
test('PF94 reads live physical ingress, exact destination and native source row',()=>{
 const f=fixture(),p=capture(f);
 a.equal(p.source,'ORIGINAL_EVEJS_PF56_SESSIONLESS_WARP_V1');
 a.equal(p.shipItemID,2301);a.equal(p.travelCompleteAtMs,20000);
 a.equal(proof.verifySnapshot(ROW,p),true);
 a.equal(proof.canResume(ROW,p,13000,f.station),true);
});
test('PF94 refuses a warp state guessed without a sessionless ingress',()=>{
 const f=fixture();delete f.ship.sessionlessWarpIngress;
 a.equal(capture(f),null);
});
test('PF94 cannot record a warp to a foreign station',()=>{
 const f=fixture();f.ship.sessionlessWarpIngress.targetPoint.x=2222222;
 a.equal(capture(f),null);
});
test('PF94 wrong original physical departure position cannot attest warp',()=>{
 const f=fixture();f.ship.position={x:1600,y:0,z:0};
 a.equal(capture(f),null);
});
test('PF94 cannot invent origin when original live ship is not an NPC',()=>{
 const f=fixture();f.ship.nativeNpc=false;
 a.equal(capture(f),null);
});
test('PF94 cannot capture after the original physical ingress completed',()=>{
 const f=fixture();f.at=21000;
 a.equal(capture(f),null);
});
test('PF94 validates restored native entity and ownership after restart',()=>{
 const f=fixture(),p=capture(f);
 const durable={...f.stored,mode:'WARP',personalFleetReturnIngress:p};
 a.equal(proof.verifySnapshot(ROW,p,durable),true);
 a.equal(proof.verifySnapshot(ROW,p,{...durable,ownerID:999}),false);
});
test('PF94 signed persisted ingress cannot be silently retargeted',()=>{
 const f=fixture(),p=capture(f);
 a.equal(proof.verifySnapshot(ROW,{...p,targetPoint:{x:110000,y:0,z:0}}),false);
});
test('PF94 signed original receipt cannot be replayed for another assignment',()=>{
 const f=fixture(),p=capture(f);
 a.equal(proof.verifySnapshot({...ROW,assignmentID:'assignment-2'},p),false);
});
test('PF94 expired snapshot never authorizes a second physical warp',()=>{
 const f=fixture(),p=capture(f);
 a.equal(proof.canResume(ROW,p,20000,f.station),false);
 a.equal(proof.canResume(ROW,p,19750,f.station),false);
});
test('PF94 future ingress cannot be restored before original start time',()=>{
 const f=fixture(),p=capture(f);
 a.equal(proof.canResume(ROW,p,9999,f.station),false);
});
test('PF94 original receipt does not authorize a synthetic target station',()=>{
 const f=fixture(),p=capture(f);
 a.equal(proof.canResume(ROW,p,12000,{...f.station,stationID:999999}),false);
});
test('PF94 a duration longer than native 120 seconds is rejected',()=>{
 const f=fixture();f.ship.sessionlessWarpIngress.travelCompleteAtMs=160000;
 a.equal(capture(f),null);
});
test('PF94 real departing NPC can commit truthful live position despite old stored tick',()=>{
 const f=fixture();f.stored.position.x=500;
 const r=capture(f);
 a.equal(r.storedPosition.x,0);
 a.equal(proof.verifySnapshot(ROW,r),true);
});
