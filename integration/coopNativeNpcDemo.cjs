"use strict";
// Optional native EveJS NPC encounter. This is NOT X-Eve Living Universe.
// Uses the authoritative existing npcRuntime and never creates fake players.
const seenSystems = new Set();
function positive(v) { const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null; }
function maybeSpawn(session,ship) {
  if(process.env.EVEJS_COOP_NATIVE_NPC_DEMO!=="1")return;
  const systemID=positive(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
  const allowedSystem=positive(process.env.EVEJS_COOP_NATIVE_NPC_SYSTEM_ID);
  if(!systemID||!allowedSystem||systemID!==allowedSystem)return;
  if(!ship||!positive(ship.itemID))return;
  if(seenSystems.has(systemID))return;
  seenSystems.add(systemID);
  setImmediate(()=>{
    try {
      // Defer until after the ship's login transition. A failed spawn remains
      // suppressed for this process, preventing an unbounded retry loop.
      const npcRuntime=require("./npc/npcRuntime");
      const amount=Number(process.env.EVEJS_COOP_NATIVE_NPC_COUNT||1);
      if(!Number.isInteger(amount)||amount<1||amount>3)throw Error("NPC_COUNT must be 1..3");
      const result=npcRuntime.spawnBatchInSystem(systemID,{
        amount,entityType:"npc",transient:true,broadcast:true,
        // Use upstream's standard native pool, not an invented NPC type.
        defaultPoolID:"npc_hostiles",fallbackProfileID:"generic_hostile",
      });
      require("./coopRuntimeProbe").observe("native-npc-spawn",session,ship,{
        success:result?.success===true,
        spawnedCount:Array.isArray(result?.data?.spawned)?result.data.spawned.length:0,
        error:result?.success===true?undefined:String(result?.errorMsg||"NPC_SPAWN_FAILED"),
      });
    }catch(error){
      try {console.warn("[CoopNpcDemo] spawn failed:",error.message);}catch{}
    }
  });
}
module.exports={maybeSpawn};
