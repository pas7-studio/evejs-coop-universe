'use strict';
/**
 * PF97: reactive owner GUARD through ORIGINAL PF55, not an NPC auto-fire API.
 * Input is an authenticated applied-damage source event, never a client
 * attackerID. Uses the same paid NPC, physical ItemStore hull, shared
 * arbiter and PF55 ISSUING/ACKED money-free source ledger.
 */
const {createHash}=require('node:crypto');
const gameStore=require('../gameStore');
const sessions=require('../services/chat/sessionRegistry');
const pf52=require('./coopPersonalFleetHangarBridge');
const pf55=require('./coopPersonalFleetNativeOrders');
const damage=require('./coopPersonalFleetOriginalGuardAggression');
const T='corporationRuntime',IT='items',CHAR='characters',F='coop-personal-fleet\u001f';
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const failed=reason=>Object.freeze({status:'BLOCKED',reason});
const proofID=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function createOriginalGuardReaction({orders,canIssuePersonalCombat,enabled=()=>false,
 allWritersFenced=()=>false,clock=()=>Date.now(),maxPerTick=2}={}){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
   typeof a.isPoisoned!=='function'||
   typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
   typeof pf55.key!=='function'||typeof pf55.signature!=='function'||
   typeof orders?.issue!=='function'||typeof orders?.reconcile!=='function'||
   typeof canIssuePersonalCombat!=='function'||
   typeof damage.listRecent!=='function'||typeof damage.read!=='function'||
   typeof sessions.getSessions!=='function'||
   [enabled,allWritersFenced,clock].some(x=>typeof x!=='function')||
   !Number.isSafeInteger(maxPerTick)||maxPerTick<1||maxPerTick>4)
  throw Error('PF97_ORIGINAL_GUARD_REACTION_SOURCES_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&a.isPoisoned()===false;
 const attempted=new Set();let active=false,cursor=0;
 function candidates(){
  if(!on())return failed('PF97_GUARD_REACTION_OFF');
  const incidents=damage.listRecent();
  if(!Array.isArray(incidents)||incidents.length>32)
   return failed('PF97_NATIVE_DAMAGE_SOURCE_CORRUPT');
  const available=sessions.getSessions();
  if(!Array.isArray(available)||available.length>512)
   return failed('PF97_ORIGINAL_SESSION_SOURCE_UNAVAILABLE');
  try{return a.transact([T,IT,CHAR],tx=>{
   const ix=tx.get(T,pf52.REGISTRY_KEY),
    ops=tx.get(T,pf55.OP_INDEX),claims=tx.get(T,F+'actor-claims-v1');
   if(ix===null&&ops===null&&claims===null)return {status:'READY',commands:[]};
   if(!obj(ix)||!obj(ops)||!obj(claims))return failed('PF97_ORIGINAL_FLEET_LEDGER_MISSING');
   pf52.validateIndex(ix);
   if(ops.version!==1||!obj(ops.operations)||claims.version!==1||
      !obj(claims.claims))return failed('PF97_DURABLE_OWNER_INDEX_INVALID');
   const out=[];
   for(const event of incidents){
    if(event?.source!=='EVEJS_ORIGINAL_KILLMAIL_APPLIED_DAMAGE_V1'||
       ![event.ownerCharacterID,event.ownerShipItemID,event.systemID,
        event.attackerEntityID,event.damageAtMs].every(pos))
     return failed('PF97_DAMAGE_RECEIPT_NOT_ORIGINAL');
    const age=clock()-event.damageAtMs;
    if(!Number.isSafeInteger(age)||age<0||age>120000)continue;
    const current=damage.read({ownerCharacterID:event.ownerCharacterID,
     ownerShipItemID:event.ownerShipItemID,systemID:event.systemID});
    if(current?.attackerEntityID!==event.attackerEntityID||
       current.damageAtMs!==event.damageAtMs)continue;
    const holder=available.filter(s=>s?.characterID===event.ownerCharacterID&&
      s.socket?.destroyed===false&&s._space?.shipID===event.ownerShipItemID&&
      s._space?.systemID===event.systemID&&
      s._space?.initialStateSent===true);
    if(holder.length!==1)continue;
    const owner=tx.get(CHAR,String(event.ownerCharacterID));
    if(owner?.characterID!==event.ownerCharacterID||
       owner.accountId!==holder[0].userid||
       owner.shipID!==event.ownerShipItemID||
       owner.isDeleted===true)continue;
    const roster=tx.get(T,pf52.ROSTER_PREFIX+event.ownerCharacterID);
    if(!obj(roster))continue;
    pf52.validateRoster(roster,event.ownerCharacterID);
    for(const ship of Object.values(ix.ships||{})){
     if(ship?.ownerCharacterID!==event.ownerCharacterID||
        !pos(ship.shipItemID)||!pos(ship.generation))continue;
     const ledger=tx.get(T,pf55.key(ship.shipItemID));
     const d=tx.get(T,F+'deploy-v1:'+ship.assignmentID);
     const pilot=roster.pilots?.[ship.pilotID];
     const claim=claims.claims[String(ship.shipItemID)];
     const stock=tx.get(IT,IT)?.[String(ship.shipItemID)];
     if(!obj(ledger)||ledger.phase!=='ACKED'||ledger.action!=='DEFEND'||
        ledger.shipItemID!==ship.shipItemID||
        ledger.targetEntityID!==event.ownerShipItemID||
        ledger.systemID!==event.systemID||
        ledger.ownerCharacterID!==event.ownerCharacterID||
        ledger.assignmentID!==ship.assignmentID||
        ledger.pilotID!==ship.pilotID||
        ledger.signature!==pf55.signature(ledger)||
        ops.operations[ledger.operationID]?.phase!=='ACKED'||
        ops.operations[ledger.operationID].signature!==ledger.signature||
        d?.phase!=='ACTIVE'||d.shipItemID!==ship.shipItemID||
        d.actorGeneration!==ledger.actorGeneration||
        pilot?.shipItemID!==ship.shipItemID||
        pilot.assignmentID!==ship.assignmentID||
        claim?.ownerType!=='PERSONAL_FLEET'||
        claim.generation!==ledger.actorGeneration||
        stock?.itemID!==ship.shipItemID||
        stock.ownerID!==event.ownerCharacterID||
        stock.categoryID!==6||stock.locationID!==event.systemID)
      continue;
     const operationID='pf-guard-react-'+proofID([
      ledger.operationID,event.attackerEntityID,event.damageAtMs,
      ship.shipItemID,d.actorGeneration]).slice(0,48);
     const c={operationID,session:holder[0],
      ownerCharacterID:event.ownerCharacterID,pilotID:ship.pilotID,
      assignmentID:ship.assignmentID,shipItemID:ship.shipItemID,
      systemID:event.systemID,actorGeneration:d.actorGeneration,
      action:'ATTACK',targetEntityID:event.attackerEntityID};
     out.push(c);
     if(out.length>64)return failed('PF97_GUARD_RESPONSE_FLEET_UNBOUNDED');
    }
   }
   out.sort((x,y)=>x.shipItemID-y.shipItemID);
   return {status:'READY',commands:out};
  });}catch{return failed('PF97_GUARD_RESPONSE_SQLITE_UNCERTAIN');}
 }
 function tick(){
  if(!on())return failed('PF97_GUARD_DISABLED');
  if(active)return failed('PF97_GUARD_OVERLAPPING_TICK');
  active=true;
  try{
   const scan=candidates();
   if(scan.status!=='READY')return scan;
   const all=scan.commands;if(!all.length)return {status:'GUARD_SCANNED',total:0,issued:0,acked:0,blocked:0};
   const start=cursor%all.length;cursor=(start+maxPerTick)%all.length;
   const batch=[...all.slice(start),...all.slice(0,start)].slice(0,maxPerTick);
   const out={status:'GUARD_SCANNED',total:all.length,issued:0,acked:0,blocked:0};
   for(const cmd of batch){
    if(!on())return failed('PF97_GUARD_REACTION_REVOKED');
    if(attempted.has(cmd.operationID))continue;
    // Native shared arbiter can reject an expired-but-still-live lease.
    // Never leave PF55 ISSUING for an order that bridge already says is blocked.
    if(canIssuePersonalCombat(cmd)!==true){out.blocked++;continue;}
    attempted.add(cmd.operationID);out.issued++;
    try{
     const issued=orders.issue(cmd);
     if(issued?.status==='NEEDS_RECONCILIATION'){
      const acked=orders.reconcile(cmd);
      if(acked?.status==='ACKED'||acked?.status==='ALREADY_ACKED')out.acked++;
      else out.blocked++;
     }else out.blocked++;
    }catch{out.blocked++;}
   }
   return out;
  }finally{active=false;}
 }
 return Object.freeze({tick,candidates});
}
module.exports=Object.freeze({createOriginalGuardReaction});
