"use strict";
// Organic native NPC raids: pirates target real ore-bearing mining ships.
// EveJS handles locking, damage, pursuit, aggression response and wrecks.
// No scripted kills, fake mining, arena bubbles or player-target selection.
const pos=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
// A loaded hauler is preferred over a loaded miner only within this slack of the
// nearest authorized hull, never across an entire solar system.
const HAULER_PREFERENCE_METERS=50000;
// A native order we issued is not a licence to hold a hull forever: an approach
// that never became a warp, or an attack that never acquired a native lock, is
// released after this long so the record has exactly one owner again.
const APPROACH_VERIFY_MS=20000;
const ATTACK_NO_LOCK_MS=90000;
const RELEASE_COOLDOWN_MS=120000;
const valid=p=>!!p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
const range=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// A hull is really warping only with a native warp state, never with mode GOTO:
// GOTO is the behaviour loop's own subwarp pursuit and it silently wins over an
// issued warp when the hull still holds its previous attack order.
const warping=e=>{const mode=String(e?.mode||"").toUpperCase();
 return mode==="WARP"||Boolean(e?.pendingWarp)||Boolean(e?.warpState)||
  e?.isWarping===true;};
const holdsAttack=c=>String(c?.manualOrder?.type||"").toLowerCase()==="attack";
function createRaids({warp,attack,release=null,clock=()=>Date.now(),cooldownMs=480000,
 approachVerifyMs=APPROACH_VERIFY_MS,attackNoLockMs=ATTACK_NO_LOCK_MS,
 releaseCooldownMs=RELEASE_COOLDOWN_MS}){
 if(typeof warp!=="function"||typeof attack!=="function"||cooldownMs<60000)throw Error("invalid native raid API");
 if(release!==null&&typeof release!=="function")throw Error("invalid native raid release API");
 const leases=new Map();
 // One owner per record: only the director that issued an order may release it.
 function releaseOrder(pirateID,reason){
  if(!release)return {released:false,reason:"RELEASE_UNAVAILABLE"};
  let result;
  try{result=release(pirateID,reason);}
  catch(error){return {released:false,reason:"RELEASE_THREW:"+
   String(error&&error.message||error).slice(0,60)};}
  return {released:result?.success===true,reason,
   errorMsg:String(result?.errorMsg||"")};
 }
 function tick({systemID,scene,pirates=[],fleetShips=[],getCargo=()=>[],getController=()=>null,canAttack=()=>true}){
  if(!pos(systemID)||!scene?.getEntityByID)return {status:"SCENE_MISSING",actions:[]};
  const candidates=fleetShips.filter(t=>pos(t.id)&&["miner","hauler"].includes(t.role))
    .map(t=>{
      const ship=scene.getEntityByID(t.id);
      const ore=(getCargo(t.id)||[]).filter(x=>Number(x?.moduleID||0)===0)
       .reduce((n,x)=>n+Math.max(0,Number(x.quantity)||0),0);
      return {...t,ship,ore};
    })
    // A hull in an active warp is not a legal combat target and cannot be caught:
    // chasing it just drags the pirate across the system and beyond its native
    // leash, where the behavior loop clears its combat state. Wait for real prey.
    .filter(t=>t.ship&&t.ore>0&&valid(t.ship.position)&&
     !String(t.ship.mode||"").toUpperCase().includes("WARP")&&
     !t.ship.pendingWarp&&!t.ship.warpState);
  const actions=[];
  for(const rawID of pirates){
   const id=pos(rawID),ship=id&&scene.getEntityByID(id);
   if(!ship||!valid(ship.position)||String(ship.mode||"").includes("WARP"))continue;
   const key=systemID+":"+id,old=leases.get(key),now=clock();
   if(old&&now<old.nextAt&&scene.getEntityByID(old.targetID))continue;
   const controller=getController(id);
   const activeTarget=pos(controller?.currentTargetID);
   const manual=controller?.manualOrder;
   const manualTarget=pos(manual?.targetID);
   const ownedTarget=old&&pos(old.targetID)?scene.getEntityByID(old.targetID):null;
   const issuedAt=Number(old?.issuedAtMs)||0;
   let pendingRelease=null;
   // An approach that never became a real warp: the native pursuit movement
   // (GOTO) overrode it, so the prey is still across the system. Release our own
   // order instead of re-issuing the same unexecutable command, which is what
   // kept the target fleet in "aggressed" with an empty response wing.
   if(old?.phase==="warp-to-hauler"&&ownedTarget&&valid(ownedTarget.position)&&
      issuedAt>0&&now>=issuedAt+approachVerifyMs&&
      range(ship.position,ownedTarget.position)>250000&&!warping(ship)){
    const released=releaseOrder(id,"APPROACH_NOT_WARPING");
    leases.set(key,{nextAt:now+releaseCooldownMs,targetID:Number(old.targetID),
     targetRole:String(old.targetRole||""),phase:"released",issuedAtMs:now});
    actions.push({pirateID:id,targetID:Number(old.targetID),
     targetRole:String(old.targetRole||""),action:"approach-unflyable",
     distanceMeters:range(ship.position,ownedTarget.position),...released});
    continue;
   }
   // A live native player battle or somebody else's explicit NPC command
   // always takes priority. A passive currentTargetID is NOT proof that
   // our prior warp-to-miner approach has become a weapon attack.
   const playerShipIDs=new Set(Array.from(scene.sessions?.values?.()||[])
     .map(s=>pos(s?._space?.shipID)).filter(Boolean));
   const ownedApproach=old?.phase==="warp-to-hauler"&&
    old.targetID===activeTarget&&Boolean(scene.getEntityByID(activeTarget));
   if(activeTarget&&scene.getEntityByID(activeTarget)){
    // Never steal a naturally acquired native target. Only the target
    // of OUR unfinished warp lease may be promoted to a weapon attack.
    if(!ownedApproach)continue;
    if(playerShipIDs.has(activeTarget))continue;
    if(manual?.type==="attack"&&manualTarget===activeTarget)continue;
    if(manual&&manual.type!=="resumeBehavior"&&
      (!ownedApproach||manual.type!=="warp"))continue;
    // Keep native unsolicited combat/retaliation from being hijacked.
    const aggroAt=Number(controller?.lastAggressedAtMs);
    if(Number.isFinite(aggroAt)&&aggroAt>0&&now>=aggroAt&&
      now-aggroAt<120000)continue;
   }else if(manual&&manual.type!=="resumeBehavior"&&
      !(old?.phase==="warp-to-hauler"&&manual.type==="warp")){
    // Our own previous order is still pinned on the hull (manual attack and the
    // native controller never acquired a lock, so currentTargetID stays 0). It is
    // not a rival order: it is ours. One owner per record - release it and decide
    // fresh this tick instead of leaving the hull in an endless GOTO, which is
    // what kept the convoy in "aggressed" with an empty response wing.
    if(!(holdsAttack(controller)&&old&&issuedAt>0))continue;
    const stillFar=ownedTarget&&valid(ownedTarget.position)&&
     range(ship.position,ownedTarget.position)>250000;
    // A near target keeps its attack order for a fair lock window; only then is
    // an order that never acquired a native lock released.
    if(!stillFar&&now<issuedAt+attackNoLockMs)continue;
    pendingRelease=releaseOrder(id,stillFar?"FOR_APPROACH":"ATTACK_NO_NATIVE_LOCK");
    if(!stillFar){
     leases.set(key,{nextAt:now+releaseCooldownMs,targetID:Number(old.targetID),
      targetRole:String(old.targetRole||""),phase:"released",issuedAtMs:now});
     actions.push({pirateID:id,targetID:Number(old.targetID),
      targetRole:String(old.targetRole||""),action:"attack-no-lock",
      distanceMeters:ownedTarget&&valid(ownedTarget.position)?
       range(ship.position,ownedTarget.position):null,...pendingRelease});
     continue;
    }
    // A release that was refused leaves the order in place: re-tasking would
    // collide with it, so report the exact refusal and stay idle.
    if(!pendingRelease.released){
     actions.push({pirateID:id,targetID:Number(old.targetID),
      targetRole:String(old.targetRole||""),action:"approach-unflyable",
      distanceMeters:range(ship.position,ownedTarget.position),...pendingRelease});
     continue;
    }
    // Released for the approach: fall through and issue the warp below.
   }

   // After an approach, prefer the very same *still authorized* hull.
   // The convoy may move, but the raid should not silently target-hop.
   const authorized=candidates.filter(x=>x.id!==id&&
    canAttack({systemID,pirateID:id,targetID:x.id}));
   // A loaded hauler is the better prize ONLY when it is really here. Sorting by
   // role first sent pirates after a hauler that was 4.4e11 m away (a stuck fleet
   // position) while a loaded miner sat 39 km away - and every hull beyond the
   // native leash is pulled home with its combat state cleared, so the raid could
   // never fire. Distance decides; the role only breaks a near tie.
   const nearestFirst=authorized.slice().sort((a,b)=>
    range(ship.position,a.ship.position)-range(ship.position,b.ship.position)||
    (b.role==="hauler"?1:0)-(a.role==="hauler"?1:0)||
    Number(a.id)-Number(b.id));
   const nearestDistance=nearestFirst.length?range(ship.position,nearestFirst[0].ship.position):Infinity;
   const preferredHauler=nearestFirst.find(x=>x.role==="hauler"&&
    range(ship.position,x.ship.position)<=nearestDistance+HAULER_PREFERENCE_METERS);
   const target=authorized.find(x=>old?.phase==="warp-to-hauler"&&
    x.id===old.targetID)||preferredHauler||nearestFirst[0];
   if(!target)continue;
   const distance=range(ship.position,target.ship.position);
   let result,action,released=pendingRelease;
   if(distance>250000){
    // One owner per record: the hull's own previous attack order is released
    // BEFORE the approach. While it stands, the native behaviour loop keeps
    // flying its own subwarp pursuit (mode GOTO) and the issued warp is not the
    // command that moves the ship, so the approach never really flies.
    if(!released&&holdsAttack(controller)&&(old?.phase==="attack"||manualTarget===target.id))
     released=releaseOrder(id,"FOR_APPROACH");
    result=warp(id,target.id,{forceImmediateStart:true});
    action="warp-to-hauler";
   }else{
    result=attack(id,target.id,{allowWeapons:true,keepLock:true});
    action="attack";
   }
   // Warping to the convoy is only the approach, not the raid itself:
   // reevaluate soon after landing and issue a genuine weapon attack.
   const retryMs=result?.success===true?(action==="attack"?cooldownMs:15000):60000;
   leases.set(key,{nextAt:now+retryMs,targetID:target.id,targetRole:target.role,
    phase:action,issuedAtMs:now});
   if(result?.success===true)actions.push({pirateID:id,targetID:target.id,
    targetRole:target.role,action,distanceMeters:distance,
    ...(released||{})});
  }
  return {status:"OK",eligibleTargetCount:candidates.length,actions};
 }
 function activePirateIDs(sceneForSystem){
  const active=new Set();
  const now=clock();
  for(const [key,lease] of leases){
   if(lease.nextAt<=now||lease.phase==="released")continue;
   const [system,id]=key.split(":").map(Number);
   const scene=sceneForSystem(system);
   if(scene?.getEntityByID?.(id)&&scene.getEntityByID(lease.targetID))active.add(id);
  }
  return active;
 }
 return {tick,activePirateIDs,snapshot:()=>Array.from(leases,([id,value])=>({id,...value}))};
}
module.exports={createRaids};
