"use strict";
// Optional background driver of virtual world; no NPC ships materialized.
let world=null,timer=null,bridge=null,economy=null,lossBridge=null,factionDirector=null,patrolDirector=null,patrolNavigator=null,civilianOrders=null,life=null,identityRegistry=null,raidDirector=null,tacticsDirector=null,activityDirector=null;
const observedNpcIDs=new Set();
const visitedSystems=new Set();
const initializedNativeMiningScenes=new WeakSet();
let backgroundTicks=0,headlessBootTimer=null;
let intelAnnouncer=null,recognitionAnnouncer=null;
function syncNativeDeliveries(){
 if(!economy||process.env.EVEJS_COOP_NATIVE_HAUL_CARGO!=="1")return;
 const depot=require("./coopNativeDepot").getNativeDepot();
 const result=economy.syncNativeDeliveries(depot.snapshot().totals);
 if(result.quantity>0){
  console.info("[CoopLivingWorld] Real NPC ore delivered to virtual system supply",JSON.stringify(result));
  require("./coopRuntimeProbe").observe("living-real-ore-delivery",null,null,{
    quantity:result.quantity,systemTotals:depot.snapshot().totals
  });
 }
}
function start(){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1"||world)return;
 const route=String(process.env.EVEJS_COOP_VIRTUAL_ROUTE||"30000142,30000144").split(",").map(Number);
 const {createWorld}=require("./coopVirtualWorld");
 world=createWorld({file:process.env.EVEJS_COOP_VIRTUAL_STATE_FILE||"/var/lib/evejs/coop-virtual-world.json",
   route,population:Number(process.env.EVEJS_COOP_VIRTUAL_POPULATION||16),
   travelMs:Number(process.env.EVEJS_COOP_VIRTUAL_TRAVEL_MS||120000),
   migrateFactions:process.env.EVEJS_COOP_FACTION_LAYOUT_V2==="1"});
 const {createLife}=require("./coopNpcLife");
 life=createLife({file:process.env.EVEJS_COOP_LIFE_FILE||"/var/lib/evejs/coop-npc-life.json",
  recoveryMs:Number(process.env.EVEJS_COOP_CLONE_RECOVERY_MS||1800000)});
 // Headless bootstrap must resolve persisted native pilot links before
 // advancing virtual travel; otherwise a real parked ship can be
 // virtually transported to another system during process startup.
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1")world.advance();
 if(process.env.EVEJS_COOP_VIRTUAL_ECONOMY==="1"){
   const {createEconomy}=require("./coopVirtualEconomy");
   economy=createEconomy({
     file:process.env.EVEJS_COOP_ECONOMY_FILE||"/var/lib/evejs/coop-economy.json"
   });
   economy.advance(world.snapshot().pilots);
   syncNativeDeliveries();
   const {createFactionDirector}=require("./coopFactionDirector");
   factionDirector=createFactionDirector({
     file:process.env.EVEJS_COOP_FACTION_FILE||"/var/lib/evejs/coop-factions.json"
   });
   factionDirector.advance(economy.snapshot().systems);
 }
 timer=setInterval(()=>{
   try {
     // Physical NPC ships stay in their actual EveJS solar system.
     const pins={};
     if(bridge)for(const entry of bridge.snapshot())pins[entry.pilotID]=entry.systemID;
     // Stock EveJS mining fleet hulls also have durable pilot identities.
     if(identityRegistry)for(const [pilotID,entry] of Object.entries(identityRegistry.snapshot().links)){
       if(!pins[pilotID]&&identityRegistry.get(pilotID))pins[pilotID]=entry.systemID;
     }
     if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||identityRegistry)
       world.advance(pins);
     if(economy)economy.advance(world.snapshot().pilots);
   syncNativeDeliveries();
     if(factionDirector)factionDirector.advance(economy.snapshot().systems);
     advanceNativePatrolRoutes();
     // Raids own their NPC movement while pursuing real cargo ships.
     advanceNativeRaids();
     advanceNativeTactics();
     advanceNpcRecognition();
     advanceNativeCivilianOrders();
     observeNativeActivity();
     // A recovered NPC returns to a living system without player re-login.
     if(++backgroundTicks%4===0&&process.env.EVEJS_COOP_MATERIALIZE_NPCS==="1"){
       for(const systemID of visitedSystems){
         observeSession(null,{itemID:0,spaceState:{systemID}});
       }
     }
   }catch(e){console.warn("[CoopVirtualWorld] tick",e.message);}
 },30000);
 timer.unref?.();
 scheduleHeadlessWorldBoot(route);
}
// Initialize real EveJS scenes without waiting for a human to log in.
// This is not a client/gameplay proof: only existing native entities count.
function scheduleHeadlessWorldBoot(route){
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||headlessBootTimer)return;
 const systems=new Set(route.filter(id=>Number.isSafeInteger(id)&&id>0));
 if(!systems.size)return;
 require("./coopRuntimeProbe").observe("living-headless-boot-requested",null,null,
  {systems:[...systems],status:"SCHEDULED_NOT_VERIFIED"});
 let attempts=0;
 const attempt=()=>{
  headlessBootTimer=null;
  attempts++;
  for(const systemID of [...systems]){
   try{
    const runtime=require("./runtime");
    const mining=require("../services/mining/miningNpcOperations");
    observeSession(null,{itemID:0,spaceState:{systemID}});
    const scene=runtime.ensureScene(systemID,{refreshStargates:false});
    const fleetShips=(mining.getMiningFleetsForSystem(systemID)||[])
     .flatMap(f=>[...(f.minerEntityIDs||[]),...(f.haulerEntityIDs||[])])
     .filter(id=>scene?.getEntityByID?.(Number(id)));
    const links=Object.values(identityRegistry?.snapshot().links||{})
     .filter(link=>Number(link.systemID)===systemID&&
      scene?.getEntityByID?.(Number(link.entityID)));
    const topology=require("./coopNpcTopology").waypoints(scene);
    const beltCount=topology.filter(p=>p.kind==="asteroidBelt").length;
    const verified=beltCount>0&&fleetShips.length>0&&links.length>0;
    // A real named native NPC can operate even if stock mining or static
    // topology is incomplete. Readiness remains a stricter separate gate.
    if(links.length)visitedSystems.add(systemID);
    if(verified)systems.delete(systemID);
    require("./coopRuntimeProbe").observe("living-headless-boot-system",null,
     {spaceState:{systemID}},
     {attempt:attempts,status:verified?"NATIVE_SCENE_READY":"PENDING_NATIVE_SCENE",
      realAsteroidBelts:beltCount,physicalMiningShips:fleetShips.length,
      actualNamedNpcShips:links.length,sceneReady:Boolean(scene)});
   }catch(error){
    console.warn("[CoopHeadlessWorld] system "+systemID,error.message);
    require("./coopRuntimeProbe").observe("living-headless-boot-system",null,
     {spaceState:{systemID}},{attempt:attempts,status:"FAILED",reason:String(error.message).slice(0,120)});
   }
  }
  if(systems.size&&attempts<6){
   headlessBootTimer=setTimeout(attempt,30000);
   headlessBootTimer.unref?.();
  }else if(systems.size){
   require("./coopRuntimeProbe").observe("living-headless-boot-incomplete",null,null,
    {pendingSystems:[...systems],attempts});
  }
 };
 headlessBootTimer=setTimeout(attempt,10000);
 headlessBootTimer.unref?.();
}
function ensurePatrolNavigator(runtime,npc){
 if(patrolNavigator)return;
 const {createPatrolNavigator}=require("./coopPatrolNavigator");
 patrolNavigator=createPatrolNavigator({
  sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  warp:(id,point,options)=>npc.warpToPoint(id,point,options),
  orbit:(id,targetID,range)=>npc.orbit(id,targetID,range)
 });
}
function advanceNativePatrolRoutes(){
 if(!patrolDirector||!patrolNavigator||process.env.EVEJS_COOP_FACTION_PATROLS!=="1")return;
 for(const [systemID,entityIDs] of Object.entries(patrolDirector.snapshot())){
  const result=patrolNavigator.tick(Number(systemID),entityIDs);
  if(result.orders?.length)console.info("[CoopFactionPatrol] native waypoint orders",JSON.stringify({systemID,orders:result.orders}));
 }
}
function ensureNativeMining(scene,systemID){
 if(process.env.EVEJS_COOP_NATIVE_MINING!=="1"||!scene||initializedNativeMiningScenes.has(scene))return;
 // Stock EveJS mining operations prevent duplicate fleet seeding.
 // If the scene was only partially initialized, retry on the next pass.
 require("../services/mining/miningRuntime").handleSceneCreated(scene);
 const mining=require("../services/mining/miningNpcOperations");
 if((mining.getMiningFleetsForSystem(systemID)||[]).some(f=>
    [...(f.minerEntityIDs||[]),...(f.haulerEntityIDs||[])]
      .some(id=>scene.getEntityByID?.(Number(id)))))
   initializedNativeMiningScenes.add(scene);
}
function ensureCivilianOrders(runtime,npc){
 if(civilianOrders)return;
 const {createCivilianOrders}=require("./coopCivilianOrders");
 civilianOrders=createCivilianOrders({
  sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  warp:(id,point,options)=>npc.warpToPoint(id,point,options),
  orbit:(id,targetID,range)=>npc.orbit(id,targetID,range)
 });
}
function observeNativeActivity(){
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||!identityRegistry||!visitedSystems.size)return;
 if(!activityDirector)activityDirector=require("./coopNativeActivity").createActivity();
 const runtime=require("./runtime");
 const store=require("./npc/nativeNpcStore");
 const registry=require("./npc/npcRegistry");
 const links=Object.values(identityRegistry.snapshot().links||{});
 for(const systemID of visitedSystems){
  try{
   const scene=runtime.ensureScene(systemID,{refreshStargates:false});
   const sample=activityDirector.sample({
    systemID,scene,links,
    getCargo:id=>store.listNativeCargoForEntity(id),
    getController:id=>registry.getControllerByEntityID(id)
   });
   // A sample with no activity is not a PASS. Emit occasional liveness
   // evidence without growing the log on every quiet NPC tick.
   if(sample.status==="SAMPLED"&&
      (sample.observedMovement||sample.oreGrowth||sample.engagedNativeNpcs||backgroundTicks%10===0)){
     require("./coopRuntimeProbe").observe("living-native-activity",null,
      {spaceState:{systemID}},sample);
   }
  }catch(error){console.warn("[CoopNativeActivity] sample",systemID,error.message);}
 }
}
function advanceNativeCivilianOrders(){
 if(!bridge||!civilianOrders||process.env.EVEJS_COOP_MATERIALIZE_NPCS!=="1")return [];
 const current=new Map(world.snapshot().pilots.map(p=>[p.id,p.systemID]));
 const assignments=bridge.snapshot().filter(p=>current.get(p.pilotID)===p.systemID);
 const blockedIDs=raidDirector?.activePirateIDs?.(systemID=>{
  const runtime=require("./runtime");
  return runtime.ensureScene(systemID,{refreshStargates:false});
 })||new Set();
 if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
 const orders=civilianOrders.tick(assignments,economy?.snapshot().pilots||{},{blockedIDs});
 if(orders.length)console.info("[CoopVirtualWorld] native civilian work routes",JSON.stringify(orders));
 return orders;
}
function advanceNativeRaids(){
 if(process.env.EVEJS_COOP_NPC_RAIDS!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
 const mining=require("../services/mining/miningNpcOperations");
 const nativeStore=require("./npc/nativeNpcStore");
 const controllers=require("./npc/npcRegistry");
 if(!raidDirector){
  raidDirector=require("./coopNativeRaids").createRaids({
   warp:(pirateID,targetID,options)=>npc.warpToEntity(pirateID,targetID,options),
   attack:(pirateID,targetID,options)=>npc.issueAttackOrder(pirateID,targetID,options)
  });
 }
 const roles=economy?.snapshot().pilots||{};
 for(const systemID of visitedSystems){
  const pirates=bridge.snapshot().filter(p=>p.systemID===systemID&&roles[p.pilotID]?.role==="pirate")
   .map(x=>x.entityID);
  if(!pirates.length)continue;
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const fleets=mining.getMiningFleetsForSystem(systemID);
  const fleetShips=fleets.flatMap(f=>[
   ...(f.minerEntityIDs||[]).map(id=>({id:Number(id),role:"miner"})),
   ...(f.haulerEntityIDs||[]).map(id=>({id:Number(id),role:"hauler"}))
  ]);
  const result=raidDirector.tick({
   systemID,scene,pirates,fleetShips,
   getCargo:id=>nativeStore.listNativeCargoForEntity(id),
   getController:id=>controllers.getControllerByEntityID(id)
  });
  if(result.actions.length){
   // Only a successful native ATTACK order against another named NPC
   // is faction tension evidence. Warp approaches aren't battles.
   if(factionDirector&&identityRegistry){
    const actualLinks=Object.values(identityRegistry.snapshot().links||{})
     .filter(link=>Number(link.systemID)===Number(systemID)&&
      scene.getEntityByID(Number(link.entityID)));
    const byEntity=new Map(actualLinks.map(link=>[Number(link.entityID),link]));
    const factions=new Map(world.snapshot().pilots.map(p=>[p.id,p.faction]));
    for(const action of result.actions){
     if(action.action!=="attack")continue;
     const attacker=byEntity.get(Number(action.pirateID));
     const defender=byEntity.get(Number(action.targetID));
     if(!attacker||!defender)continue;
     const aggressorFaction=factions.get(attacker.pilotID);
     const defenderFaction=factions.get(defender.pilotID);
     if(!aggressorFaction||!defenderFaction||aggressorFaction===defenderFaction)continue;
     factionDirector.onEngagement({
      eventID:"native-raid:"+systemID+":"+action.pirateID+":"+action.targetID+":"+Math.floor(Date.now()/600000),
      systemID,aggressorFaction,defenderFaction,
      attackerPilotID:attacker.pilotID,defenderPilotID:defender.pilotID
     });
    }
   }
   console.info("[CoopLivingWorld] Native pirate raid",JSON.stringify({systemID,actions:result.actions}));
   require("./coopWorldSignals").notifyRaid(scene,result.actions);
   require("./coopRuntimeProbe").observe("living-pirate-raid",null,
    {spaceState:{systemID}},{actions:result.actions});
  }
 }
}
function advanceNativeTactics(){
 if(process.env.EVEJS_COOP_NATIVE_TACTICS!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
 const controllers=require("./npc/npcRegistry");
 const damage=require("./combat/damage"),scramble=require("./modules/hostileModuleRuntime");
 if(!tacticsDirector){
  tacticsDirector=require("./coopNpcTactics").createTactics({
   warpToPoint:(id,point,options)=>npc.warpToPoint(id,point,options),
   warpToEntity:(id,targetID,options)=>npc.warpToEntity(id,targetID,options),
   attack:(id,targetID,options)=>npc.issueAttackOrder(id,targetID,options),
   resumeBehavior:id=>npc.resumeBehavior(id),
   stopOrder:id=>npc.issueOrder(id,{type:"stop"}),
   notify:event=>{
    require("./coopRuntimeProbe").observe("living-npc-tactical-event",null,
     {spaceState:{systemID:event.systemID}},{...event});
    if(!["npc-help-request","npc-retreat"].includes(event.kind))return;
    const scene=runtime.ensureScene(event.systemID,{refreshStargates:false});
    const ship=scene?.getEntityByID(event.entityID);
    const name=String(ship?.itemName||ship?.name||"An NPC").slice(0,70);
    const message=event.kind==="npc-help-request"
     ?"[Living Universe] "+name+" called "+event.responders+" allied NPCs for help after coming under fire."
     :"[Living Universe] "+name+" is badly damaged and trying to warp away.";
    const chat=require("../services/chat/chatHub");
    for(const session of scene?.sessions?.values?.()||[]){
     if(session?._space?.initialStateSent!==true||!session.characterID)continue;
     try{chat.sendSystemMessage(session,message);}catch(error){console.warn("[CoopNpcTactics] chat",error.message);}
    }
   }
  });
 }
 const ships=[...new Map([...bridge.snapshot(),...Object.values(identityRegistry?.snapshot().links||{})]
  .filter(x=>x.entityID&&x.pilotID).map(x=>[Number(x.entityID),x])).values()],
  pilotData=new Map(world.snapshot().pilots.map(p=>[p.id,p]));
 const roles=economy?.snapshot().pilots||{};
 for(const systemID of visitedSystems){
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const assignments=ships.filter(p=>Number(p.systemID)===Number(systemID))
    .map(a=>({...a,role:roles[a.pilotID]?.role||"patrol",
      faction:pilotData.get(a.pilotID)?.faction||"independent"}));
  if(!assignments.length)continue;
  const activeControllers={};
  for(const a of assignments)activeControllers[a.entityID]=controllers.getControllerByEntityID(a.entityID);
  const output=tacticsDirector.tick({
   systemID,scene,assignments,controllers:activeControllers,
   waypoints:require("./coopNpcTopology").waypoints(scene),
   isScrambled:entity=>scramble.isEntityWarpScrambled(entity),
   additionalResponders:(victim,attackerID,liveScene)=>{
    if(process.env.EVEJS_COOP_NPC_MEMORY!=="1")return 0;
    const aggressor=liveScene?.getEntityByID(attackerID);
    const characterID=require("./coopNativeConsequences").resolveAuthenticatedPlayerID(liveScene,aggressor);
    if(!characterID)return 0;
    const memory=require("./coopNpcMemory").getNativeMemory().recall({
     pilotID:victim.pilotID,characterID
    });
    return memory.status==="KNOWN"&&memory.score<=-30?1:0;
   },
   health:entity=>{
    const max=damage.getEntityMaxHealthLayers(entity),
      now=damage.getEntityCurrentHealthLayers(entity,max);
    return {
     armor:max.armor>0?now.armor/max.armor:1,
     structure:max.structure>0?now.structure/max.structure:1
    };
   }
  });
  // Persist only genuine successful native NPC attack orders, not virtual
  // background timers or imagined battle outcomes.
  if(factionDirector)for(const event of output.events){
   if(event.kind!=="reinforcement-attack")continue;
   const byEntity=new Map(assignments.map(x=>[Number(x.entityID),x]));
   const aggressor=byEntity.get(Number(event.responderID));
   const defender=byEntity.get(Number(event.targetID));
   if(!aggressor||!defender||aggressor.faction===defender.faction)continue;
   factionDirector.onEngagement({
    eventID:"native-order:"+systemID+":"+event.responderID+":"+event.targetID+":"+Math.floor(Date.now()/600000),
    aggressorFaction:aggressor.faction,defenderFaction:defender.faction,systemID,
    attackerPilotID:aggressor.pilotID,defenderPilotID:defender.pilotID
   });
  }
  if(output.events.length)console.info("[CoopLivingWorld] Native tactics",JSON.stringify({systemID,events:output.events}));
 }
}

function advanceNpcRecognition(){
 if(process.env.EVEJS_COOP_NPC_MEMORY!=="1"||!identityRegistry||!visitedSystems.size)return;
 const runtime=require("./runtime");
 if(!recognitionAnnouncer){
  const {createRecognition}=require("./coopNpcRecognition");
  recognitionAnnouncer=createRecognition({
   lookup:query=>require("./coopNpcMemory").getNativeMemory().recall(query),
   send:(session,message)=>require("../services/chat/chatHub").sendSystemMessage(session,message)
  });
 }
 const links=Object.values(identityRegistry.snapshot().links||{});
 for(const systemID of visitedSystems){
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  if(!scene?.sessions?.values)continue;
  for(const session of scene.sessions.values()){
   const result=recognitionAnnouncer.tick({session,scene,links});
   if(result.status==="DELIVERED")require("./coopRuntimeProbe").observe(
    "living-npc-recognizes-player",session,null,result);
  }
 }
}
function observeSession(session,ship){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1")return;
 try{
  start();
  const systemID=Number(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
  if(!Number.isSafeInteger(systemID)||systemID<=0)return;
  if(session)visitedSystems.add(systemID);
  const allResidents=world.residents(systemID);
  const roles=economy?.snapshot().pilots||{};
  const ranks={pirate:0,miner:1,hauler:2,trader:3,patrol:4};
  const residents=allResidents.map(p=>({
    ...p,role:roles[p.id]?.role||
      ["miner","hauler","patrol","trader","pirate"][(Number(p.id.slice(-3))-1)%5]
  })).filter(p=>life?.canFly(p.id)!==false)
    .sort((a,b)=>(ranks[a.role]??5)-(ranks[b.role]??5)||a.id.localeCompare(b.id));
  for(const p of residents)life?.recover(p.id);
  if(economy)economy.advance(world.snapshot().pilots);
   syncNativeDeliveries();
  if(process.env.EVEJS_COOP_MATERIALIZE_NPCS==="1"){
    try{
      const runtime=require("./runtime");
      const npc=require("./npc/npcRuntime");
      const scene=runtime.ensureScene(systemID,{refreshStargates:false});
      // A passing TCP test can still run against an empty virtual space.
      // Record real topology of the authoritative EveJS scene on arrival.
      if(session||process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT==="1"){
        const points=require("./coopNpcTopology").waypoints(scene);
        require("./coopRuntimeProbe").observe("living-world-topology",session,ship,{
          systemID,realWaypoints:points.length,
          realAsteroidBelts:points.filter(p=>p.kind==="asteroidBelt").length,
          realStations:points.filter(p=>p.kind==="station").length,
          realStargates:points.filter(p=>p.kind==="stargate").length,
          sceneReady:Boolean(scene),evidenceSource:session?"CLIENT_SESSION":"HEADLESS_NATIVE_SCENE"
        });
      }
      ensureNativeMining(scene,systemID);
      if(!bridge){
        const {createBridge}=require("./coopNpcMaterializer");
        const {createRegistry}=require("./coopIdentityRegistry");
        identityRegistry=createRegistry({
          file:process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json",
          exists:(system,id)=>Boolean(runtime.ensureScene(system,{refreshStargates:false})?.getEntityByID(id))
        });
        bridge=createBridge({
          registry:identityRegistry,
          limit:Number(process.env.EVEJS_COOP_MATERIALIZE_LIMIT||2),
          exists:(system,id)=>Boolean(runtime.ensureScene(system,{refreshStargates:false})?.getEntityByID(id)),
          spawn:(system,pilot)=>{
            const nativeScene=runtime.ensureScene(system,{refreshStargates:false});
            const anchor=require("./coopNpcTopology").anchorOptions(nativeScene);
            if(!anchor)return {success:false,errorMsg:"NO_NATIVE_SYSTEM_ANCHOR"};
            const hostile=pilot.role==="pirate";
            return npc.spawnBatchInSystem(system,{
              ...anchor,amount:1,entityType:"npc",transient:true,broadcast:true,
              defaultPoolID:"npc_hostiles",fallbackProfileID:"generic_hostile",
              // Pirates retain native EveJS aggression. Civilians and ordinary
              // guards move and work without automatically attacking players.
              ...(hostile?{}:{behaviorOverrides:{
                autoAggro:false,autoActivateWeapons:false,targetPreference:"none"
              }})
            });
          }
        });
      }
      const nativeMining=process.env.EVEJS_COOP_NATIVE_MINING==="1";
      const present=require("./coopNpcPresentation").presentVirtualPilot;
      let industry={status:"DISABLED",fleets:[],assignments:[]};
      if(nativeMining){
        try{
          const mining=require("../services/mining/miningNpcOperations");
          const cargo=require("./npc/nativeNpcStore");
          industry=require("./coopNativeIndustry").observe({
            systemID,scene,pilots:residents,registry:identityRegistry,
            getFleets:id=>mining.getMiningFleetsForSystem(id),
            getCargo:id=>cargo.listNativeCargoForEntity(id),
            present
          });
          require("./coopRuntimeProbe").observe("living-native-industry",session,ship,{
            status:industry.status,fleets:industry.fleets,
            linkedPilots:industry.assignments
          });
        }catch(error){console.warn("[CoopNativeIndustry]",error.message);}
      }
      // Never create a generic fake miner/hauler when EveJS already has
      // physical mining NPCs with actual mining lasers and ore cargo.
      const materialize=nativeMining?residents.filter(p=>p.role!=="miner"&&p.role!=="hauler"):residents;
      const result=bridge.reconcile(systemID,materialize);
      ensureCivilianOrders(runtime,npc);
      const pilotsByID=new Map(residents.map(p=>[p.id,p]));
      const presented=[];
      for(const link of result){
        if(!link.entityID||!pilotsByID.has(link.pilotID))continue;
        const change=present(scene,link.entityID,pilotsByID.get(link.pilotID));
        if(change.status==="UPDATED"||change.status==="BROADCAST_FAILED")presented.push({pilotID:link.pilotID,...change});
      }
      if(presented.length)require("./coopRuntimeProbe").observe("virtual-world-identity-projected",session,ship,{presented});
      for(const entry of result){
        if(!entry.entityID||observedNpcIDs.has(entry.entityID))continue;
        const npcID=entry.entityID;
        // Headless boot has no authenticated player ship. Do not open
        // a bogus 0-ship combat probe; native wreck hooks still record losses.
        if(!session||!Number.isSafeInteger(Number(ship?.itemID))||Number(ship.itemID)<=0)continue;
        observedNpcIDs.add(npcID);
        const probe=require("./coopRuntimeProbe");
        require("./coopCombatProbe").launch({
          scene,shipIDs:[Number(ship.itemID)],npcIDs:[npcID],
          session,ship,probe,intervalMs:1000,maxSamples:180,
          onConfirmedWreck:wreck=>confirmedWreck(session,ship,wreck.sourceNpcID,wreck.wreckID)
        });
      }
      if(session&&process.env.EVEJS_COOP_LOCAL_INTEL==="1"){
        try{
          if(!intelAnnouncer){
            const {createAnnouncer}=require("./coopSystemIntel");
            intelAnnouncer=createAnnouncer({
              send:(pilot,message)=>require("../services/chat/chatHub").sendSystemMessage(pilot,message)
            });
          }
          const pirateIDs=result.filter(x=>x.entityID&&pilotsByID.get(x.pilotID)?.role==="pirate")
            .map(x=>x.entityID);
          const intel=intelAnnouncer.announce(session,scene,{fleets:industry.fleets,pirateIDs});
          if(intel.status==="DELIVERED")
            require("./coopRuntimeProbe").observe("living-local-intel",session,ship,{
              locationCount:intel.activity.length,messages:intel.messages
            });
        }catch(error){console.warn("[CoopSystemIntel]",error.message);}
      }
      const civilianActions=advanceNativeCivilianOrders();
      require("./coopRuntimeProbe").observe("virtual-world-materialization",session,ship,{
        civilianActions,
        assignments:result,sceneReady:Boolean(scene),
        livingShips:[
          ...result.filter(x=>x.entityID).map(x=>({pilotID:x.pilotID,entityID:x.entityID,role:pilotsByID.get(x.pilotID)?.role})),
          ...industry.assignments.map(x=>({pilotID:x.pilotID,entityID:x.entityID,role:x.role}))
        ],
        realMiningFleets:industry.fleets.length
      });
    }catch(error){console.warn("[CoopMaterializer]",error.message);}
  }
  if(process.env.EVEJS_COOP_FACTION_PATROLS==="1"&&factionDirector){
    try{
      const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
      if(!patrolDirector){
        const {createPatrolDirector}=require("./coopFactionPatrolRuntime");
        patrolDirector=createPatrolDirector({
          spawn:(id)=>{
            const nativeScene=runtime.ensureScene(id,{refreshStargates:false});
            const anchor=require("./coopNpcTopology").anchorOptions(nativeScene);
            if(!anchor)return {success:false,errorMsg:"NO_NATIVE_SYSTEM_ANCHOR"};
            return npc.spawnBatchInSystem(id,{
              ...anchor,amount:1,entityType:"npc",transient:true,broadcast:true,
              defaultPoolID:"npc_hostiles",fallbackProfileID:"generic_hostile",
              behaviorOverrides:{autoAggro:false,autoActivateWeapons:false,targetPreference:"none"}
            });
          },
          exists:(id,entityID)=>Boolean(runtime.ensureScene(id,{refreshStargates:false})?.getEntityByID(entityID))
        });
      }
      const factions=Object.values(factionDirector.snapshot().factions);
      const deployment=patrolDirector.reconcile(systemID,factions);
      if(deployment.active?.length){
        // Real point-of-interest warps; no player ship orbit anchor.
        ensurePatrolNavigator(runtime,npc);
        const routeOrders=patrolNavigator.tick(systemID,deployment.active);
        require("./coopRuntimeProbe").observe("virtual-faction-patrol-route",session,ship,routeOrders);
      }
      require("./coopRuntimeProbe").observe("virtual-faction-patrol",session,ship,deployment);
    }catch(error){console.warn("[CoopFactionPatrol]",error.message);}
  }
  require("./coopRuntimeProbe").observe("virtual-world-presence",session,ship,{
    residentCount:residents.length,residents:residents.map(p=>({id:p.id,name:p.name,role:p.role,faction:p.faction,journeys:p.journeys})),
    virtualEconomy:economy?.snapshot().systems[String(systemID)]||null
  });
 }catch(error){console.warn("[CoopVirtualWorld] observe",error.message);}
}
function confirmedWreck(session,ship,npcID,wreckID){
 if(!economy)return;
 try{
  if(!lossBridge){
   const {createLossBridge}=require("./coopNpcLossBridge");
   lossBridge=createLossBridge({
    file:process.env.EVEJS_COOP_LOSS_LEDGER_FILE||"/var/lib/evejs/coop-loss-ledger.json",
    recordLoss:(system,amount)=>economy.recordLoss(system,amount)
   });
  }
  const systemID=Number(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
  const result=lossBridge.accept({systemID,npcID,wreckID});
  if(result.status==="COMMITTED"&&factionDirector){
    factionDirector.onLoss({
      eventID:"wreck:"+wreckID,
      faction:"independent",systemID
    });
  }
  require("./coopRuntimeProbe").observe("virtual-economy-npc-loss",session,ship,{npcID,wreckID,status:result.status});
 }catch(e){console.warn("[CoopVirtualWorld] loss",e.message);}
}
function confirmedNativeNpcWreck(systemID,npcID,wreckID){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1")return;
 try{
  // A real wreck is the ONLY authority to mark a named pilot as defeated.
  const fs=require("node:fs");
  const linksFile=process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json";
  let registry;
  try{registry=JSON.parse(fs.readFileSync(linksFile,"utf8"));}catch(error){if(error.code==="ENOENT")return;throw error;}
  const link=Object.values(registry?.links||{}).find(x=>
   Number(x.entityID)===Number(npcID)&&Number(x.systemID)===Number(systemID));
  if(!link)return;
  start();
  const killed=life.markLoss({pilotID:link.pilotID,systemID,shipID:npcID,wreckID});
  require("./coopRuntimeProbe").observe("living-npc-destroyed",null,
   {itemID:npcID,spaceState:{systemID}},{
    pilotID:link.pilotID,name:link.name,faction:link.faction,
    status:killed.status,recoveryAt:killed.readyAt,wreckID
   });
  if(killed.status!=="RECOVERING"||!economy)return;
  const {createLossBridge}=require("./coopNpcLossBridge");
  if(!lossBridge)lossBridge=createLossBridge({
   file:process.env.EVEJS_COOP_LOSS_LEDGER_FILE||"/var/lib/evejs/coop-loss-ledger.json",
   recordLoss:(system,amount)=>economy.recordLoss(system,amount)
  });
  const result=lossBridge.accept({systemID,npcID,wreckID,pilotID:link.pilotID});
  if(result.status==="COMMITTED"&&factionDirector)
   factionDirector.onLoss({eventID:"wreck:"+wreckID,faction:link.faction||"independent",systemID});
  require("./coopRuntimeProbe").observe("living-npc-economic-loss",null,
   {itemID:npcID,spaceState:{systemID}},{
    pilotID:link.pilotID,name:link.name,wreckID,status:result.status
   });
 }catch(error){console.warn("[CoopVirtualWorld] native wreck consequence",error.message);}
}
module.exports={start,observeSession,confirmedWreck,confirmedNativeNpcWreck};
