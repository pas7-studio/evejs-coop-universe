"use strict";
// Optional background driver of virtual world; no NPC ships materialized.
let world=null,timer=null,bridge=null,economy=null,lossBridge=null,factionDirector=null,patrolDirector=null,patrolNavigator=null,civilianOrders=null,life=null,identityRegistry=null,raidDirector=null;
const observedNpcIDs=new Set();
const visitedSystems=new Set();
const initializedNativeMiningScenes=new WeakSet();
let backgroundTicks=0;
let intelAnnouncer=null;
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
   travelMs:Number(process.env.EVEJS_COOP_VIRTUAL_TRAVEL_MS||120000)});
 const {createLife}=require("./coopNpcLife");
 life=createLife({file:process.env.EVEJS_COOP_LIFE_FILE||"/var/lib/evejs/coop-npc-life.json",
  recoveryMs:Number(process.env.EVEJS_COOP_CLONE_RECOVERY_MS||1800000)});
 world.advance();
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
     world.advance(pins);
     if(economy)economy.advance(world.snapshot().pilots);
   syncNativeDeliveries();
     if(factionDirector)factionDirector.advance(economy.snapshot().systems);
     advanceNativePatrolRoutes();
     // Raids own their NPC movement while pursuing real cargo ships.
     advanceNativeRaids();
     advanceNativeCivilianOrders();
     // A recovered NPC returns to a living system without player re-login.
     if(++backgroundTicks%4===0&&process.env.EVEJS_COOP_MATERIALIZE_NPCS==="1"){
       for(const systemID of visitedSystems){
         observeSession(null,{itemID:0,spaceState:{systemID}});
       }
     }
   }catch(e){console.warn("[CoopVirtualWorld] tick",e.message);}
 },30000);
 timer.unref?.();
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
function ensureNativeMining(scene){
 if(process.env.EVEJS_COOP_NATIVE_MINING!=="1"||!scene||initializedNativeMiningScenes.has(scene))return;
 // The stock mining scene lifecycle is designed to be idempotent:
 // its mining NPC startup registry prevents duplicate fleet seeding.
 require("../services/mining/miningRuntime").handleSceneCreated(scene);
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
function advanceNativeCivilianOrders(){
 if(!bridge||!civilianOrders||process.env.EVEJS_COOP_MATERIALIZE_NPCS!=="1")return [];
 const current=new Map(world.snapshot().pilots.map(p=>[p.id,p.systemID]));
 const assignments=bridge.snapshot().filter(p=>current.get(p.pilotID)===p.systemID);
 const blockedIDs=raidDirector?.activePirateIDs?.(systemID=>{
  const runtime=require("./runtime");
  return runtime.ensureScene(systemID,{refreshStargates:false});
 })||new Set();
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
   console.info("[CoopLivingWorld] Native pirate raid",JSON.stringify({systemID,actions:result.actions}));
   require("./coopWorldSignals").notifyRaid(scene,result.actions);
   require("./coopRuntimeProbe").observe("living-pirate-raid",null,
    {spaceState:{systemID}},{actions:result.actions});
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
      ensureNativeMining(scene);
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
