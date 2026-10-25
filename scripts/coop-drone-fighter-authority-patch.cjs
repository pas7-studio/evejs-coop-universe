"use strict";
// Isolated source transform. Chat 01 must wire it into its ONLY installer.
// Patches one existing native admission function per file; default OFF.
const HELPER = 'require(path.join(__dirname, "../../space/coopDroneFighterAuthority"))';
const HOOK = '  if (process.env.EVEJS_COOP_DRONE_FIGHTER_AUTHORITY === "1" && !' +
  HELPER + '.admitPilot({session,scene,shipRecord,registryLookup:findSessionByCharacterID}).ok) return null;';
const START = 'function getShipStateForSession(session) {';
const END = '  return {\n    characterID,\n    shipRecord,\n    shipEntity,\n    scene,\n  };';
function patch(source,{remove=false}={}){
 if(typeof source!=="string" || !source.includes(START))throw Error('UNSUPPORTED_DRONE_FIGHTER_SOURCE');
 const eol=source.includes('\r\n')?'\r\n':'\n';
 const normal=source.replace(/\r\n/g,'\n');
 if(normal.split(START).length!==2||normal.split(END).length!==2)throw Error('NON_UNIQUE_NATIVE_ADMISSION_ANCHOR');
 const start=normal.indexOf(START),end=normal.indexOf(END,start);
 if(end<start)throw Error('DRONE_FIGHTER_ADMISSION_ANCHOR_NOT_FOUND');
 const preceding=normal.slice(0,end),following=normal.slice(end);
 const present=preceding.endsWith(HOOK+'\n');
 if(remove){
   if(!present)return source;
   return (preceding.slice(0,-HOOK.length-1)+following).replace(/\n/g,eol);
 }
 if(present)return source;
 if(preceding.includes(HOOK))throw Error('DRONE_FIGHTER_PARTIAL_HOOK');
 return (preceding+HOOK+'\n'+following).replace(/\n/g,eol);
}
module.exports={patch,HOOK};
