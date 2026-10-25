"use strict";
// Fail-closed default-OFF fence until a single native atomic fuel+output
// settlement path is supplied by the structure/industry owners (Chats 32/27).
const FILE="server/src/services/structure/structureAutoMoonFuelRuntime.js";
const specs=Object.freeze([
 {open:"function prepareAutoMoonMinerServiceStateTransition(",
  close:"function clearOfflineAutoMoonFuelState(",
  anchor:"  const fuelResult = consumeMetenoxFuel(",
  statement:'  if (process.env.EVEJS_COOP_NATIVE_MOON_OUTPUT_FENCE === "1") return require("../../space/coopMoonFuelOutputFence").denyOnline();'},
 {open:"function applyAutoMoonMinerFuelCycle(structure, nowMs = Date.now()) {",
  close:"module.exports = {",
  anchor:"  const fuelResult = consumeMetenoxFuel(",
  statement:'  if (process.env.EVEJS_COOP_NATIVE_MOON_OUTPUT_FENCE === "1") return require("../../space/coopMoonFuelOutputFence").denyFuelCycle(structure, profile, nowMs, offlineAutoMoonService);'}
]);
const count=(s,n)=>s.split(n).length-1;
function patch(source,path,{remove=false}={}){
 if(path!==FILE||typeof source!=="string")throw Error("MOON_FUEL_SOURCE_UNSUPPORTED");
 let text=source;const eol=text.includes("\r\n")?"\r\n":"\n";
 for(const spec of specs){
  if(count(text,spec.open)!==1||count(text,spec.close)!==1)
    throw Error("MOON_FUEL_FUNCTION_CONTEXT_MISMATCH");
  const start=text.indexOf(spec.open),end=text.indexOf(spec.close,start+spec.open.length);
  if(end<start)throw Error("MOON_FUEL_FUNCTION_ORDER_MISMATCH");
  const body=text.slice(start,end),insertion=spec.statement+eol;
  if(count(body,spec.anchor)!==1||count(body,spec.statement)>1||
     (body.includes("EVEJS_COOP_NATIVE_MOON_OUTPUT_FENCE")&&!body.includes(insertion)))
    throw Error("MOON_FUEL_ANCHOR_MISMATCH");
  const updated=remove?body.replace(insertion,""):
    body.includes(insertion)?body:body.replace(spec.anchor,insertion+spec.anchor);
  text=text.slice(0,start)+updated+text.slice(end);
 }
 return text;
}
module.exports={FILE,specs,patch};
