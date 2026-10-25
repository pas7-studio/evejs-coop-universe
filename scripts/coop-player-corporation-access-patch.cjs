"use strict";
// Chat 31. Reversible explicit, pinned EveJS one-statement insertion hooks.
// Called by Chat 01's shared installer after its normal reversible transforms.
const FLAG='process.env.EVEJS_COOP_PLAYER_CORP_ACCESS === "1"';
const GUARD='require("../../space/coopPlayerCorporationAccess")';
const changes={
 "industryAccess.js":[
  ['  return getSessionCorporationID(session) === toInt(ownerID, 0);',
   `  return getSessionCorporationID(session) === toInt(ownerID, 0) && (!(${FLAG}) || ${GUARD}.isMember(session, ownerID));`],
  ['  const corpRole = normalizeRoleValue(session && session.corprole);\n  return (corpRole & CORP_BLUEPRINT_VIEW_MASK) !== 0n;',
   `  if (${FLAG}) return ${GUARD}.canBlueprint(session, ownerID);\n  const corpRole = normalizeRoleValue(session && session.corprole);\n  return (corpRole & CORP_BLUEPRINT_VIEW_MASK) !== 0n;`],
  ['  return (corpRole & ROLE_FACTORY_MANAGER) === ROLE_FACTORY_MANAGER;',
   `  return (${FLAG} ? ${GUARD}.canIndustry(session, ownerID) : (corpRole & ROLE_FACTORY_MANAGER) === ROLE_FACTORY_MANAGER);`],
  ['  const queryRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG[toInt(flagID, 0)];',
   `  if (${FLAG}) return ${GUARD}.canView(session, ownerID, locationID, flagID);\n  const queryRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG[toInt(flagID, 0)];`],
  ['  const takeRole = CORP_HANGAR_TAKE_ROLE_BY_FLAG[toInt(flagID, 0)];',
   `  if (${FLAG}) return ${GUARD}.canTake(session, ownerID, locationID, flagID);\n  const takeRole = CORP_HANGAR_TAKE_ROLE_BY_FLAG[toInt(flagID, 0)];`],
  ['  const normalizedAccountKey = toInt(accountKey, 1000);',
   `  if (${FLAG}) return ${GUARD}.canWallet(session, ownerID, accountKey);\n  const normalizedAccountKey = toInt(accountKey, 1000);`],
 ],
 "corpRegistryRuntime.js":[
  ['    const customMessage = normalizeText(args && args[5], "");',
   `    const customMessage = normalizeText(args && args[5], "");\n    if (${FLAG} && !${GUARD}.canUpdateApplication(session,corporationID,applicationID,characterID,status)) return null;`],
  ['  Handle_InsertInvitation(args, session) {\n    const corporationID = resolveCorporationID(session);',
   `  Handle_InsertInvitation(args, session) {\n    const corporationID = resolveCorporationID(session);\n    if (${FLAG} && !${GUARD}.canRecruit(session,corporationID)) return null;`],
  ['  Handle_UpdateMember(args, session) {\n    const corporationID = resolveCorporationID(session);',
   `  Handle_UpdateMember(args, session) {\n    const corporationID = resolveCorporationID(session);\n    if (${FLAG} && !${GUARD}.canManageMembers(session,corporationID)) return null;`],
  ['  Handle_SetCorpWelcomeMail(args, session) {\n    const corporationID = resolveCorporationID(session);',
   `  Handle_SetCorpWelcomeMail(args, session) {\n    const corporationID = resolveCorporationID(session);\n    if (${FLAG} && !${GUARD}.canRecruit(session,corporationID)) return null;`],
  ['  Handle_GetMyGrantableRoles(args, session) {\n    const corporationID = resolveCorporationID(session);',
   `  Handle_GetMyGrantableRoles(args, session) {\n    const corporationID = resolveCorporationID(session);\n    if (${FLAG} && !${GUARD}.isMember(session,corporationID)) return [buildLong(0n),buildLong(0n),buildLong(0n),buildLong(0n)];`],
  ['  Handle_UpdateDivisionNames(args, session) {\n    const corporationID = resolveCorporationID(session);',
   `  Handle_UpdateDivisionNames(args, session) {\n    const corporationID = resolveCorporationID(session);\n    if (${FLAG} && !${GUARD}.canManageMembers(session,corporationID)) return null;`],
 ],
 "corpMemberActionState.js":[
  ['  const walletKey = resolveSourceWalletKey(session, corporationID);',
   `  if (${FLAG} && !${GUARD}.canExecuteActions(session,corporationID,actions)) return {success:false,errorMsg:"CORPORATION_MEMBER_ACTION_NOT_AUTHORIZED_OR_NOT_ATOMIC"};\n  const walletKey = resolveSourceWalletKey(session, corporationID);`],
 ],
 "officeManagerService.js":[
  ['function sessionCanRentOffice(session) {',
   `function sessionCanRentOffice(session) {\n  if (${FLAG}) return ${GUARD}.canRent(session,resolveCorporationID(session));`],
  ['function ensureCanUnrentOffice(session) {',
   `function ensureCanUnrentOffice(session) {\n  if (${FLAG} && !${GUARD}.canManageMembers(session,resolveCorporationID(session))) throwWrappedUserError("CrpAccessDenied");`],
 ],
 "invBrokerService.js":[
  ['    const sourceItem = sourceItemDescriptor.item;\n    const groupingContext = {',
   `    const sourceItem = sourceItemDescriptor.item;\n    if (${FLAG} && !${GUARD}.authorizeInventoryMove({session,sourceItemDescriptor,destination})) return {success:false,errorMsg:"CORPORATE_ASSET_ACCESS_DENIED"};\n    const groupingContext = {`],
  ['    const requiredRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG.get(numericFlag);',
   `    if (${FLAG} && this._isCorporationHangarFlag(numericFlag)) return ${GUARD}.canView(session,this._getCorporationId(session),this._getStationId(session),numericFlag);\n    const requiredRole = CORP_HANGAR_QUERY_ROLE_BY_FLAG.get(numericFlag);`],
  ['    if (\n      !sourceItem ||\n      this._normalizeInventoryId(sourceItem.categoryID, 0) !== CHARGE_CATEGORY_ID ||',
   `    if (${FLAG} && !${GUARD}.authorizeInventoryMove({session,sourceItemDescriptor,destination})) return {handled:true,success:false,errorMsg:"CORPORATE_ASSET_ACCESS_DENIED"};\n    if (\n      !sourceItem ||\n      this._normalizeInventoryId(sourceItem.categoryID, 0) !== CHARGE_CATEGORY_ID ||`],
  ['      this._validateMoonMaterialBaySourceAccess(session, item);',
   `      if (${FLAG} && !this._isTransferSourceLocationMatch(sourceItemDescriptor, sourceLocationID)) continue;\n      this._validateMoonMaterialBaySourceAccess(session, item);`],
 ],
};
function patch(source,file,remove=false){
 const filename=String(file).replace(/\\/g,'/').split('/').pop(),edits=changes[filename];
 if(!edits)throw Error('CH31_UNSUPPORTED_PINNED_SOURCE');
 const eol=String(source).includes('\r\n')?'\r\n':'\n';
 let text=String(source).replace(/\r\n/g,'\n');
 const all=edits.every(([oldValue,newValue])=>text.includes(newValue));
 const none=edits.every(([oldValue,newValue])=>text.includes(oldValue)&&!text.includes(newValue));
 if(!all&&!none)throw Error('CH31_SOURCE_PARTIAL_OR_UNKNOWN');
 if(!remove&&all||remove&&none)return source;
 for(const [oldValue,newValue] of edits){
  const before=remove?newValue:oldValue,after=remove?oldValue:newValue;
  if(text.split(before).length!==2)throw Error('CH31_PINNED_ANCHOR_DRIFT');
  text=text.replace(before,after);
 }
 return eol==='\n'?text:text.replace(/\n/g,eol);
}
module.exports={patch};
