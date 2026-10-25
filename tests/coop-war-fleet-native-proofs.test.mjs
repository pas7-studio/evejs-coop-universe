import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createWarFleetNativeProofs}=require('../integration/coopWarFleetNativeProofs.cjs');
const core=require('../integration/coopFactionWarCore.cjs');
const {KEY,TABLE}=require('../integration/coopFactionWarStore.cjs');
function fixture(){
 const systemID=101,entityID=501,pilotID='coop-pilot-001';
 const ship={itemID:entityID,kind:'ship',nativeNpc:true,corporationID:31};
 const controller={entityID,systemID,manualOrder:null,currentTargetID:0};
 const native={entityID,systemID,corporationID:31};
 let exists=true,confirmedDestroyed=false;
 const links=[{entityID,systemID,pilotID}];
 const providers={
  sceneForSystem:()=>({systemID,getEntityByID:()=>exists?ship:null}),
  getController:()=>controller,getNativeEntity:()=>exists?native:null,
  assignments:()=>links,getFactionForCorporation:corp=>corp===31?11:null,
  confirmDestroyed:()=>confirmedDestroyed};
 const proofs=createWarFleetNativeProofs(providers);
 const command={entityID,systemID,pilotID,corporationID:31,factionID:11,
  campaignID:'c1',warID:'w1',fleetID:'fleet-a',proofID:'native-proof'};
 const state=core.empty();state.wars.w1={state:'ACTIVE',attackerFactionID:11};
 state.campaigns.c1={warID:'w1',state:'PREPARING',sourceSystemID:101,targetSystemID:202};
 const tx={get:(table,key)=>table===TABLE&&key===KEY?state:null};
 return {ship,controller,native,links,proofs,command,state,tx,
  remove:()=>{exists=false},acceptDestroyed:()=>{confirmedDestroyed=true}};
}
test('warship registration requires exact existing physical native NPC and native corp/faction',()=>{
 const f=fixture();
 assert.equal(f.proofs.verifyNativeShip(f.command),true);
 f.ship.corporationID=999;
 assert.equal(f.proofs.verifyNativeShip(f.command),false);
 f.ship.corporationID=31;f.controller.manualOrder={type:'attack'};
 assert.equal(f.proofs.verifyNativeShip(f.command),false);
 f.controller.manualOrder=null;f.links.push({...f.links[0]});
 assert.equal(f.proofs.verifyNativeShip(f.command),false);
});
test('same-transaction campaign attestation and source vs assault system',()=>{
 const f=fixture();
 assert.equal(f.proofs.verifyCampaign(f.command,f.tx),true);
 assert.equal(f.proofs.verifyCampaign(f.command),false);
 f.state.campaigns.c1.state='ASSAULT';
 assert.equal(f.proofs.verifyCampaign(f.command,f.tx),false);
 assert.equal(f.proofs.verifyCampaign({...f.command,systemID:202},f.tx),true);
 f.state.wars.w1.state='ENDED';
 assert.equal(f.proofs.verifyCampaign({...f.command,systemID:202},f.tx),false);
});
test('missing ship is NOT proof of loss or release',()=>{
 const f=fixture();f.remove();
 assert.equal(f.proofs.verifyRelease(f.command),false);
 f.acceptDestroyed();
 assert.equal(f.proofs.verifyRelease(f.command),true);
});
test('native active combat or warp prevent ordinary release',()=>{
 const f=fixture();f.ship.mode='WARP';
 assert.equal(f.proofs.verifyRelease(f.command),false);
 f.ship.mode='IDLE';f.controller.currentTargetID=900;
 assert.equal(f.proofs.verifyRelease(f.command),false);
});
