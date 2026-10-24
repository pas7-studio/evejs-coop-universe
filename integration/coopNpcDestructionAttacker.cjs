"use strict";
// Only the *native EveJS destruction caller* may supply a final attacker.
// If it does not, no controller target, faction or weapon event may invent one.
const fs=require("node:fs");
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const named=x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
function verify({scene,victim,wreck,options={},links=[]}={}){
 const systemID=positive(scene?.systemID);
 const victimID=positive(victim?.itemID),wreckID=positive(wreck?.wreckID);
 if(!systemID||!victimID||!wreckID||victim?.nativeNpc!==true||
  victim?.kind!=="ship"||Number(wreck.systemID)!==systemID||
  Number(wreck.sourceEntityID)!==victimID||
  Number(wreck.launcherID)!==victimID||!Array.isArray(links))
  return {status:"INVALID_NATIVE_DESTRUCTION"};
 const v=links.find(x=>named(x?.pilotID)&&Number(x.systemID)===systemID&&
  Number(x.entityID)===victimID);
 if(!v)return {status:"VICTIM_NOT_NAMED"};
 const base={systemID,victimEntityID:victimID,victimPilotID:v.pilotID,wreckID};
 // This callback executes after native wreck creation. Source attribution
 // remains unproven until the upstream caller explicitly passes the
 // authoritative attackerEntity object used for the death event.
 const attacker=options?.attackerEntity;
 const attackerID=positive(attacker?.itemID);
 if(!attackerID)return {status:"UPSTREAM_ATTACKER_NOT_PROVIDED",...base};
 if(!attacker||attacker.kind!=="ship"||attacker.nativeNpc!==true||
  attackerID===victimID||scene.getEntityByID?.(attackerID)!==attacker)
  return {status:"UPSTREAM_ATTACKER_NOT_NATIVE",...base};
 const playerShips=new Set(Array.from(scene.sessions?.values?.()||[])
  .map(s=>positive(s?._space?.shipID)).filter(Boolean));
 if(playerShips.has(attackerID)||playerShips.has(victimID))
  return {status:"PLAYER_SHIP_EXCLUDED",...base};
 const a=links.find(x=>named(x?.pilotID)&&Number(x.systemID)===systemID&&
  Number(x.entityID)===attackerID);
 if(!a||a.pilotID===v.pilotID)return {status:"ATTACKER_NOT_NAMED",...base};
 return {status:"NATIVE_DESTRUCTION_ATTACKER_PROVIDED",...base,
  attackerEntityID:attackerID,attackerPilotID:a.pilotID,
  attribution:"UPSTREAM_DESTRUCTION_OPTIONS_ATTACKER_ENTITY"};
}
function note(scene,victim,options,wreck){
 if(process.env.EVEJS_COOP_NATIVE_WEAPON_EVIDENCE!=="1")return {status:"DISABLED"};
 try{
  const file=process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json";
  const saved=JSON.parse(fs.readFileSync(file,"utf8"));
  const proof=verify({scene,victim,options,wreck,links:Object.values(saved?.links||{})});
  if(proof.status!=="VICTIM_NOT_NAMED"&&proof.status!=="INVALID_NATIVE_DESTRUCTION")
   require("./coopRuntimeProbe").observe("living-native-destruction-attacker",null,
    {spaceState:{systemID:proof.systemID}},proof);
  return proof;
 }catch(error){
  if(error.code!=="ENOENT")console.warn("[CoopNpcDestructionAttacker] evidence",error.message);
  return {status:"UNAVAILABLE"};
 }
}
module.exports={verify,note};
