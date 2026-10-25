"use strict";
// Source contract auditor only: no client, structure or inventory mutation.
const fs=require("node:fs"),path=require("node:path");
const contracts=Object.freeze({
 "structure/moonExtractionsService.js":["Handle_StartNewExtraction", "Handle_FractureChunkWithStructure", "completeExpiredExtractionsInState", "resourcesByStructureID"],
 "structure/autoMoonMiningService.js":["Handle_RequestMiningDetails", "Handle_RequestMiningCycleOutput", "FLAG_MOON_MATERIAL_BAY", "normalizeCycleOutput"],
 "structure/structureAutoMoonFuelRuntime.js":["applyAutoMoonMinerFuelCycle", "consumeMetenoxFuel", "hourlyMagmaticGas", "prepareAutoMoonMinerServiceStateTransition"],
 "structure/structureServiceModules.js":["consumeStructureServiceModuleCycleFuel", "syncStructureServiceModuleState"],
 "structure/structureIndustryJobs.js":["syncIndustryJobsForServiceStateTransition", "cancelIndustryJobsForStructureLifecycle"],
 "structure/structureState.js":["tickMoonExtractions", "handleStructureDestroyedLoot", "cancelIndustryJobsForStructureLifecycle"],
 "inventory/invBrokerService.js":["_ensureCanAccessMoonMaterialBay", "OUTPUT_ONLY", "_validateMoonMaterialBaySourceAccess"],
 "inventory/itemStore.js":["listContainerItems", "grantItemsToOwnerLocation", "consumeInventoryItemQuantity"],
 "mining/miningIndustry.js":["reprocessItems", "buildReprocessingQuoteForItem"],
 "industry/industryAccess.js":["canTakeFromOwnerLocation", "hasCorporationIndustryJobAccess"],
});
function auditSources(sources={}){
 const evidence=Object.fromEntries(Object.entries(contracts).map(([file,tokens])=>{
  const content=sources[file];
  return [file,{state:typeof content!=="string"?"MISSING":
    tokens.every(token=>content.includes(token))?"PINNED_SOURCE_PRESENT":"DRIFTED",
    missing:typeof content==="string"?tokens.filter(token=>!content.includes(token)):tokens}];
 }));
 return {pinnedSha:"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f",evidence,
   physicalMoonChunkProven:false,nativeAutoMoonGrantProven:false,
   playerInventoryDeliveryProven:false,serverCycleTested:false,clientTested:false,
   statement:"Source symbols and RPC surfaces are not gameplay, native atomicity or physical moon yield proof"};
}
function readSources(codePath){
 const root=path.resolve(codePath),out={};
 for(const file of Object.keys(contracts)){
  const name=path.join(root,"server/src/services",file);
  try{out[file]=fs.readFileSync(name,"utf8");}
  catch(e){if(e.code!=="ENOENT")throw e;out[file]=null;}
 }
 return out;
}
if(require.main===module){
 try{if(process.argv.length!==4||process.argv[2]!=="--code-path")
  throw Error("usage: node scripts/coop-moon-native-audit.cjs --code-path <pinned EveJS/Code>");
  const result=auditSources(readSources(process.argv[3]));
  console.log(JSON.stringify(result,null,2));
  if(Object.values(result.evidence).some(row=>row.state!=="PINNED_SOURCE_PRESENT"))process.exitCode=2;
 }catch(e){console.error("MOON_SOURCE_AUDIT_ERROR:",e.message);process.exitCode=2;}
}
module.exports={auditSources,readSources,contracts};
