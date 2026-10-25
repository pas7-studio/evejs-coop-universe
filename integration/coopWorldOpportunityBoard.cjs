"use strict";
/**
 * Native EveJS player-facing Opportunity Board.
 * Only physical NPC observations can publish; no grants, NPC spawns, or ISK.
 * Default OFF. EVEmail sender uses existing pinned mailState (stock UI).
 */
const fs=require("node:fs"),path=require("node:path");
const POS=x=>Number.isSafeInteger(x)&&x>0;
const KEY=x=>typeof x==="string"&&/^(raid|convoy)-[0-9]+-[0-9]+-[0-9]+$/.test(x);
const MODES=new Set(["off","local","all"]);
const TYPES=new Set(["RAID","CONVOY"]);
const MAX_AGE=24*60*60*1000;
const COPY=x=>JSON.parse(JSON.stringify(x));
function createBoard({root,io=fs,clock=()=>Date.now(),getSessions=()=>[],
 sendNativeMail=null,authorizeInterest=null}={}){
 if(typeof root!=="string"||!path.isAbsolute(root)||typeof clock!=="function"||
  typeof getSessions!=="function"||(sendNativeMail!==null&&typeof sendNativeMail!=="function")||
  (authorizeInterest!==null&&typeof authorizeInterest!=="function"))
  throw Error("OPPORTUNITY_NATIVE_AUTHORITIES_REQUIRED");
 const dir=path.join(root,"coop-opportunities"),eventDir=path.join(dir,"events"),
  watchDir=path.join(dir,"watch"),claimsDir=path.join(dir,"mail-claims"),
  interestDir=path.join(dir,"interest");
 function safeDir(p){io.mkdirSync(p,{recursive:true});}
 function sync(p){let fd;try{fd=io.openSync(p,"r");io.fsyncSync(fd);return true}
  catch{return false}finally{if(fd!==undefined)try{io.closeSync(fd)}catch{}}}
 function durableNew(p,value){
  let fd;try{
   safeDir(path.dirname(p));
   const bytes=Buffer.from(JSON.stringify(value)+"\n");
   if(bytes.length>4096)return false;
   fd=io.openSync(p,"wx",0o600);
   if(io.writeSync(fd,bytes,0,bytes.length,null)!==bytes.length)return false;
   io.fsyncSync(fd);
  }catch{return false}finally{if(fd!==undefined)try{io.closeSync(fd)}catch{}}
  return sync(path.dirname(p));
 }
 function durableReplace(p,value){
  const tmp=p+".tmp";
  let fd;try{
   safeDir(path.dirname(p));
   const bytes=Buffer.from(JSON.stringify(value)+"\n");
   if(bytes.length>4096)return false;
   fd=io.openSync(tmp,"wx",0o600);
   if(io.writeSync(fd,bytes,0,bytes.length,null)!==bytes.length)return false;
   io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
   io.renameSync(tmp,p);
  }catch{return false}finally{if(fd!==undefined)try{io.closeSync(fd)}catch{}}
  return sync(path.dirname(p));
 }
 function load(p){
  let text;try{text=io.readFileSync(p,"utf8")}catch(e){
   return e?.code==="ENOENT"?{status:"NOT_FOUND"}:{status:"STORAGE_UNAVAILABLE"};
  }
  if(typeof text!=="string"||Buffer.byteLength(text)>4096||!text.endsWith("\n"))
   return {status:"CORRUPT"};
  try{return {status:"READY",value:JSON.parse(text.trim())}}
  catch{return {status:"CORRUPT"}}
 }
 const eventFile=id=>path.join(eventDir,id+".json");
 const watchFile=id=>path.join(watchDir,id+".json");
 const claimFile=(id,char)=>path.join(claimsDir,String(char)+"-"+id+".lock");
 const interestFile=(id,char)=>path.join(interestDir,id+"-"+char+".json");
 const nowOK=()=>{const n=clock();return Number.isSafeInteger(n)&&n>0?n:null};
 function readEvent(id){
  if(!KEY(id))return {status:"BAD_EVENT_ID"};
  const d=load(eventFile(id));
  if(d.status!=="READY")return {status:d.status};
  const e=d.value;
  if(e?.v!==1||e.id!==id||!TYPES.has(e.type)||!POS(e.systemID)||
   !POS(e.entityID)||!POS(e.createdAt)||!POS(e.expiresAt)||
   e.expiresAt<=e.createdAt||e.expiresAt-e.createdAt>MAX_AGE||
   typeof e.title!=="string"||e.title.length>96||
   typeof e.summary!=="string"||e.summary.length>240||
   !["ACTIVE","RESOLVED"].includes(e.phase))
   return {status:"CORRUPT"};
  return {status:"READY",event:e};
 }
 function watch(characterID){
  if(!POS(characterID))return {status:"INVALID_CHARACTER"};
  const w=load(watchFile(characterID));
  if(w.status==="NOT_FOUND")return {status:"READY",mode:"local",at:0};
  if(w.status!=="READY"||w.value?.v!==1||w.value.characterID!==characterID||
    !MODES.has(w.value.mode)||!Number.isSafeInteger(w.value.at))
   return {status:"WATCH_CORRUPT"};
  return {status:"READY",mode:w.value.mode,at:w.value.at};
 }
 function setWatch(characterID,mode){
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD!=="1")return {status:"DISABLED"};
  if(!POS(characterID)||!MODES.has(mode))return {status:"WATCH_INVALID"};
  const prev=watch(characterID),n=nowOK();
  if(prev.status!=="READY"||!n)return {status:"WATCH_STORAGE_UNAVAILABLE"};
  if(!durableReplace(watchFile(characterID),{v:1,characterID,mode,at:n}))
   return {status:"WATCH_WRITE_UNCERTAIN"};
  return {status:"WATCH_UPDATED",mode};
 }
 function list({systemID=null,limit=12,all=false}={}){
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD!=="1")return {status:"DISABLED",events:[]};
  let names;try{names=io.readdirSync(eventDir)}catch(e){
   return {status:e?.code==="ENOENT"?"READY":"STORAGE_UNAVAILABLE",events:[]};
  }
  if(names.length>2000)return {status:"EVENT_DIRECTORY_TOO_LARGE",events:[]};
  const results=[],n=nowOK();
  if(!n)return {status:"CLOCK_INVALID",events:[]};
  for(const filename of names){
   if(!filename.endsWith(".json"))continue;
   const r=readEvent(filename.slice(0,-5));
   if(r.status!=="READY")return {status:"EVENT_STORAGE_UNTRUSTED",events:[]};
   const e=r.event;
   if(e.expiresAt<=n||e.phase!=="ACTIVE")continue;
   if(!all&&POS(systemID)&&e.systemID!==systemID)continue;
   results.push(e);
  }
  results.sort((a,b)=>b.createdAt-a.createdAt);
  return {status:"READY",events:results.slice(0,Math.min(20,Math.max(1,limit)))};
 }
 function watchAllows(id,systemID,sessionSystemID){
  const w=watch(id);
  return w.status==="READY"&&(w.mode==="all"||
   w.mode==="local"&&POS(sessionSystemID)&&sessionSystemID===systemID);
 }
 function alert(e){
  if(process.env.EVEJS_COOP_OPPORTUNITY_MAIL!=="1"||!sendNativeMail)
   return {status:"MAIL_DISABLED",sent:0};
  let sessions;try{sessions=getSessions()}catch{return {status:"SESSIONS_UNAVAILABLE",sent:0}}
  if(!Array.isArray(sessions))return {status:"SESSIONS_UNAVAILABLE",sent:0};
  let sent=0,blocked=0;
  const seen=new Set();
  for(const session of sessions){
   const characterID=Number(session?.characterID);
   const systemID=Number(session?._space?.systemID||session?.solarsystemid||session?.solarSystemID);
   if(!POS(characterID)||seen.has(characterID)||session?.socket?.destroyed===true||
    !watchAllows(characterID,e.systemID,systemID))continue;
   seen.add(characterID);
   const claim=claimFile(e.id,characterID);
   // Durable pre-send claim avoids duplicate EVEmail on crash/lost ACK. Unknown
   // mail outcome remains blocked for reconciliation; no blind retry.
   if(!durableNew(claim,{v:1,characterID,eventID:e.id,at:clock(),state:"PREPARED"})){
    blocked++;continue;
   }
   let receipt;try{receipt=sendNativeMail(characterID,{
    title:"New Eden: "+e.title,
    body:e.summary+" | System "+e.systemID+" | /events info "+e.id+
     " | /events interest "+e.id+" | /events watch off",
    eventID:e.id})}catch{blocked++;continue}
   if(receipt?.success!==true||!POS(Number(receipt.messageID))){blocked++;continue}
   sent++;
  }
  return {status:blocked?"MAIL_PARTIAL_OR_UNCERTAIN":"MAIL_DISPATCHED",sent,blocked};
 }
 function publish(event){
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD!=="1")return {status:"DISABLED"};
  const n=nowOK();
  if(!n||!event||!KEY(event.id)||!TYPES.has(event.type)||
   !POS(event.systemID)||!POS(event.entityID)||
   !POS(event.expiresAt)||event.expiresAt<=n||event.expiresAt-n>MAX_AGE||
   typeof event.title!=="string"||event.title.length>96||
   typeof event.summary!=="string"||event.summary.length>240)
   return {status:"INVALID_NATIVE_EVENT"};
  const entry={v:1,id:event.id,type:event.type,systemID:event.systemID,
   entityID:event.entityID,stationID:POS(event.stationID)?event.stationID:null,
   title:event.title,summary:event.summary,createdAt:n,
   expiresAt:event.expiresAt,phase:"ACTIVE",source:"NATIVE_VERIFIED"};
  if(!durableNew(eventFile(entry.id),entry))
   return {status:"EVENT_ALREADY_EXISTS_OR_WRITE_UNCERTAIN"};
  // Notification failures cannot retroactively change the authoritative event.
  const notices=alert(entry);
  return {status:"EVENT_PUBLISHED",id:entry.id,notices};
 }
 function nativeRaid({scene,action}={}){
  if(action?.action!=="attack"||!POS(scene?.systemID)||
   !POS(action.pirateID)||!POS(action.targetID)||action.pirateID===action.targetID||
   !["miner","hauler"].includes(action.targetRole))return {status:"NO_NATIVE_RAID"};
  const pirate=scene.getEntityByID?.(action.pirateID),
   target=scene.getEntityByID?.(action.targetID);
  if(pirate?.nativeNpc!==true||target?.nativeNpc!==true||
   pirate?.kind!=="ship"||target?.kind!=="ship"||
   pirate.itemID!==action.pirateID||target.itemID!==action.targetID||
   pirate.transient===true||target.transient===true)
   return {status:"NO_VERIFIED_NATIVE_SHIPS"};
  const n=nowOK();if(!n)return {status:"CLOCK_INVALID"};
  return publish({id:"raid-"+scene.systemID+"-"+action.pirateID+"-"+action.targetID,
   type:"RAID",systemID:scene.systemID,entityID:action.targetID,
   title:"Pirates attacking NPC "+action.targetRole,
   summary:"Native pirate ship "+action.pirateID+" is attacking NPC "+
    action.targetRole+" "+action.targetID+". You can intervene in the real system.",
   expiresAt:n+30*60*1000});
 }
 function nativeConvoy({scene,fleet,route}={}){
  if(route?.status!=="EN_ROUTE"||!POS(scene?.systemID)||
   fleet?.systemID!==scene.systemID||!POS(fleet.fleetID)||
   !Array.isArray(fleet.haulerEntityIDs)||fleet.haulerEntityIDs.length!==1)
   return {status:"NO_NATIVE_CONVOY"};
  const id=fleet.haulerEntityIDs[0],ship=scene.getEntityByID?.(id),
   trip=fleet.coopStationArrival;
  if(!POS(id)||ship?.nativeNpc!==true||ship.kind!=="ship"||ship.itemID!==id||
   ship.transient===true||trip?.fleetID!==fleet.fleetID||
   trip.systemID!==scene.systemID||!POS(trip.startedAt)||!POS(trip.stationID))
   return {status:"NO_VERIFIED_NATIVE_CONVOY"};
  const n=nowOK();if(!n)return {status:"CLOCK_INVALID"};
  return publish({id:"convoy-"+scene.systemID+"-"+fleet.fleetID+"-"+trip.startedAt,
   type:"CONVOY",systemID:scene.systemID,entityID:id,stationID:trip.stationID,
   title:"NPC convoy departing",
   summary:"Native hauler "+id+" is moving to station "+trip.stationID+
    ". Fly to its system to escort or scout. Reward is NOT guaranteed.",
   expiresAt:n+30*60*1000});
 }
 function nativeConvoyOutcome({scene,trip,terminal}={}){
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD!=="1")return {status:"DISABLED"};
  if(!POS(scene?.systemID)||!POS(trip?.fleetID)||!POS(trip?.startedAt)||
   trip.systemID!==scene.systemID||terminal?.status!=="DELIVERED"||
   terminal.terminal!==true||!POS(trip.stationID))
   return {status:"NATIVE_DELIVERY_NOT_VERIFIED"};
  const key="convoy-"+scene.systemID+"-"+trip.fleetID+"-"+trip.startedAt;
  const r=readEvent(key);
  if(r.status==="NOT_FOUND")return {status:"NO_POSTED_CONVOY_EVENT"};
  if(r.status!=="READY"||r.event.type!=="CONVOY"||
   r.event.stationID!==trip.stationID)return {status:"EVENT_PROVENANCE_MISMATCH"};
  if(r.event.phase==="RESOLVED")return {status:"ALREADY_RESOLVED"};
  const n=nowOK();
  if(!n||n<r.event.createdAt)return {status:"CLOCK_INVALID"};
  const closed={...r.event,phase:"RESOLVED",outcome:"DELIVERED",endedAt:n};
  if(!durableReplace(eventFile(key),closed))return {status:"EVENT_OUTCOME_WRITE_UNCERTAIN"};
  return {status:"NATIVE_CONVOY_EVENT_RESOLVED",id:key};
 }
 function interest(characterID,eventID){
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD!=="1")return {status:"DISABLED"};
  if(!POS(characterID))return {status:"INVALID_CHARACTER"};
  const r=readEvent(eventID),n=nowOK();
  if(r.status!=="READY")return {status:"EVENT_NOT_AVAILABLE"};
  if(!n||r.event.phase!=="ACTIVE"||r.event.expiresAt<=n)
   return {status:"EVENT_EXPIRED"};
  if(authorizeInterest){
   let a;try{a=authorizeInterest(characterID,COPY(r.event))}catch{
    return {status:"INTEREST_AUTHORITY_UNAVAILABLE"}}
   if(a?.status!=="AUTHORIZED_NATIVE_CHARACTER"||a.characterID!==characterID)
    return {status:"INTEREST_NOT_AUTHORIZED"};
  }
  if(!durableNew(interestFile(eventID,characterID),
    {v:1,characterID,eventID,at:n,phase:"INTERESTED"}))
   return {status:"ALREADY_INTERESTED_OR_WRITE_UNCERTAIN"};
  // NOT a fleet join and never a reward promise.
  return {status:"INTEREST_RECORDED",eventID,systemID:r.event.systemID,
   note:"Interest only. Travel and join an actual EVE fleet manually."};
 }
 function readInterest(characterID,eventID){
  if(!POS(characterID)||!KEY(eventID))return {status:"INVALID_INTEREST_IDENTITY"};
  const d=load(interestFile(eventID,characterID));
  if(d.status!=="READY")return {status:d.status};
  const i=d.value;
  if(i?.v!==1||i.characterID!==characterID||i.eventID!==eventID||
   i.phase!=="INTERESTED"||!POS(i.at))
   return {status:"INTEREST_CORRUPT"};
  return {status:"INTEREST_RECORDED",eventID,characterID};
 }
 function handleChat({session,command,argumentText=""}={}){
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD!=="1")
   return {status:"DISABLED",message:"[Co-op Events] Board is disabled on this server."};
  const id=Number(session?.characterID);
  if(!POS(id))return {status:"NO_CHARACTER",message:"Select your EVE character."};
  const tokens=String(argumentText).trim().split(/\s+/).filter(Boolean);
  const op=command==="alerts"?"watch":(tokens.shift()||"list").toLowerCase();
  if(op==="watch"){
   const mode=(command==="alerts"?argumentText:tokens[0]||"").trim().toLowerCase();
   if(!mode){const w=watch(id);return {status:w.status,message:"Event alerts: "+(w.mode||"unavailable")+
    ". Use /events watch local|all|off."}}
   const r=setWatch(id,mode);return {status:r.status,message:"[Co-op Events] Alerts: "+
    (r.status==="WATCH_UPDATED"?r.mode:r.status)};
  }
  if(op==="list"||op==="all"){
   const local=Number(session?._space?.systemID||session?.solarsystemid||session?.solarSystemID);
   const r=list({systemID:local,all:op==="all",limit:8});
   if(r.status!=="READY")return {status:r.status,message:"[Co-op Events] "+r.status};
   if(!r.events.length)return {status:"READY",message:"[Co-op Events] No verified active events. /events all for whole universe; /events watch local|all|off."};
   return {status:"READY",message:"[Co-op Events] Verified active events:\n"+
    r.events.map(e=>e.id+" | "+e.title+" | system "+e.systemID+
     " | /events info "+e.id).join("\n")};
  }
  if(op==="info"){
   const r=readEvent(tokens[0]);const n=nowOK();
   if(r.status!=="READY"||!n||r.event.expiresAt<=n)return {status:"EVENT_NOT_AVAILABLE",message:"Event unavailable or expired."};
   const e=r.event;
   return {status:"READY",message:"[Co-op Events] "+e.title+" | "+e.id+
    "\n"+e.summary+"\nSystem: "+e.systemID+
    (e.stationID?" | station: "+e.stationID:"")+
    "\nTo participate voluntarily: /events interest "+e.id+
    " then fly to the actual location and use native EVE fleet/warp."};
  }
  if(op==="history"||op==="reputation"){
   return require("./coopEscortReputation").listNativeHistory(session);
  }
  if(op==="volunteer"){
   if(process.env.EVEJS_COOP_EVENT_VOLUNTEERS!=="1")
    return {status:"DISABLED",message:"[Co-op Events] Verified two-pilot volunteer mode is disabled."};
   const r=require("./coopEscortVolunteers").nativeVoluntaryOptIn(session,tokens[0],{
    readEvent,readInterest
   });
   const message=r.status==="VERIFIED_NATIVE_DUO_VOLUNTEER"?
    "[Co-op Events] Both real EVE fleet pilots volunteered for "+r.eventID+
    ". This is not a funded contract, warp command or reward.":
    r.status==="WAITING_FOR_OTHER_VOLUNTEER"?
    "[Co-op Events] Voluntary interest confirmed. The second pilot must run /events interest and /events volunteer for the same event.":
    "[Co-op Events] "+r.status;
   return {status:r.status,message};
  }
  if(op==="interest"){
   const r=interest(id,tokens[0]);return {status:r.status,
    message:r.status==="INTEREST_RECORDED"?
     "[Co-op Events] Interest saved. Navigate to system "+r.systemID+
     ", find the actual NPC via overview, join a real fleet manually. No automatic warp or ISK award.":
     "[Co-op Events] "+r.status};
  }
  return {status:"HELP",message:"/events list | /events all | /events info <id> | /events interest <id> | /events volunteer <id> | /events history | /events watch local|all|off"};
 }
 return {publish,nativeRaid,nativeConvoy,nativeConvoyOutcome,readEvent,readInterest,list,watch,setWatch,interest,alert,handleChat};
}
let singleton;
function instance(){
 if(!singleton){
  const root=process.env.EVEJS_DATA_ROOT||"/var/lib/evejs";
  singleton=createBoard({root,getSessions:()=>require("../services/chat/sessionRegistry").getSessions(),
   sendNativeMail:(characterID,mail)=>{
    const state=require("../services/mail/mailState");
    return state.sendMail({senderID:state.resolveWelcomeSenderID(),
     toCharacterIDs:[characterID],saveSenderCopy:false,
     title:mail.title,body:mail.body});
   }});
 }
 return singleton;
}
function handleChat(x){return instance().handleChat(x)}
function noteNativeRaid(scene,action){try{return instance().nativeRaid({scene,action})}
 catch{return {status:"OPPORTUNITY_RAID_UNAVAILABLE"}}}
function noteNativeConvoy(scene,fleet,route){try{return instance().nativeConvoy({scene,fleet,route})}
 catch{return {status:"OPPORTUNITY_CONVOY_UNAVAILABLE"}}}
function noteNativeConvoyOutcome(scene,trip,terminal){
 try{return instance().nativeConvoyOutcome({scene,trip,terminal})}
 catch{return {status:"OPPORTUNITY_OUTCOME_UNAVAILABLE"}}
}
module.exports={createBoard,handleChat,noteNativeRaid,noteNativeConvoy,noteNativeConvoyOutcome};
