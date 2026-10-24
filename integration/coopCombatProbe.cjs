"use strict";
// Read-only live combat sampling for ships/NPCs in the same authoritative scene.
// No damage application, target acquisition, fake Destiny packets or inventories.
function num(x){const v=Number(x);return Number.isFinite(v)?v:null;}
function entitySample(entity){
 if(!entity)return null;
 const c=entity.conditionState||{};
 return {
   itemID:num(entity.itemID),kind:String(entity.kind||""),
   mode:String(entity.mode||""),
   shieldCharge:num(c.shieldCharge),
   armorDamage:num(c.armorDamage),
   structureDamage:num(c.damage),
   destroyed:Boolean(entity.destroyed||entity.isDestroyed),
 };
}
function launch({scene,shipIDs,npcIDs,probe,session,ship,intervalMs=1000,maxSamples=60}){
 const allIDs=[...new Set([...shipIDs,...npcIDs].map(num).filter(x=>x>0))];
 if(!scene||typeof scene.getEntityByID!=="function"||typeof probe?.observe!=="function")return;
 let count=0;
 const timer=setInterval(()=>{
   try {
     count++;
     const entities=allIDs.map(id=>({id,sample:entitySample(scene.getEntityByID(id))}));
     const observers=Array.from(scene.sessions?.values?.()||[])
       .filter(x=>x?.socket?.destroyed!==true)
       .map(x=>({characterID:num(x.characterID),shipID:num(x?._space?.shipID),
         visibleEntityIDs:allIDs.filter(id=>x?._space?.visibleDynamicEntityIDs?.has(id))}));
     probe.observe("native-npc-combat-sample",session,ship,{sample:count,entities,observers});
     if(count>=maxSamples||npcIDs.every(id=>!scene.getEntityByID(id)))clearInterval(timer);
   }catch(error){
     clearInterval(timer);
     try{console.warn("[CoopCombatProbe] sample failed:",error.message);}catch{}
   }
 },intervalMs);
 timer.unref?.();
 return ()=>clearInterval(timer);
}
module.exports={launch,entitySample};
