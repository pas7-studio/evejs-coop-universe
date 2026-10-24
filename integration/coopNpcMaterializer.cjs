"use strict";
// Bridges persistent virtual identities to native NPC entities in an observed
// scene. A mapping is process-local: native EveJS remains authoritative.
const assignments=new Map();
function ids(entries){return (Array.isArray(entries)?entries:[]).map(x=>Number(x?.entity?.itemID)).filter(x=>Number.isSafeInteger(x)&&x>0);}
function createBridge({spawn,exists,limit=3}){
 if(typeof spawn!=="function"||typeof exists!=="function")throw Error("native spawn and exists required");
 if(!Number.isInteger(limit)||limit<1||limit>10)throw Error("materialization limit 1..10");
 function reconcile(systemID,pilots){
  const current=new Set((pilots||[]).map(p=>p.id));
  // Do not delete native NPCs when virtual travel changes: they may be in
  // combat or observed. Merely release dead mappings.
  for(const [id,entry] of assignments){
    if(!exists(entry.systemID,entry.entityID))assignments.delete(id);
  }
  const results=[];
  for(const pilot of pilots||[]){
    if(results.length>=limit)break;
    if(!pilot?.id||!current.has(pilot.id))continue;
    const prior=assignments.get(pilot.id);
    if(prior&&exists(prior.systemID,prior.entityID)){results.push({pilotID:pilot.id,entityID:prior.entityID,reused:true});continue;}
    const result=spawn(systemID,pilot);
    const entityID=ids(result?.data?.spawned)[0];
    if(result?.success!==true||!entityID){results.push({pilotID:pilot.id,error:String(result?.errorMsg||"SPAWN_FAILED")});continue;}
    assignments.set(pilot.id,{systemID,entityID});
    results.push({pilotID:pilot.id,entityID,reused:false});
  }
  return results;
 }
 return {reconcile,snapshot:()=>Array.from(assignments,([pilotID,value])=>({pilotID,...value}))};
}
module.exports={createBridge};
