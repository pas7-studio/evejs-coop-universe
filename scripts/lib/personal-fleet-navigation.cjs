'use strict';
// PF-05 pure navigation/formation reference; never invokes native movement.
const POS=n=>Number.isSafeInteger(n)&&n>0;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const validToken=x=>typeof x==='string'&&TOKEN.test(x);
const PHASES=new Set(['PLANNED','APPROACHING','AT_GATE','TRANSFER_PENDING','TRANSFERRED','ARRIVED','BLOCKED','OUTCOME_UNKNOWN']);
const TRANSITIONS={PLANNED:['APPROACHING','BLOCKED'],APPROACHING:['AT_GATE','BLOCKED'],AT_GATE:['TRANSFER_PENDING','BLOCKED'],TRANSFER_PENDING:['TRANSFERRED','OUTCOME_UNKNOWN'],TRANSFERRED:['ARRIVED','OUTCOME_UNKNOWN'],ARRIVED:[],BLOCKED:[],OUTCOME_UNKNOWN:[]};
const PROOFS={APPROACHING:'ORIGINAL_NATIVE_APPROACH_ACK',AT_GATE:'ORIGINAL_NATIVE_GATE_POSITION',TRANSFER_PENDING:'ORIGINAL_TRANSFER_INTENT_DURABLE',TRANSFERRED:'ORIGINAL_NATIVE_TRANSFER_COMMITTED',ARRIVED:'ORIGINAL_NATIVE_DESTINATION_ARRIVAL',BLOCKED:'NATIVE_ROUTE_REFUSAL',OUTCOME_UNKNOWN:'NATIVE_TRANSFER_OUTCOME_UNKNOWN'};
const reject=reason=>({status:'BLOCKED',reason});
function validate(s){
 if(!s||s.version!==1||!validToken(s.routeID)||!validToken(s.fleetID)||!POS(s.ownerCharacterID)||!POS(s.generation)||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.members)||s.members.length<1||s.members.length>12)throw Error('PF_ROUTE_INVALID');
 const seen=new Set(),ships=new Set(),nativeEntities=new Set();
 for(const m of s.members){
  if(!m||!PILOT.test(m.pilotID)||!POS(m.shipItemID)||!POS(m.nativeEntityID)||!POS(m.fromSystemID)||!POS(m.toSystemID)||m.fromSystemID===m.toSystemID||!PHASES.has(m.phase)||!Number.isSafeInteger(m.revision)||m.revision<0||seen.has(m.pilotID)||ships.has(m.shipItemID)||nativeEntities.has(m.nativeEntityID)||!POS(m.generation)||m.generation!==s.generation||!Array.isArray(m.proofIDs)||m.proofIDs.length>12||m.proofIDs.some(x=>!validToken(x))||new Set(m.proofIDs).size!==m.proofIDs.length)throw Error('PF_ROUTE_MEMBER_INVALID');
  seen.add(m.pilotID);ships.add(m.shipItemID);nativeEntities.add(m.nativeEntityID);
 }
 return s;
}
function plan({routeID,fleetID,ownerCharacterID,generation,members}={}){
 const s={version:1,routeID,fleetID,ownerCharacterID,generation,revision:0,members:(Array.isArray(members)?members:[]).map(m=>({...m,generation,phase:'PLANNED',revision:0,proofIDs:[]}))};
 try{validate(s)}catch{return reject('PF_ROUTE_PLAN_INVALID')}
 return {status:'PLANNED',route:s};
}
function advance(route,{pilotID,to,expectedRouteRevision,expectedMemberRevision,proof}={}){
 try{validate(route)}catch{return reject('PF_ROUTE_CORRUPT')}
 if(route.revision!==expectedRouteRevision)return reject('PF_ROUTE_REVISION_STALE');
 const m=route.members.find(x=>x.pilotID===pilotID);
 if(!m||m.revision!==expectedMemberRevision)return reject('PF_ROUTE_MEMBER_STALE');
 if(!TRANSITIONS[m.phase].includes(to))return reject('PF_ROUTE_ILLEGAL_TRANSITION');
 if(proof?.type!==PROOFS[to]||!validToken(proof.id)||proof.routeID!==route.routeID||proof.pilotID!==m.pilotID||proof.shipItemID!==m.shipItemID||proof.nativeEntityID!==m.nativeEntityID||proof.generation!==m.generation||m.proofIDs.includes(proof.id))return reject('PF_ROUTE_NATIVE_EVIDENCE_REQUIRED');
 if(['AT_GATE','TRANSFER_PENDING'].includes(to)&&proof.fromSystemID!==m.fromSystemID)return reject('PF_ROUTE_SOURCE_IDENTITY_UNVERIFIED');
 if(['TRANSFERRED','ARRIVED'].includes(to)&&(proof.toSystemID!==m.toSystemID||proof.originalItemPreserved!==true))return reject('PF_ROUTE_DESTINATION_IDENTITY_UNVERIFIED');
 if(to==='ARRIVED'&&(proof.destinationSceneVerified!==true||proof.controllerVerified!==true))return reject('PF_ROUTE_ARRIVAL_UNVERIFIED');
 const copy=structuredClone(route),next=copy.members.find(x=>x.pilotID===pilotID);
 next.phase=to;next.revision++;next.proofIDs.push(proof.id);copy.revision++;
 return {status:'APPLIED',route:copy};
}
function snapshot(route){
 try{validate(route)}catch{return reject('PF_ROUTE_CORRUPT')}
 const complete=route.members.every(x=>x.phase==='ARRIVED');
 const blocked=route.members.some(x=>['BLOCKED','OUTCOME_UNKNOWN'].includes(x.phase));
 return {status:complete?'ARRIVED':blocked?'PARTIAL_BLOCKED':'IN_PROGRESS',arrived:route.members.filter(x=>x.phase==='ARRIVED').map(x=>x.pilotID),pending:route.members.filter(x=>x.phase!=='ARRIVED').map(x=>({pilotID:x.pilotID,phase:x.phase}))};
}
function formation({leader,followers,spacing=250}={}){
 if(!leader||!POS(leader.systemID)||!POS(leader.entityID)||!Array.isArray(followers)||followers.length>12||!Number.isFinite(spacing)||spacing<50||spacing>5000)return reject('PF_FORMATION_INVALID');
 const seen=new Set();const orders=[];
 for(const f of followers){
  if(!f||!PILOT.test(f.pilotID)||!POS(f.nativeEntityID)||seen.has(f.pilotID)||f.nativeEntityID===leader.entityID||f.systemID!==leader.systemID||f.nativeControllerVerified!==true)return reject('PF_FORMATION_NATIVE_PROOF_REQUIRED');
  seen.add(f.pilotID);
  orders.push({pilotID:f.pilotID,nativeEntityID:f.nativeEntityID,leaderEntityID:leader.entityID,systemID:leader.systemID,followRangeMeters:spacing*(orders.length+1),action:'NATIVE_FOLLOW_REQUEST'});
 }
 return {status:'PLANNED',orders};
}
module.exports={PHASES,validate,plan,advance,snapshot,formation};
