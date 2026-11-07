'use strict';
/**
 * First-play original WORK command conductor. No providers or security
 * authorities are created here; they must come from the native bootstrap.
 * Direct PF52/53/54/55/56/57 methods preserve their own atomic CAS/receipts.
 * No UI/backend can provide an operationID, ownership, wallet price, offer or
 * character identity as authority. Not installed in the EveJS fork yet.
 */
const {randomUUID}=require('node:crypto');
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const pos=n=>Number.isSafeInteger(n)&&n>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const blocked=reason=>Object.freeze({status:'BLOCKED',reason});
const P='coop-personal-fleet\u001f';
const op=()=>`pf-${randomUUID()}`;
function createOriginalWorkCommandOwner({gameStore,pf52,hangar,pf53,pf54,pf55,pf56,pf57,
 listNativeOffers,lookupNativeOffer,verifyNativePilotHull,resolveOriginalDockContext,
 resolveOriginalFollowTarget,enabled=()=>false}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
    typeof atomic.isPoisoned!=='function'||
    typeof pf52?.readStockHangar!=='function'||
    typeof hangar?.inspect!=='function'||typeof hangar.execute!=='function'||
    typeof pf53?.hire!=='function'||
    ['prepare','dispatch','reconcile','inspect'].some(k=>typeof pf54?.[k]!=='function')||
    ['issue','reconcile','inspect'].some(k=>typeof pf55?.[k]!=='function')||
    ['requestReturn','inspect'].some(k=>typeof pf56?.[k]!=='function')||
    typeof pf57?.dismiss!=='function'||typeof pf57?.salary!=='function'||
    typeof pf57?.inspect!=='function'||
    [listNativeOffers,lookupNativeOffer,verifyNativePilotHull,resolveOriginalDockContext,
     resolveOriginalFollowTarget,enabled].some(x=>typeof x!=='function'))
  throw Error('PF_FIRSTPLAY_ORIGINAL_COMMAND_AUTHORITIES_REQUIRED');
 const live=()=>enabled()===true&&atomic.isPoisoned()===false;
 const admission=ctx=>live()&&obj(ctx)&&pos(ctx.ownerCharacterID)&&
  pos(ctx.accountID)&&ctx.session?.characterID===ctx.ownerCharacterID&&
  ctx.session.userid===ctx.accountID&&ctx.session.socket?.destroyed===false&&
  Array.isArray(ctx.args);
 function roster(ctx){
  if(!admission(ctx))return blocked('PF_FIRSTPLAY_ORIGINAL_AUTHORITY_OFF');
  return hangar.inspect({session:ctx.session,ownerCharacterID:ctx.ownerCharacterID});
 }
 function rosterSnapshot(ctx){
  const result=roster(ctx);
  if(result?.status!=='OK'||!obj(result.roster)||!obj(result.roster.pilots)||
     !Number.isSafeInteger(result.roster.revision))
   return {error:'PF_FIRSTPLAY_DURABLE_ROSTER_UNAVAILABLE'};
  return {data:result.roster};
 }
 function readOriginal(ctx,tables,fn){
  if(!admission(ctx))return null;
  try{return atomic.transact(tables,tx=>{
   const owner=tx.get('characters',String(ctx.ownerCharacterID));
   if(!obj(owner)||owner.characterID!==undefined&&owner.characterID!==ctx.ownerCharacterID||
      owner.accountId!==ctx.accountID||owner.isDeleted===true)return null;
   return fn(tx,owner);
  });}catch{return null;}
 }
 function dock(ctx){
  const result=resolveOriginalDockContext(ctx.session,ctx.ownerCharacterID);
  if(!obj(result)||!pos(result.stationID)||!pos(result.systemID)||
     result.originalNativeVerified!==true)return null;
  return result;
 }
 function offers(ctx){
  if(!admission(ctx))return blocked('PF_FIRSTPLAY_ORIGINAL_AUTHORITY_OFF');
  const list=listNativeOffers({session:ctx.session,ownerCharacterID:ctx.ownerCharacterID});
  if(!Array.isArray(list)||list.length>24||list.some(x=>!obj(x)||!TOKEN.test(x.offerID)||
      !PILOT.test(x.pilotID)||x.ownerCharacterID!==ctx.ownerCharacterID||
      !pos(x.amountCents)||!pos(x.expiresAtMs)||x.expiresAtMs<=Date.now()||
      x.salaryConsentRequired!==true||!pos(x.salaryCents)||x.salaryCents>1000000000000||
      !Number.isSafeInteger(x.periodMs)||x.periodMs<3600000||x.periodMs>604800000))
   return blocked('PF_FIRSTPLAY_NATIVE_OFFERS_UNAVAILABLE');
  return {status:'READY',message:list.length?list.map(x=>x.offerID+':'+x.pilotID+':'+
   (x.amountCents/100).toFixed(2)+' ISK hire; '+
   (x.salaryCents/100).toFixed(2)+' ISK salary every '+(x.periodMs/3600000)+'h').join(' | '):'No native offers'};
 }
 function status(ctx){
  const s=rosterSnapshot(ctx);if(s.error)return blocked(s.error);
  const pilots=Object.values(s.data.pilots);
  return {status:'OK',message:`rosterRevision=${s.data.revision}; `+
   (pilots.length?pilots.map(x=>x.pilotID+':'+x.status+(pos(x.shipItemID)?':'+x.shipItemID:'')).join(' | '):'no NPC hired')};
 }
 function hire(ctx){
  if(!admission(ctx)||ctx.args.length!==2||!TOKEN.test(ctx.args[0])||
     ctx.args[1]!=='accept-recurring')return blocked('PF92_RECURRING_SALARY_CONSENT_REQUIRED');
  const snap=rosterSnapshot(ctx);if(snap.error)return blocked(snap.error);
  const offer=lookupNativeOffer({session:ctx.session,ownerCharacterID:ctx.ownerCharacterID,offerID:ctx.args[0]});
  if(!obj(offer)||offer.offerID!==ctx.args[0]||
     offer.ownerCharacterID!==ctx.ownerCharacterID||!PILOT.test(offer.pilotID)||
     !TOKEN.test(offer.contractID)||!pos(offer.agentID)||!pos(offer.revision)||
     !pos(offer.employerCorpID)||!pos(offer.amountCents)||!pos(offer.expiresAtMs)||
     offer.expiresAtMs<=Date.now()||offer.salaryConsentRequired!==true||
     !pos(offer.salaryCents)||!Number.isSafeInteger(offer.periodMs)||
     offer.periodMs<3600000||offer.periodMs>604800000)
   return blocked('PF_FIRSTPLAY_ORIGINAL_OFFER_NOT_VERIFIED');
  const result=pf53.hire({operationID:op(),session:ctx.session,
   ownerCharacterID:ctx.ownerCharacterID,offerID:offer.offerID,
   offerRevision:offer.revision,agentID:offer.agentID,pilotID:offer.pilotID,
   contractID:offer.contractID,expectedRosterRevision:snap.data.revision});
  return result?.status==='APPLIED'?{...result,pilotID:offer.pilotID}:result||blocked('PF_FIRSTPLAY_HIRE_OUTCOME_UNKNOWN');
 }
 function assign(ctx){
  if(!admission(ctx)||ctx.args.length!==2||!PILOT.test(ctx.args[0])||!pos(ctx.args[1]))
   return blocked('PF_FIRSTPLAY_ASSIGN_INPUT_INVALID');
  const [pilotID,shipItemID]=ctx.args;
  const snap=rosterSnapshot(ctx);if(snap.error)return blocked(snap.error);
  const pilot=snap.data.pilots[pilotID],station=dock(ctx);
  if(!pilot||pilot.status!=='CONTRACTED'||pilot.shipItemID!==null||
     !Number.isSafeInteger(pilot.revision)||!station)
   return blocked('PF_FIRSTPLAY_PILOT_OR_STATION_UNAVAILABLE');
  const original=readOriginal(ctx,['characters','items'],(tx,owner)=>{
   const item=tx.get('items','items')?.[String(shipItemID)];
   return owner.shipID!==shipItemID&&owner.shipid!==shipItemID&&
     owner.activeShipID!==shipItemID&&pf52.readStockHangar(tx,shipItemID,ctx.ownerCharacterID,station.stationID)?.itemID===shipItemID&&
     obj(item)&&item.ownerID===ctx.ownerCharacterID&&pos(item.typeID)?item.typeID:null;
  });
  if(!pos(original))return blocked('PF_FIRSTPLAY_SPARE_ORIGINAL_SHIP_UNVERIFIED');
  if(verifyNativePilotHull({session:ctx.session,ownerCharacterID:ctx.ownerCharacterID,
      pilotID,shipItemID,shipTypeID:original})!==true)
   return blocked('PF_FIRSTPLAY_PAID_PILOT_SHIP_TYPE_UNVERIFIED');
  // PF52.verifyShipAvailable must independently recheck the SAME source
  // within its own original transaction immediately before reservation.
  const assignmentID='pf-assignment-'+randomUUID();
  const result=hangar.execute({type:'RESERVE_HANGAR_SHIP',session:ctx.session,
   operationID:op(),pilotID,ownerCharacterID:ctx.ownerCharacterID,
   shipItemID,stationID:station.stationID,assignmentID,
   expectedRosterRevision:snap.data.revision,expectedPilotRevision:pilot.revision});
  return result?.status==='APPLIED'?{...result,assignmentID,pilotID,shipItemID}:result||blocked('PF_FIRSTPLAY_ASSIGN_OUTCOME_UNKNOWN');
 }
 function deployment(ctx,assignmentID=null,shipItemID=null){
  const snap=rosterSnapshot(ctx);if(snap.error)return {error:snap.error};
  const candidates=Object.values(snap.data.pilots).filter(x=>
   (assignmentID===null||x.assignmentID===assignmentID)&&
   (shipItemID===null||x.shipItemID===shipItemID));
  if(candidates.length!==1||!PILOT.test(candidates[0].pilotID)||
     !TOKEN.test(candidates[0].assignmentID)||!pos(candidates[0].shipItemID)||
     !pos(candidates[0].stationID)||!pos(candidates[0].generation))
   return {error:'PF_FIRSTPLAY_ASSIGNMENT_NOT_UNIQUE'};
  return {pilot:candidates[0],roster:snap.data};
 }
 function deploy(ctx){
  if(!admission(ctx)||ctx.args.length!==1||!TOKEN.test(ctx.args[0]))
   return blocked('PF_FIRSTPLAY_DEPLOY_INPUT_INVALID');
  const s=deployment(ctx,ctx.args[0]);if(s.error)return blocked(s.error);
  const station=dock(ctx);
  if(!station||s.pilot.stationID!==station.stationID||s.pilot.status!=='HANGAR_RESERVED')
   return blocked('PF_FIRSTPLAY_ORIGINAL_DEPLOY_STATION_UNVERIFIED');
  const c={session:ctx.session,operationID:op(),assignmentID:s.pilot.assignmentID,
   ownerCharacterID:ctx.ownerCharacterID,pilotID:s.pilot.pilotID,
   shipItemID:s.pilot.shipItemID,stationID:station.stationID,
   systemID:station.systemID,expectedGeneration:s.pilot.generation,
   expectedRosterRevision:s.roster.revision,expectedPilotRevision:s.pilot.revision};
  const prepared=pf54.prepare(c);
  if(prepared?.status!=='PREPARED')return prepared||blocked('PF_FIRSTPLAY_DEPLOY_PREPARE_UNKNOWN');
  const dispatched=pf54.dispatch(c);
  if(dispatched?.status!=='AWAITING_NATIVE_RECONCILIATION'||
     dispatched.executorStatus!=='REPORTED_COMPLETED')
   return dispatched||blocked('PF_FIRSTPLAY_DEPLOY_OUTCOME_UNKNOWN');
  // PF54 reconciliation is independent original actor + stock ItemStore proof.
  const reconciled=pf54.reconcile(c);
  return reconciled?.status==='ACTIVE'?{...reconciled,assignmentID:c.assignmentID}:reconciled||
    blocked('PF_FIRSTPLAY_DEPLOY_RECONCILIATION_UNKNOWN');
 }
 function active(ctx,shipItemID){
  const a=deployment(ctx,null,shipItemID);if(a.error)return {error:a.error};
  const row=readOriginal(ctx,['characters','corporationRuntime'],(tx)=>tx.get('corporationRuntime',P+'deploy-v1:'+a.pilot.assignmentID));
  if(!obj(row)||row.phase!=='ACTIVE'||row.ownerCharacterID!==ctx.ownerCharacterID||
     row.shipItemID!==shipItemID||row.pilotID!==a.pilot.pilotID||
     row.assignmentID!==a.pilot.assignmentID||!pos(row.actorGeneration)||
     row.stationID!==a.pilot.stationID||row.generation!==a.pilot.generation)
   return {error:'PF_FIRSTPLAY_NATIVE_ACTIVE_ACTOR_UNVERIFIED'};
  return {row,pilot:a.pilot};
 }
 function order(ctx,action){
  if(!admission(ctx)||ctx.args.length!==1||!pos(ctx.args[0]))
   return blocked('PF_FIRSTPLAY_ORDER_INPUT_INVALID');
  const shipItemID=ctx.args[0],s=active(ctx,shipItemID);
  if(s.error)return blocked(s.error);
  let targetEntityID=null;
  if(action==='FOLLOW'){
   const native=resolveOriginalFollowTarget(ctx.session,ctx.ownerCharacterID,s.row.systemID);
   if(!obj(native)||native.nativeVerified!==true||!pos(native.shipItemID)||native.shipItemID===shipItemID)
    return blocked('PF_FIRSTPLAY_ORIGINAL_FRIENDLY_TARGET_UNVERIFIED');
   targetEntityID=native.shipItemID;
  }
  const c={session:ctx.session,operationID:op(),ownerCharacterID:ctx.ownerCharacterID,
   pilotID:s.pilot.pilotID,assignmentID:s.pilot.assignmentID,shipItemID,
   systemID:s.row.systemID,actorGeneration:s.row.actorGeneration,
   action,targetEntityID,...(action==='FOLLOW'?{followRangeMeters:2500}:{})};
  const result=pf55.issue(c);
  if(result?.status!=='NEEDS_RECONCILIATION')return result||blocked('PF_FIRSTPLAY_ORDER_OUTCOME_UNKNOWN');
  // Do not reissue on a failed ACK. Check only original persisted NPC order.
  const confirmed=pf55.reconcile(c);
  return confirmed?.status==='ACKED'?confirmed:result;
 }
 function follow(ctx){return order(ctx,'FOLLOW');}
 function hold(ctx){return order(ctx,'HOLD');}
 function returnToBase(ctx){
  if(!admission(ctx)||ctx.args.length!==1||!pos(ctx.args[0]))
   return blocked('PF_FIRSTPLAY_RETURN_INPUT_INVALID');
  const s=active(ctx,ctx.args[0]);if(s.error)return blocked(s.error);
  const c={session:ctx.session,operationID:op(),ownerCharacterID:ctx.ownerCharacterID,
   pilotID:s.pilot.pilotID,assignmentID:s.pilot.assignmentID,
   shipItemID:s.row.shipItemID,stationID:s.row.stationID,systemID:s.row.systemID,
   reservationGeneration:s.row.generation,actorGeneration:s.row.actorGeneration};
  // PF56 starts a one-shot durable return; arrival and dock require actual
  // native controller movement, independent source-owned proofs and retries
  // ONLY via the PF56 reconciliation reader, never via another requestReturn.
  return pf56.requestReturn(c)||blocked('PF_FIRSTPLAY_RETURN_OUTCOME_UNKNOWN');
 }
 function salary(ctx){
  if(!admission(ctx)||ctx.args.length!==1||!PILOT.test(ctx.args[0]))
   return blocked('PF91_SALARY_INPUT_INVALID');
  const snap=rosterSnapshot(ctx);if(snap.error)return blocked(snap.error);
  const pilot=snap.data.pilots[ctx.args[0]];
  if(!pilot||!TOKEN.test(pilot.contractID)||
     !['CONTRACTED','HANGAR_RESERVED'].includes(pilot.status))
   return blocked('PF91_SALARY_NATIVE_CONTRACT_NOT_FOUND');
  // The salary period comes exclusively from the original PF57 ledger.
  // The client never selects periodIndex, amountCents, due date or employer.
  const inspected=pf57.inspect({
   session:ctx.session,operationID:op(),ownerCharacterID:ctx.ownerCharacterID,
   pilotID:pilot.pilotID,contractID:pilot.contractID});
  if(!['OK','NOT_FOUND'].includes(inspected?.status))
   return inspected||blocked('PF91_ORIGINAL_SALARY_LEDGER_UNAVAILABLE');
  const last=inspected.status==='NOT_FOUND'?0:inspected.contract?.lastPeriod;
  if(!Number.isSafeInteger(last)||last<0||last>=Number.MAX_SAFE_INTEGER-1)
   return blocked('PF91_SALARY_PERIOD_LEDGER_INVALID');
  return pf57.salary({session:ctx.session,operationID:op(),
   ownerCharacterID:ctx.ownerCharacterID,pilotID:pilot.pilotID,
   contractID:pilot.contractID,periodIndex:last+1})||
   blocked('PF91_ORIGINAL_SALARY_COMMIT_UNKNOWN');
 }
 function dismiss(ctx){
  if(!admission(ctx)||ctx.args.length!==1||!PILOT.test(ctx.args[0]))
   return blocked('PF_FIRSTPLAY_DISMISS_INPUT_INVALID');
  const snap=rosterSnapshot(ctx);if(snap.error)return blocked(snap.error);
  const pilot=snap.data.pilots[ctx.args[0]];
  if(!pilot||pilot.status!=='CONTRACTED'||pilot.shipItemID!==null||!TOKEN.test(pilot.contractID))
   return blocked('PF_FIRSTPLAY_PILOT_STILL_ASSIGNED_OR_MISSING');
  return pf57.dismiss({session:ctx.session,operationID:op(),ownerCharacterID:ctx.ownerCharacterID,
   pilotID:pilot.pilotID,contractID:pilot.contractID})||blocked('PF_FIRSTPLAY_DISMISS_OUTCOME_UNKNOWN');
 }
 return Object.freeze({source:'ORIGINAL_EVEJS_PERSONAL_FLEET_OWNER_V1',
  enabled:live,offers,status,roster:status,hire,assign,deploy,follow,hold,returnToBase,salary,dismiss});
}
module.exports=Object.freeze({createOriginalWorkCommandOwner});
