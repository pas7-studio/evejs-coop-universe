"use strict";
// Optional background driver of virtual world; no NPC ships materialized.
let world=null,timer=null;
function start(){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1"||world)return;
 const route=String(process.env.EVEJS_COOP_VIRTUAL_ROUTE||"30000142,30000144").split(",").map(Number);
 const {createWorld}=require("./coopVirtualWorld");
 world=createWorld({file:process.env.EVEJS_COOP_VIRTUAL_STATE_FILE||"/var/lib/evejs/coop-virtual-world.json",
   route,population:Number(process.env.EVEJS_COOP_VIRTUAL_POPULATION||16),
   travelMs:Number(process.env.EVEJS_COOP_VIRTUAL_TRAVEL_MS||120000)});
 world.advance();
 timer=setInterval(()=>{try{world.advance();}catch(e){console.warn("[CoopVirtualWorld] tick",e.message);}},30000);
 timer.unref?.();
}
function observeSession(session,ship){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1")return;
 try{
  start();
  const systemID=Number(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
  const residents=world.residents(systemID);
  require("./coopRuntimeProbe").observe("virtual-world-presence",session,ship,{
    residentCount:residents.length,residents:residents.map(p=>({id:p.id,faction:p.faction,journeys:p.journeys}))
  });
 }catch(error){console.warn("[CoopVirtualWorld] observe",error.message);}
}
module.exports={start,observeSession};
