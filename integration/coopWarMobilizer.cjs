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
 clock=()=>Date.now(),env=process.env,maxPerTick=2,maxPerSide=2}={}){
 if(!registry?.snapshot||!registry?.execute||
  [readWarState,readLinks,sceneForSystem,getNativeEntity,getController,
   getFactionForCorporation,inspectReadiness,getOrderLeases,isTactical,clock]
   .some(x=>typeof x!=="function")||
  !Number.isSafeInteger(maxPerTick)||maxPerTick<1||maxPerTick>4||
  !Number.isSafeInteger(maxPerSide)||maxPerSide<1||maxPerSide>4)
  throw Error("WAR_MOBILIZATION_NATIVE_AUTHORITIES_REQUIRED");
 let busy=false;
 function tick({systemIDs=[]}={}){
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
   const existing=new Set(Object.keys(assigned.ships).map(Number));
   const usedPilots=new Set(Object.values(assigned.ships).map(x=>x?.pilotID));
   const mobilized=[];
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
     let existingSide=Object.values(assigned.ships).filter(s=>
      s?.campaignID===c.campaignID&&s.factionID===side.factionID).length;
     existingSide+=mobilized.filter(s=>s.campaignID===c.campaignID&&
      s.factionID===side.factionID).length;
     if(existingSide>=maxPerSide)continue;
     let scene;
     try{scene=sceneForSystem(side.systemID)}catch{continue}
     if(scene?.systemID!==side.systemID||
      typeof scene.getEntityByID!=="function")continue;
     const playerIDs=new Set([...(scene.sessions?.values?.()||[])]
      .map(x=>Number(x?._space?.shipID)).filter(pos));
     for(const link of [...links].sort((a,b)=>
      Number(a?.entityID||0)-Number(b?.entityID||0))){
      if(existingSide>=maxPerSide||mobilized.length>=maxPerTick)break;
      const id=link?.entityID;
      if(!pos(id)||!named(link.pilotID)||link.role!=="patrol"||
       link.systemID!==side.systemID||existing.has(id)||
       usedPilots.has(link.pilotID)||playerIDs.has(id)||isTactical(id))
       continue;
      // Must be a UNIQUE persisted native pilot->ship association.
      if(links.filter(x=>x.pilotID===link.pilotID||x.entityID===id).length!==1)
       continue;
      if(leases.some(x=>x.entityID===id&&x.systemID===side.systemID&&
       (["ISSUING","OUTCOME_UNKNOWN"].includes(x.phase)||
        (x.phase==="ACTIVE"&&Number(x.expiresAt)>now))))continue;
      let ship,native,ctrl,ready,faction;
      try{
       ship=scene.getEntityByID(id);native=getNativeEntity(id);
       ctrl=getController(id);
       faction=getFactionForCorporation(native?.corporationID);
       ready=inspectReadiness({entityID:id,ship,
        systemID:side.systemID,corporationID:native?.corporationID});
      }catch{continue}
      if(!ship||ship.kind!=="ship"||ship.nativeNpc!==true||
       ship.itemID!==id||ship.session?.characterID||warp(ship)||
       !native||native.entityID!==id||native.systemID!==side.systemID||
       !pos(native.corporationID)||ship.corporationID!==native.corporationID||
       faction!==side.factionID||
       ctrl?.entityID!==id||ctrl.systemID!==side.systemID||
       ctrl.currentTargetID||ctrl.manualOrder||
       ready?.ready!==true)continue;
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
   return {status:"OBSERVED",mobilized,activeCampaignCount:campaigns.length};
  }finally{busy=false}
 }
 return Object.freeze({tick});
}
module.exports={createWarMobilizer,enabled};
