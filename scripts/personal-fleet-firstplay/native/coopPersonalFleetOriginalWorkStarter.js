'use strict';
/**
 * PF88: single original EveJS server startup owner.
 * Only Code/server/index.js may activate this, before TCP starts accepting
 * sessions. Never accepts HTTP/chat/client values, env-provided code paths,
 * fake authority callbacks or invented catalog entries.
 */
const bootstrap=require('./coopPersonalFleetOriginalWorkBootstrap');
const originalCatalogProof=require('./coopPersonalFleetOriginalCatalogProof');
const STARTUP_SOURCE='ORIGINAL_EVEJS_PERSONAL_FLEET_STARTUP_V1';
const truth=x=>x===true;
let attempted=false;
const flags=env=>['EVEJS_COOP_PERSONAL_FLEET_NATIVE',
 'EVEJS_COOP_PERSONAL_FLEET_CHAT',
 'EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION',
 'EVEJS_COOP_NATIVE_ATOMIC_ROWS'].map(k=>[k,env[k]]);
function createOriginalWorkStarter({originalWorkConfiguration}={}){
 if(!originalWorkConfiguration||
    originalWorkConfiguration.source!=='ORIGINAL_EVEJS_PERSONAL_FLEET_WORK_CONFIGURATION_V1'||
    typeof originalWorkConfiguration.loadNativeAuthoredCatalog!=='function'||
    typeof originalWorkConfiguration.loadNativeSalaryPolicies!=='function'||
    typeof originalWorkConfiguration.createNativeWriterHooks!=='function')
  throw Error('PF88_ORIGINAL_SOURCE_CONFIGURATION_REQUIRED');
 return Object.freeze({start(){
  if(attempted)throw Error('PF88_ORIGINAL_SERVER_STARTUP_ATTEMPTED_STICKY');
  attempted=true;
  const env=process.env;
  if(env.EVEJS_COOP_PERSONAL_FLEET_NATIVE!=='1'||
     env.EVEJS_COOP_PERSONAL_FLEET_CHAT!=='1'||
     env.EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION!=='1'||
     env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=='1')
   throw Error('PF88_ORIGINAL_STARTUP_REQUIRED_FLAGS_NOT_INSTALLED');
  // The original SERVER source owns all writer hooks. The physical catalog
  // cannot be supplied through environment/chat or mutable external JSON.
  const authoredCatalog=originalWorkConfiguration.loadNativeAuthoredCatalog();
  if(!Array.isArray(authoredCatalog)||authoredCatalog.length<1||
     authoredCatalog.length>12)
   throw Error('PF88_ORIGINAL_NATIVE_NPC_CATALOG_UNAVAILABLE');
  const authoredSalaryPolicies=originalWorkConfiguration.loadNativeSalaryPolicies();
  if(!Array.isArray(authoredSalaryPolicies)||authoredSalaryPolicies.length<1||
     authoredSalaryPolicies.length>12)
   throw Error('PF91_ORIGINAL_AUTHORED_NPC_SALARY_POLICIES_UNAVAILABLE');
  // PF102 original SDE NPC, physical profile and corporation wallet readback
  // MUST succeed before any native writer, chat authority or timer is installed.
  // Authored JS catalogue entries alone never prove an actual hireable NPC.
  const proof=originalCatalogProof.verifyOriginalCatalogAndWages(
   authoredCatalog,authoredSalaryPolicies);
  if(proof?.verified!==true||
     proof.source!=='ORIGINAL_EVEJS_PF102_CATALOG_PREFLIGHT_V1'||
     proof.npcCount!==authoredCatalog.length)
   throw Error('PF102_ORIGINAL_CATALOG_PREFLIGHT_FAILED: '+
    String(proof?.reason||'UNVERIFIED_SOURCE'));
  const originalHooks=originalWorkConfiguration.createNativeWriterHooks();
  if(!originalHooks||
     originalHooks.source!=='ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1'||
     originalHooks.verifyOriginalWriterHooks?.()!==true||
     originalHooks.allWritersFenced?.()!==true||
     originalHooks.allWalletWritersFenced?.()!==true)
   throw Error('PF88_ORIGINAL_NATIVE_WRITER_FENCES_UNVERIFIED');
  const result=bootstrap.createOriginalWorkBootstrap({authoredCatalog,authoredSalaryPolicies,originalHooks});
  if(result?.status!=='INSTALLED_WORK_SOURCE_BOUND'||
     result.mayEnable?.()!==true||
     result.getOperationalStatus?.().ready!==true)
   throw Error('PF88_ORIGINAL_WORK_BOOT_NOT_OPERATIONAL');
  return Object.freeze({status:'ORIGINAL_WORK_READY',
   source:STARTUP_SOURCE,mayEnable:result.mayEnable,
   getOperationalStatus:result.getOperationalStatus,
   // Only server shutdown owns this, never commands or player sessions.
   stopNativeStationTick:result.stopNativeStationTick});
 }});
}
function bootstrapOriginalWorkFromServer(){
 // A missing original source config is deliberately fatal *before* TCP.
 // Local engine owner must implement a real config with source-level hooks;
 // this package never ships a fake success function.
 let source;
 try{source=require('./coopPersonalFleetOriginalWorkConfiguration');}
 catch(e){throw Error('PF88_ORIGINAL_WORK_CONFIG_NOT_INSTALLED: '+String(e?.code||'UNKNOWN'));}
 return createOriginalWorkStarter({originalWorkConfiguration:source}).start();
}
module.exports=Object.freeze({STARTUP_SOURCE,createOriginalWorkStarter,
 bootstrapOriginalWorkFromServer,flags});
