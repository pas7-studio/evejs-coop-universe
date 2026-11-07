'use strict';
/** PF96: execute the ACTUAL source-patched original EveJS shared arbiter+bridge.
 * Runs only with a staged, isolated WORK source tree; never touches PLAY.
 */
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const work=process.env.PF87_NATIVE_WORKTREE||'';
test('PF96 WORK original NPC arbiter retains only receipt-proven GUARD restart',{
 skip:!work?'Original isolated native WORK source not provided':false
},()=>{
 const parts=path.resolve(work).split(path.sep);
 if(parts.some(p=>/^(play|prod|production)$/i.test(p)))
  throw Error('PF96_ORIGINAL_PLAY_PATH_FORBIDDEN');
 const prefix=path.join(work,'Code/server/src/space');
 const bridgeFile=path.join(prefix,'coopNpcOrderBridge.js');
 const arbiterFile=path.join(prefix,'coopNpcOrderArbiter.js');
 a.equal(fs.statSync(bridgeFile).isFile(),true);
 a.equal(fs.statSync(arbiterFile).isFile(),true);
 const bridge=require(bridgeFile),arbiterModule=require(arbiterFile);
 const clock=()=>1700000000000;
 const arbitration=arbiterModule.createOrderArbiter({clock});
 const ship={kind:'ship',itemID:2301,nativeNpc:true,
  mode:'FOLLOW',session:null,ownerID:901,targetEntityID:3003};
 const controller={entityID:2301,systemID:30000142,manualOrder:null};
 const scene={systemID:30000142,getEntityByID:id=>id===2301?ship:null};
 let sourceProof=false,calls=0;
 const order=bridge.createOrderBridge({arbiter:arbitration,
  assignments:()=>[{entityID:2301,systemID:30000142,
    pilotID:'coop-pilot-123'}],
  sceneForSystem:systemID=>systemID===30000142?scene:null,
  getController:id=>id===2301?controller:null,
  warShipClaim:()=> 'UNASSIGNED',
  personalFleetRecoveryProof:()=>sourceProof
 });
 const send=action=>order.issue({entityID:2301,systemID:30000142,
  owner:'PERSONAL_FLEET',action,
  execute:()=>{calls++;return {success:true}}});
 a.equal(send('pf-resume-guard').success,false);
 a.equal(send('pf-guard').success,false);
 a.equal(calls,0);
 sourceProof=true;
 a.equal(send('pf-resume-guard').success,true);
 a.equal(calls,1);
 a.equal(arbitration.snapshot().leases[0].owner,'PERSONAL_FLEET');
 const foreign=order.issue({entityID:2301,systemID:30000142,
  owner:'RAID',action:'patrol-move',execute:()=>{calls++;return {success:true}}});
 a.equal(foreign.success,false);
 a.equal(calls,1);
});
