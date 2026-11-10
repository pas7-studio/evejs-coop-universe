'use strict';
/**
 * PF94: capture a physical original PF56 return ingress at the moment of the
 * successful stock warp. The receipt and native entity row are committed in
 * the SAME GameStore transaction; missing/uncertain effects never mint proof.
 */
const {createHash}=require('node:crypto');
const pos=n=>Number.isSafeInteger(n)&&n>0;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const num=v=>typeof v==='number'&&Number.isFinite(v);
const vec=v=>obj(v)&&['x','y','z'].every(k=>num(v[k]));
const dst=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fields(r){return [r.version,r.source,r.operationID,r.signature,r.assignmentID,
 r.ownerCharacterID,r.pilotID,r.shipItemID,r.systemID,r.stationID,
 r.actorGeneration,r.startTimeMs,r.travelCompleteAtMs,r.completeAtMs,
 r.origin.x,r.origin.y,r.origin.z,r.targetPoint.x,r.targetPoint.y,r.targetPoint.z,
 r.storedPosition.x,r.storedPosition.y,r.storedPosition.z];}
function verifySnapshot(row,snap,stored=null){
 if(!obj(row)||!obj(snap)||snap.version!==1||
    snap.source!=='ORIGINAL_EVEJS_PF56_SESSIONLESS_WARP_V1'||
    !token(row.operationID)||!token(row.assignmentID)||!token(row.pilotID)||
    !/^[a-f0-9]{64}$/.test(row.signature||'')||
    ![row.ownerCharacterID,row.shipItemID,row.systemID,row.stationID,row.actorGeneration].every(pos)||
    !['operationID','signature','assignmentID','ownerCharacterID','pilotID',
      'shipItemID','systemID','stationID','actorGeneration'].every(k=>snap[k]===row[k])||
    !vec(snap.origin)||!vec(snap.targetPoint)||!vec(snap.storedPosition)||
    !pos(snap.startTimeMs)||!pos(snap.travelCompleteAtMs)||
    !pos(snap.completeAtMs)||snap.completeAtMs<snap.travelCompleteAtMs||
    snap.completeAtMs-snap.travelCompleteAtMs>5000||
    snap.travelCompleteAtMs-snap.startTimeMs<500||
    snap.travelCompleteAtMs-snap.startTimeMs>120000||
    dst(snap.origin,snap.targetPoint)<10000||
    dst(snap.storedPosition,snap.origin)>1||
    typeof snap.hash!=='string'||!/^[a-f0-9]{64}$/.test(snap.hash)||
    hash(['PF94_ORIGINAL_NATIVE_INGRESS_V1',...fields(snap)])!==snap.hash)return false;
 if(stored!==null&&(
   !obj(stored)||stored.entityID!==row.shipItemID||
   stored.systemID!==row.systemID||stored.ownerID!==row.ownerCharacterID||
   stored.personalFleetOriginal!==true||
   stored.personalFleetAssignmentID!==row.assignmentID||
   stored.personalFleetPilotID!==row.pilotID||
   stored.mode!=='WARP'||!obj(stored.personalFleetReturnIngress)||
   stored.personalFleetReturnIngress.hash!==snap.hash||
   !vec(stored.position)||dst(stored.position,snap.storedPosition)>1))
   return false;
 return true;
}
function captureOriginalReturnIngress(row,physical,at){
 const ship=physical?.ship,stored=physical?.stored,station=physical?.station,
  g=ship?.sessionlessWarpIngress;
 if(!pos(at)||!obj(row)||!obj(stored)||!obj(ship)||!obj(station)||
    !obj(g)||!vec(g.origin)||!vec(g.targetPoint)||
    !vec(ship.position)||!vec(station.position)||
    ship.itemID!==row.shipItemID||ship.ownerID!==row.ownerCharacterID||
    ship.nativeNpc!==true||ship.kind!=='ship'||ship.transient===true||
    ship.session!=null||stored.entityID!==row.shipItemID||
    stored.personalFleetOriginal!==true||
    stored.personalFleetAssignmentID!==row.assignmentID||
    stored.personalFleetPilotID!==row.pilotID||
    station.stationID!==row.stationID||
    !num(station.radius)||station.radius<0||
    dst(g.origin,ship.position)>1||
    dst(g.targetPoint,station.position)>station.radius+1500||
    !pos(g.startTimeMs)||!pos(g.travelCompleteAtMs)||
    at<g.startTimeMs||at>=g.travelCompleteAtMs||
    !pos(g.completeAtMs||g.travelCompleteAtMs))return null;
 const r={version:1,source:'ORIGINAL_EVEJS_PF56_SESSIONLESS_WARP_V1',
   operationID:row.operationID,signature:row.signature,
   assignmentID:row.assignmentID,ownerCharacterID:row.ownerCharacterID,
   pilotID:row.pilotID,shipItemID:row.shipItemID,
   systemID:row.systemID,stationID:row.stationID,
   actorGeneration:row.actorGeneration,
   startTimeMs:g.startTimeMs,travelCompleteAtMs:g.travelCompleteAtMs,
   completeAtMs:g.completeAtMs||g.travelCompleteAtMs,
   origin:{...g.origin},targetPoint:{...g.targetPoint},
   storedPosition:{...ship.position}};
 r.hash=hash(['PF94_ORIGINAL_NATIVE_INGRESS_V1',...fields(r)]);
 return verifySnapshot(row,r)?Object.freeze(r):null;
}
function canResume(row,snap,now,station){
 return verifySnapshot(row,snap)&&pos(now)&&now>snap.startTimeMs&&
  now<snap.travelCompleteAtMs-250&&obj(station)&&
  station.stationID===row.stationID&&vec(station.position)&&
  num(station.radius)&&station.radius>=0&&
  dst(snap.targetPoint,station.position)<=station.radius+1500;
}
module.exports=Object.freeze({captureOriginalReturnIngress,verifySnapshot,canResume});
