"use strict";
// Chat 39. Reversible opt-in pinned EveJS social durability/authority hooks.
// No new RPC, no proprietary client patches, no synthetic message events.
const CHAT_RUNTIME="server/src/_secondary/chat/chatRuntime.js";
const CHAT_STORE="server/src/_secondary/chat/chatStore.js";
const MAIL="server/src/services/mail/mailState.js";
const FLAG='process.env.EVEJS_COOP_SOCIAL_NATIVE_GUARDS === "1"';
const BEGIN="// COOP_CHAT39_SOCIAL_NATIVE_BEGIN";
const END="// COOP_CHAT39_SOCIAL_NATIVE_END";
const BACKLOG_HELPER=`// COOP_CHAT39_SOCIAL_NATIVE_BEGIN
// The native DB is the sole backlog source. Never publish from an unflushed
// in-memory room cache; unknown flush outcome requires operator inspection.
let coopChat39BacklogCommitUncertain=false;
function coopChat39WriteBacklogEntries(roomName,entries=[]){
 if(coopChat39BacklogCommitUncertain)return false;
 const normalizedRoomName=normalizeString(roomName,"").trim();
 if(!normalizedRoomName)return false;
 const normalizedEntries=(Array.isArray(entries)?entries:[]).filter(Boolean).map(cloneValue);
 const snapshot=cloneValue(getBacklogState());
 if(normalizedEntries.length) snapshot.entriesByRoomName[normalizedRoomName]=normalizedEntries;
 else delete snapshot.entriesByRoomName[normalizedRoomName];
 let persisted=false;
 try{persisted=writeRuntimeTable(CHAT_BACKLOG_TABLE,snapshot,{flush:true})===true;}
 catch(_error){persisted=false;}
 if(!persisted){
  coopChat39BacklogCommitUncertain=true;
  return false;
 }
 backlogStateCache=snapshot;
 if(normalizedEntries.length)
  backlogCache.set(normalizedRoomName,normalizedEntries.map(cloneValue));
 else backlogCache.delete(normalizedRoomName);
 return true;
}
// COOP_CHAT39_SOCIAL_NATIVE_END
`;
const MAIL_BEGIN="// COOP_CHAT39_MAIL_NATIVE_BEGIN";
const MAIL_END="// COOP_CHAT39_MAIL_NATIVE_END";
const MAIL_HELPER=`// COOP_CHAT39_MAIL_NATIVE_BEGIN
// Unknown native mail flush cannot be reported as delivered. Further sends
// stay blocked until the original persistent mail table is reconciled.
let coopChat39MailCommitUncertain=false;
// COOP_CHAT39_MAIL_NATIVE_END
`;
const ROOM_GUARD=`  if (${FLAG} && ["corp","alliance","fleet"].includes(record?.type)) {
    const proof=require(path.join(__dirname,"../../space/coopSocialRoomAuthority")).verifyScopedRoom({
      session,record,
      getCharacter:require(path.join(__dirname,"../../services/character/characterState")).getCharacterRecord,
      getCorporation:require(path.join(__dirname,"../../services/corporation/corporationState")).getCorporationRecord,
      getAlliance:require(path.join(__dirname,"../../services/corporation/corporationState")).getAllianceRecord,
      getAllianceMembers:require(path.join(__dirname,"../../services/corporation/corporationState")).getAllianceCorporationIDs,
      getFleetForCharacter:require(path.join(__dirname,"../../services/fleets/fleetRuntime")).getFleetForCharacter
    });
    if(!proof.ok)return "native_membership_unverified";
  }
`;
const MAIL_EARLY=`  const coopChat39Strict=${FLAG};
  if(coopChat39Strict&&coopChat39MailCommitUncertain)
    return {success:false,errorMsg:"MAIL_NATIVE_COMMIT_UNCERTAIN"};
`;
const MAIL_FLUSH=`  if(coopChat39Strict){
    let flushed=false;
    try{const result=repo.flushTableSync(MAIL_TABLE);flushed=Boolean(result&&result.success===true);}
    catch(_error){flushed=false;}
    if(!flushed){
      coopChat39MailCommitUncertain=true;
      return {success:false,errorMsg:"MAIL_NATIVE_COMMIT_UNCERTAIN"};
    }
  }
`;
function swap(source,before,after,remove,name){
 const count=(s,needle)=>s.split(needle).length-1;
 if(remove){
  if(count(source,after)===1)return source.replace(after,before);
  if(count(source,after)===0&&count(source,before)===1)return source;
  throw Error("CHAT39_REMOVE_DRIFT_"+name);
 }
 if(count(source,after)===1)return source;
 if(count(source,before)!==1)throw Error("CHAT39_SOURCE_DRIFT_"+name);
 return source.replace(before,after);
}
function patch(source,file,remove=false){
 if(![CHAT_RUNTIME,CHAT_STORE,MAIL].includes(file))throw Error("CHAT39_INVALID_TARGET");
 if(typeof source!=="string"||!source.includes("\n"))throw Error("CHAT39_INVALID_SOURCE");
 const eol=source.includes("\r\n")?"\r\n":"\n",nl=t=>t.replace(/\n/g,eol);
 let out=source;
 if(file===CHAT_RUNTIME){
  const original='  const characterID = getCharacterID(session);'+eol+
   '  const corporationID = getCorporationID(session);';
  const next='  const characterID = getCharacterID(session);'+eol+nl(ROOM_GUARD)+
   '  const corporationID = getCorporationID(session);';
  // Specific two-line anchor inside getChannelAccessFailure, not generic session ID.
  out=swap(out,original,next,remove,"SCOPED_ROOM");
 }else if(file===CHAT_STORE){
  const original='function writeBacklogEntries(roomName, entries = []) {'+eol;
  const next=nl(BACKLOG_HELPER)+original+
   `  if (${FLAG}) return coopChat39WriteBacklogEntries(roomName,entries);`+eol;
  out=swap(out,original,next,remove,"BACKLOG_GATE");
  const old='  writeBacklogEntries(normalizedRoomName, trimmedEntries);'+eol;
  const nextWrite=`  const persisted=writeBacklogEntries(normalizedRoomName, trimmedEntries);
  if(${FLAG}&&persisted!==true){
    const error=new Error("CHAT_NATIVE_BACKLOG_COMMIT_UNCERTAIN");
    error.code="CHAT_NATIVE_BACKLOG_COMMIT_UNCERTAIN";
    throw error;
  }
`;
  out=swap(out,old,nl(nextWrite),remove,"BACKLOG_DELIVERY");
 }else{
  const original='function sendMail(options = {}) {'+eol;
  const next=nl(MAIL_HELPER)+original+nl(MAIL_EARLY);
  out=swap(out,original,next,remove,"MAIL_SEND_START");
  const old='  const state = getMutableState();'+eol+
    '  const resolvedRecipients = buildDeliveryRecipients(';
  const newValue='  const state = coopChat39Strict ? cloneValue(getMutableState()) : getMutableState();'+eol+
    '  const resolvedRecipients = buildDeliveryRecipients(';
  out=swap(out,old,newValue,remove,"MAIL_COPY_ON_WRITE");
  const oldAfter='  const writeResult = persistState(state);'+eol+
    '  if (!writeResult || !writeResult.success) {'+eol+
    '    return { success: false, errorMsg: "WRITE_ERROR" };'+eol+
    '  }'+eol;
  const nextAfter=oldAfter+nl(MAIL_FLUSH);
  out=swap(out,oldAfter,nextAfter,remove,"MAIL_PERSIST_BEFORE_NOTIFY");
 }
 return out;
}
module.exports={patch,CHAT_RUNTIME,CHAT_STORE,MAIL,BEGIN,END,FLAG};
