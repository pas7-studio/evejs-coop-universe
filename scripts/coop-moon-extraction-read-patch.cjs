"use strict";
// Pinned EveJS source translator; Chat 01 owns the ONLY real installer.
const FILE = "server/src/services/structure/moonExtractionsService.js";
const specs = Object.freeze([
  Object.freeze({method:"Handle_GetExtractionAndEventIDFromStructureID(args = [], session) {",
    anchor:"    const extraction = structureID",
    statement:'    if (process.env.EVEJS_COOP_NATIVE_MOON_READ_ACL === "1") require("../../space/coopMoonExtractionReadAccess").assertStructureRead(session, structureID, structureState, throwWrappedUserError);'}),
  Object.freeze({method:"Handle_GetExtractionsForCorp(args = [], session) {",
    anchor:"    const rows = Object.values(this._getState().extractions)",
    statement:'    if (process.env.EVEJS_COOP_NATIVE_MOON_READ_ACL === "1") require("../../space/coopMoonExtractionReadAccess").assertCorpRead(session, corpID, throwWrappedUserError);'}),
  Object.freeze({method:"Handle_GetMoonResourcesForStructure(args = [], session) {",
    anchor:"    const profile = structureID",
    statement:'    if (process.env.EVEJS_COOP_NATIVE_MOON_READ_ACL === "1") require("../../space/coopMoonExtractionReadAccess").assertStructureRead(session, structureID, structureState, throwWrappedUserError);'}),
  Object.freeze({method:"Handle_StartNewExtraction(args = [], session) {",
    anchor:"    const existing = getActiveExtractionForStructure(state, structureID);",
    statement:'    if (process.env.EVEJS_COOP_NATIVE_MOON_READ_ACL === "1") require("../../space/coopMoonExtractionReadAccess").assertMoonProfileBound(structureID, profile, access.structure, throwWrappedUserError);'}),
]);
const count = (text, needle) => text.split(needle).length-1;
function patch(source, path, {remove=false} = {}) {
  if (path !== FILE || typeof source !== "string") throw Error("MOON_PINNED_SOURCE_UNSUPPORTED");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  let text = source;
  const borders = [
    "Handle_GetExtractionAndEventIDFromStructureID(args = [], session) {",
    "Handle_GetExtractionsForCorp(args = [], session) {",
    "Handle_GetMoonResourcesForStructure(args = [], session) {",
    "Handle_StartNewExtraction(args = [], session) {",
    "Handle_FractureChunkWithStructure(args = [], session) {"
  ];
  if (borders.some(b=>count(text,b)!==1)) throw Error("MOON_PINNED_METHOD_CONTEXT_MISMATCH");
  for (let i=0;i<specs.length;i++) {
    const spec=specs[i];
    const start=text.indexOf(borders[i]),end=text.indexOf(borders[i+1],start+1);
    const fragment=text.slice(start,end);
    const original=spec.anchor;
    const newLine=spec.statement+newline;
    if (end<start || count(fragment,original)!==1 || count(fragment,spec.statement)>1 ||
        (fragment.includes('EVEJS_COOP_NATIVE_MOON_READ_ACL') && !fragment.includes(newLine)))
      throw Error("MOON_PINNED_ANCHOR_MISMATCH");
    const replacement=remove?fragment.replace(newLine,""):
      fragment.includes(newLine)?fragment:fragment.replace(original,newLine+original);
    text=text.slice(0,start)+replacement+text.slice(end);
  }
  return text;
}
module.exports={FILE,specs,patch};
