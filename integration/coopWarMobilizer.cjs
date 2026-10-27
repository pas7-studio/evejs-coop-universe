"use strict";
// FW-003C: automatically mobilize EXISTING idle native patrol ships only.
// The original 30s A-Life tick owns scheduling. No hull/ISK/ammo production,
// artificial travel, faction tag, scripted damage or invented military supply.
const pos=x=>Number.isSafeInteger(x)&&x>0;
const named=x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
const identifier=x=>typeof x==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(x);
const warp=s=>String(s?.mode||"").toUpperCase().includes("WARP")||
 !!(s?.pendingWarp||s?.warpState||s?.isWarping);
const enabled=env=>env.EVEJS_COOP_FACTION_WAR==="1"&&
 env.EVEJS_COOP_FACTION_WAR_FLEETS==="1"&&
 env.EVEJS_COOP_FACTION_WAR_MOBILIZE==="1"&&
 env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1"&&
 env.EVEJS_COOP_NPC_STRICT_AMMO==="1"&&
 env.EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE==="1"&&
 env.EVEJS_COOP_NPC_BANK_ATOMIC==="1"&&
 (env.EVEJS_COOP_ALIFE==="1"||env.EVEJS_COOP_NPC_ORDER_ARBITER==="1");
function createWarMobilizer({registry,readWarState,readLinks,sceneForSystem,
 getNativeEntity,getController,getFactionForCorporation,
 inspectReadiness,getOrderLeases,isTactical=()=>false,
 commandCap=null,
 clock=()=>Date.now(),env=process.env,maxPerTick=2,maxPerSide=2}={}){
 if(!registry?.snapshot||!registry?.execute||
  [readWarState,readLinks,sceneForSystem,getNativeEntity,getController,
   getFactionForCorporation,inspectReadiness,getOrderLeases,isTactical,clock]
   .some(x=>typeof x!=="function")||
  (commandCap!==null&&typeof commandCap!=="function")||
  !Number.isSafeInteger(maxPerTick)||maxPerTick<1||maxPerTick>4||
  !Number.isSafeInteger(maxPerSide)||maxPerSide<1||maxPerSide>4)
  throw Error("WAR_MOBILIZATION_NATIVE_AUTHORITIES_REQUIRED");
 let busy=false;
 function tick({systemIDs=[],dryRun=false}={}){
  if(!enabled(env))return {status:"DISABLED",mobilized:[]};
  if(busy)return {status:"BUSY",mobilized:[]};
  if(!Array.isArray(systemIDs)||systemIDs.length>20||systemIDs.some(x=>!pos(x)))
   return {status:"INVALID_SYSTEMS",mobilized:[]};
  busy=true;
  try{
   const now=clock();
   if(!pos(now))return {status:"CLOCK_UNSAFE",mobilized:[]};
   let state,assigned,links,leases;
   try{
    state=readWarState();
    assigned=registry.snapshot();
    links=readLinks();
    leases=getOrderLeases();
   }catch{return {status:"NATIVE_AUTHORITIES_UNAVAILABLE",mobilized:[]}}
   if(state?.version!==1||!state.wars||!state.campaigns||
    assigned?.version!==1||!assigned.ships||
    !Array.isArray(links)||links.length>10000||
    !Array.isArray(leases)||leases.length>10000)
    return {status:"INVALID_MOBILIZATION_STATE",mobilized:[]};
   const reachable=new Set(systemIDs);
   // One pass per tick instead of scanning the full identity registry
   // for every NPC candidate of every active campaign.
   const pilotCounts=new Map(),entityCounts=new Map();
   for(const l of links){
    if(named(l?.pilotID))
     pilotCounts.set(l.pilotID,(pilotCounts.get(l.pilotID)||0)+1);
    if(pos(l?.entityID))
     entityCounts.set(l.entityID,(entityCounts.get(l.entityID)||0)+1);
   }
   const candidateLinks=links.filter(l=>reachable.has(l?.systemID)&&named(l?.pilotID)&&
    pilotCounts.get(l.pilotID)===1&&pos(l.entityID)&&
    entityCounts.get(l.entityID)===1&&l.role==="patrol")
    .sort((a,b)=>a.entityID-b.entityID).slice(0,512);
   const existing=new Set(Object.keys(assigned.ships).map(Number));
   const usedPilots=new Set(Object.values(assigned.ships).map(x=>x?.pilotID));
   const mobilized=[];
   // Diagnostics only: the exact first failed check per candidate, so a silent
   // "nothing mobilized" tick can be explained instead of guessed at.
   const rejected=[];
   const rejectedPerSide=new Map();
   const sideRejects=(side)=>{
    const key=String(side||"");
    const count=rejectedPerSide.get(key)||0;
    rejectedPerSide.set(key,count+1);
    return count;
   };
   // Campaign IDs are user-independent server-generated records, never chat
   // input. Sort deterministically to prevent tick-order oscillations.
   const campaigns=Object.values(state.campaigns)
    .filter(c=>c&&identifier(c.campaignID)&&identifier(c.warID)&&
     ["PREPARING","ASSAULT"].includes(c.state)&&
     state.wars[c.warID]?.state==="ACTIVE")
    .sort((a,b)=>(a.startedAt||0)-(b.startedAt||0)||
     a.campaignID.localeCompare(b.campaignID)).slice(0,16);
   for(const c of campaigns){
    if(mobilized.length>=maxPerTick)break;
    const w=state.wars[c.warID];
    if(!pos(w?.attackerFactionID)||!pos(w.defenderFactionID)||
     w.attackerFactionID===w.defenderFactionID||
     !pos(c.sourceSystemID)||!pos(c.targetSystemID))continue;
    const sides=[
     {factionID:w.defenderFactionID,systemID:c.targetSystemID,role:"DEFENDER"},
     {factionID:w.attackerFactionID,systemID:c.state==="PREPARING"?
      c.sourceSystemID:c.targetSystemID,role:"ATTACKER"}
    ];
    for(const side of sides){
     if(mobilized.length>=maxPerTick)break;
     if(!reachable.has(side.systemID))continue;
     // Only a hull physically in THIS side's system can fight there. An assault
     // campaign's attacker side is the target system, so a warship left behind in
     // the campaign source system must not occupy a battle slot: it is neither
     // co-located with the defender nor able to fire at it.
     const inSideSystem=s=>s?.campaignID===c.campaignID&&
      s.factionID===side.factionID&&s.systemID===side.systemID;
     let existingSide=Object.values(assigned.ships).filter(inSideSystem).length;
     existingSide+=mobilized.filter(inSideSystem).length;
     // A side may only field as many ships as its commander's rank allows
     // (recruit 1 ... admiral 25), and never more than the global hard cap.
     let sideLimit=maxPerSide;
     if(typeof commandCap==="function"){
      const commanded=[...Object.values(assigned.ships),...mobilized]
       .filter(inSideSystem).map(s=>s.pilotID);
      let cap=0;
      try{
       cap=Number(commandCap({campaignID:c.campaignID,factionID:side.factionID,
        systemID:side.systemID,assignedPilotIDs:commanded}));
      }catch{cap=0}
      if(!Number.isSafeInteger(cap)||cap<1)cap=1;
      sideLimit=Math.max(1,Math.min(maxPerSide,cap));
     }
     if(existingSide>=sideLimit)continue;
     let scene;
     try{scene=sceneForSystem(side.systemID)}catch{continue}
     if(scene?.systemID!==side.systemID||
      typeof scene.getEntityByID!=="function")continue;
     const playerIDs=new Set([...(scene.sessions?.values?.()||[])]
      .map(x=>Number(x?._space?.shipID)).filter(pos));
     for(const link of candidateLinks){
      if(existingSide>=sideLimit||mobilized.length>=maxPerTick)break;
      const id=link?.entityID;
      const cheap=!pos(id)?"INVALID_ENTITY":!named(link.pilotID)?"INVALID_PILOT":
       link.role!=="patrol"?"NOT_PATROL_ROLE":link.systemID!==side.systemID?"WRONG_SYSTEM":
       existing.has(id)?"ALREADY_ASSIGNED":usedPilots.has(link.pilotID)?"PILOT_IN_USE":
       playerIDs.has(id)?"PLAYER_SHIP":isTactical(id)?"TACTICAL_BUSY":"";
      if(cheap){
       // WRONG_SYSTEM is per-side noise, not a blocker: report only candidates
       // that are really in this side's system.
       if(dryRun&&cheap!=="WRONG_SYSTEM"&&sideRejects(side.role)<8)
        rejected.push({entityID:id,pilotID:String(link?.pilotID||""),side:side.role,reason:cheap});
       continue;
      }
      // Uniqueness already proven using the bounded registry index above.
      if(leases.some(x=>x.entityID===id&&x.systemID===side.systemID&&
       (["ISSUING","OUTCOME_UNKNOWN"].includes(x.phase)||
        (x.phase==="ACTIVE"&&Number(x.expiresAt)>now)))){
       if(dryRun&&sideRejects(side.role)<8)
        rejected.push({entityID:id,pilotID:link.pilotID,side:side.role,reason:"ORDER_LEASE_ACTIVE"});
       continue;
      }
      let ship,native,ctrl,ready,faction;
      try{
       ship=scene.getEntityByID(id);native=getNativeEntity(id);
       ctrl=getController(id);
       faction=getFactionForCorporation(native?.corporationID);
       ready=inspectReadiness({entityID:id,ship,
        systemID:side.systemID,corporationID:native?.corporationID});
      }catch{
       if(dryRun&&sideRejects(side.role)<8)
        rejected.push({entityID:id,pilotID:link.pilotID,side:side.role,reason:"NATIVE_LOOKUP_THREW"});
       continue;
      }
      let fail="";
      if(!ship||ship.kind!=="ship"||ship.nativeNpc!==true||
       ship.itemID!==id||ship.session?.characterID||warp(ship))fail="SHIP_NOT_IDLE_NATIVE";
      else if(!native||native.entityID!==id||native.systemID!==side.systemID||
       !pos(native.corporationID)||ship.corporationID!==native.corporationID)fail="NATIVE_RECORD_DRIFT";
      else if(faction!==side.factionID)fail="WRONG_FACTION";
      else if(ctrl?.entityID!==id||ctrl.systemID!==side.systemID)fail="NO_CONTROLLER";
      else if(ctrl.currentTargetID||ctrl.manualOrder)fail="CONTROLLER_BUSY";
      else if(ready?.ready!==true)fail="NOT_READY:"+String((ready&&ready.reason)||"UNKNOWN");
      if(fail){
       if(dryRun&&sideRejects(side.role)<8)
        rejected.push({entityID:id,pilotID:link.pilotID,side:side.role,reason:fail});
       continue;
      }
      if(dryRun){
       // Read-only: report what a real tick would mobilize, never write.
       mobilized.push({status:"DRY_RUN_MOBILIZABLE",entityID:id,
        pilotID:link.pilotID,systemID:side.systemID,
        factionID:side.factionID,campaignID:c.campaignID,role:side.role});
       continue;
      }
      const command={
       type:"ASSIGN",eventID:"wm:"+c.campaignID+":"+id,
       entityID:id,systemID:side.systemID,pilotID:link.pilotID,
       corporationID:native.corporationID,factionID:side.factionID,
       fleetID:"fw-"+c.campaignID+"-"+side.factionID,
       warID:c.warID,campaignID:c.campaignID,
       proofID:"native-muster:"+id
      };
      let result;
      try{result=registry.execute(command)}catch{
       // The SQLite commit may be ambiguous. Never issue another mutation
       // in this tick after an exception from the authoritative writer.
       return {status:"NATIVE_COMMIT_UNCERTAIN",mobilized};
      }
      if(result?.status!=="APPLIED")continue;
      existing.add(id);usedPilots.add(link.pilotID);existingSide++;
      mobilized.push({status:"NATIVE_PATROL_MOBILIZED",
       entityID:id,pilotID:link.pilotID,systemID:side.systemID,
       factionID:side.factionID,campaignID:c.campaignID,
       fleetID:command.fleetID,role:side.role});
     }
    }
   }
   return {status:dryRun?"DRY_RUN":"OBSERVED",mobilized,rejected,
    activeCampaignCount:campaigns.length};
  }finally{busy=false}
 }
 return Object.freeze({tick});
}
module.exports={createWarMobilizer,enabled};
