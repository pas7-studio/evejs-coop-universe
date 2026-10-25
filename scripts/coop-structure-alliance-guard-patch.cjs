"use strict";
const ALLIANCE="server/src/services/corporation/allianceRegistryRuntime.js";
const STRUCTURES="server/src/services/sovereignty/sovPlayerDeployment.js";
const ACTIONS=["UpdateAlliance","UpdateApplication","GMForceAcceptApplication","DeclareExecutorSupport","DeleteMember","SetPrimeHour","SetCapitalSystem","CancelCapitalSystemTransition","DeclareWarAgainst","SetRelationship","DeleteRelationship","AddAllianceContact","EditAllianceContact","RemoveAllianceContacts","EditContactsRelationshipID","CreateLabel","DeleteLabel","EditLabel","AssignLabels","RemoveLabels","AddBulletin","UpdateBulletin","DeleteBulletin","UpdateBulletinOrder"];
const flag='process.env.EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD === "1"';
const helper='require(path.join(__dirname, "../../space/coopStructureAllianceAuthority"))';
const allianceParameters='session,args,readCharacter:getCharacterRecord,readCorporation:getCorporationRecord,readMember:require("./corporationRuntimeState").getCorporationMember,readAlliance:getAllianceRecord,readAllianceMembers:getAllianceCorporationIDs,readAllianceRuntime:getAllianceRuntime,readStructure:require("../structure/structureState").getStructureByID';
const corpParameters='session,readCharacter:require("../character/characterState").getCharacterRecord,readCorporation:require("../corporation/corporationState").getCorporationRecord,readMember:require("../corporation/corporationRuntimeState").getCorporationMember';
function patch(source,file,remove=false){
 if(![ALLIANCE,STRUCTURES].includes(file))throw Error("CHAT32_SOURCE_TARGET_MISMATCH");
 if(typeof source!=="string"||!source.includes("\n"))throw Error("CHAT32_EMPTY_SOURCE");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let hooks=[];
 if(file===ALLIANCE){
  hooks=ACTIONS.map(action=>{
   const alternatives=[
    "  Handle_"+action+"(args, session) {",
    "  Handle_"+action+"(args, session, kwargs) {"
   ];
   const anchor=alternatives.find(a=>source.includes(a+eol));
   if(!anchor)throw Error("CHAT32_MISSING_ALLIANCE_METHOD_"+action);
   const guard='    if ('+flag+' && !'+helper+'.admitAlliance({action:"'+action+'",'+allianceParameters+'}).ok) return null;';
   return {anchor,guard};
  });
 }else{
  hooks=[
   {signature:"requireValidDeploymentSession(session)",action:"deploy",extra:""},
   {signature:"requireStructureManagementSession(session, structure)",action:"manage",extra:",structure"},
   {signature:"requireStructureDecommissionSession(session, structure)",action:"decommission",extra:",structure"}
  ].map(x=>({
   anchor:"function "+x.signature+" {",
   guard:'  if ('+flag+' && !'+helper+'.admitStructure({action:"'+x.action+'",'+corpParameters+x.extra+'}).ok) throwWrappedUserError("CrpAccessDenied",{reason:"Native corporate owner or role not verified"});'
  }));
 }
 let result=source;
 for(const {anchor,guard} of hooks){
  const key=anchor+eol,added=guard+eol;
  if(result.split(key).length!==2)throw Error("CHAT32_NATIVE_ANCHOR_DRIFT_"+anchor);
  if(remove){
   if(result.includes(key+added))result=result.replace(key+added,key);
   else if(result.includes(added))throw Error("CHAT32_PARTIAL_HOOK_"+anchor);
  }else{
   if(result.includes(key+added))continue;
   if(result.includes(added))throw Error("CHAT32_PARTIAL_HOOK_"+anchor);
   result=result.replace(key,key+added);
  }
 }
 return result;
}
module.exports={patch,ALLIANCE,STRUCTURES,ACTIONS};
