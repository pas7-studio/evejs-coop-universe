"use strict";
// Optional background driver of virtual world; no NPC ships materialized.
let world=null,timer=null,bridge=null,economy=null,lossBridge=null,factionDirector=null,patrolDirector=null;
const observedNpcIDs=new Set();
function start(){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1"||world)return;
 const route=String(process.env.EVEJS_COOP_VIRTUAL_ROUTE||"30000142,30000144").split(",").map(Number);
 const {createWorld}=require("./coopVirtualWorld");
 world=createWorld({file:process.env.EVEJS_COOP_VIRTUAL_STATE_FILE||"/var/lib/evejs/coop-virtual-world.json",
   route,population:Number(process.env.EVEJS_COOP_VIRTUAL_POPULATION||16),
   travelMs:Number(process.env.EVEJS_COOP_VIRTUAL_TRAVEL_MS||120000)});
 world.advance();
 if(process.env.EVEJS_COOP_VIRTUAL_ECONOMY==="1"){
   const {createEconomy}=require("./coopVirtualEconomy");
   economy=createEconomy({
     file:process.env.EVEJS_COOP_ECONOMY_FILE||"/var/lib/evejs/coop-economy.json"
   });
   economy.advance(world.snapshot().pilots);
   const {createFactionDirector}=require("./coopFactionDirector");
   factionDirector=createFactionDirector({
     file:process.env.EVEJS_COOP_FACTION_FILE||"/var/lib/evejs/coop-factions.json"
   });
   factionDirector.advance(economy.snapshot().systems);
 }
 timer=setInterval(()=>{
   try {
     world.advance();
     if(economy)economy.advance(world.snapshot().pilots);
     if(factionDirector)factionDirector.advance(economy.snapshot().systems);
   }catch(e){console.warn("[CoopVirtualWorld] tick",e.message);}
 },30000);
 timer.unref?.();
}
function observeSession(session,ship){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1")return;
 try{
  start();
  const systemID=Number(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
  const residents=world.residents(systemID);
  if(economy)economy.advance(world.snapshot().pilots);
  if(process.env.EVEJS_COOP_MATERIALIZE_NPCS==="1"&&residents.length){
    try{
      const runtime=require("./runtime");
      const npc=require("./npc/npcRuntime");
      const scene=runtime.ensureScene(systemID,{refreshStargates:false});
      if(!bridge){
        const {createBridge}=require("./coopNpcMaterializer");
        const {createRegistry}=require("./coopIdentityRegistry");
        const registry=createRegistry({
          file:process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json",
          exists:(system,id)=>Boolean(runtime.ensureScene(system,{refreshStargates:false})?.getEntityByID(id))
        });
        bridge=createBridge({
          registry,
          limit:Number(process.env.EVEJS_COOP_MATERIALIZE_LIMIT||2),
          exists:(system,id)=>Boolean(runtime.ensureScene(system,{refreshStargates:false})?.getEntityByID(id)),
          spawn:(system,pilot)=>npc.spawnBatchInSystem(system,{
            amount:1,entityType:"npc",transient:true,broadcast:true,
            defaultPoolID:"npc_hostiles",fallbackProfileID:"generic_hostile",
          })
        });
      }
      const result=bridge.reconcile(systemID,residents);
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
      require("./coopRuntimeProbe").observe("virtual-world-materialization",session,ship,{
        assignments:result,sceneReady:Boolean(scene)
      });
    }catch(error){console.warn("[CoopMaterializer]",error.message);}
  }
  if(process.env.EVEJS_COOP_FACTION_PATROLS==="1"&&factionDirector){
    try{
      const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
      if(!patrolDirector){
        const {createPatrolDirector}=require("./coopFactionPatrolRuntime");
        patrolDirector=createPatrolDirector({
          spawn:(id)=>npc.spawnBatchInSystem(id,{
            amount:1,entityType:"npc",transient:true,broadcast:true,
            defaultPoolID:"npc_hostiles",fallbackProfileID:"generic_hostile"
          }),
          exists:(id,entityID)=>Boolean(runtime.ensureScene(id,{refreshStargates:false})?.getEntityByID(entityID))
        });
      }
      const factions=Object.values(factionDirector.snapshot().factions);
      const deployment=patrolDirector.reconcile(systemID,factions);
      require("./coopRuntimeProbe").observe("virtual-faction-patrol",session,ship,deployment);
    }catch(error){console.warn("[CoopFactionPatrol]",error.message);}
  }
  require("./coopRuntimeProbe").observe("virtual-world-presence",session,ship,{
    residentCount:residents.length,residents:residents.map(p=>({id:p.id,faction:p.faction,journeys:p.journeys})),
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
 if(process.env.EVEJS_COOP_VIRTUAL_ECONOMY!=="1"||process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1")return;
 try{
  // Account only NPCs explicitly linked to our virtual population.
  const fs=require("node:fs");
  const linksFile=process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json";
  let registry;
  try{registry=JSON.parse(fs.readFileSync(linksFile,"utf8"));}catch(e){if(e.code==="ENOENT")return;throw e;}
  const link=Object.values(registry?.links||{}).find(x=>Number(x.entityID)===Number(npcID)&&Number(x.systemID)===Number(systemID));
  if(!link)return;
  start();
  if(!economy)return;
  const {createLossBridge}=require("./coopNpcLossBridge");
  if(!lossBridge)lossBridge=createLossBridge({
   file:process.env.EVEJS_COOP_LOSS_LEDGER_FILE||"/var/lib/evejs/coop-loss-ledger.json",
   recordLoss:(system,amount)=>economy.recordLoss(system,amount)
  });
  const result=lossBridge.accept({systemID,npcID,wreckID});
  if(result.status==="COMMITTED"&&factionDirector)factionDirector.onLoss({eventID:"wreck:"+wreckID,faction:link.faction||"independent",systemID});
  require("./coopRuntimeProbe").observe("native-npc-kill-consequence",null,
   {itemID:npcID,spaceState:{systemID}},{npcID,wreckID,status:result.status});
 }catch(error){console.warn("[CoopVirtualWorld] native wreck consequence",error.message);}
}
module.exports={start,observeSession,confirmedWreck,confirmedNativeNpcWreck};
