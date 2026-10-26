"use strict";
// Reversible transform for pinned EveJS c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f.
// The opt-in flag preserves vanilla client payloads until gameplay acceptance.
const flag='process.env.EVEJS_COOP_NPE_NATIVE_SAFETY === "1"';
function one(src,from,to){
  if(src.split(from).length!==2)throw Error('COOP38_SOURCE_ANCHOR_MISMATCH: '+from.slice(0,72));
  return src.replace(from,to);
}
function patch(input,file,remove=false){
  const eol=String(input).includes('\r\n')?'\r\n':'\n';
  let s=String(input).replace(/\r\n/g,'\n');
  const service=String(file).replace(/\\/g,'/');
  const markerCount=s.split('process.env.EVEJS_COOP_NPE_NATIVE_SAFETY === "1"').length-1;
  const needed=service.endsWith('/character/achievementTrackerMgrService.js')?3:1;
  if(markerCount!==0 && markerCount!==needed)throw Error('COOP38_TORN_SOURCE_PATCH');
  if(remove && markerCount===0)return input;
  if(!remove && markerCount===needed)return input;
  const forward=(!remove);
  const replace=(from,to)=>{s=forward?one(s,from,to):one(s,to,from);};
  if(service.endsWith('/npe/airNpeService.js')||service.endsWith('/npe/nesIntroService.js')){
    const from=`function resolveCharacterID(args, session) {
  const directArg = Array.isArray(args) ? Number(args[0]) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }
  return Number(session && (session.charid || session.characterID || 0)) || 0;
}`;
    const to=`function resolveCharacterID(args, session) {
  if (${flag})
    return require("../../space/coopNpeSafety").resolveCharacterID(args, session);
  const directArg = Array.isArray(args) ? Number(args[0]) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }
  return Number(session && (session.charid || session.characterID || 0)) || 0;
}`;
    replace(from,to);
  }else if(service.endsWith('/account/tutorialSvcService.js')){
    replace(`  Handle_GetCharacterTutorialState() {
    log.debug("[TutorialSvc] GetCharacterTutorialState");
    return 0;
  }`,`  Handle_GetCharacterTutorialState(args, session) {
    log.debug("[TutorialSvc] GetCharacterTutorialState");
    if (${flag})
      return require("../../space/coopNpeSafety").currentTutorialState(args, session);
    return 0;
  }`);
  }else if(service.endsWith('/character/achievementTrackerMgrService.js')){
    replace('    return persistedValue ?? true;',`    return persistedValue ?? (${flag} ? false : true);`);
    replace('      GOLDEN_LOGIN_EVENT_COUNT_ENTRIES,',`      ${flag} ? [] : GOLDEN_LOGIN_EVENT_COUNT_ENTRIES,`);
    replace('      GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES,',`      ${flag} ? [] : GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES,`);
  }else throw Error('COOP38_UNSUPPORTED_SOURCE: '+file);
  return eol==='\n'?s:s.replace(/\n/g,eol);
}
module.exports={patch};
