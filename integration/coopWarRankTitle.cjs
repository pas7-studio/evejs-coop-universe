"use strict";
// FW-012A: the faction rank title a pilot really earned.
//
// Title only. A rank is a durable merit fact, so it may change the name a pilot
// is addressed by - and nothing else. This module deliberately grants no skill,
// no hull, no LP, no market access and no command authority: those are separate
// systems and pretending otherwise would be an unimplemented unlock.
const {TABLE}=require("./coopFactionWarStore"+
 (__filename.endsWith(".js")?"":".cjs"));
const core=require("./coopFactionWarMerit"+
 (__filename.endsWith(".js")?"":".cjs"));
const KEY="coop-faction-war\u001ftitles-v1",MAX_RECORDS=512;
const pilot=x=>typeof x==="string"&&/^(coop-pilot|coop-player)-[0-9]{3,}$/.test(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const RANKS=new Set(core.RANKS.map(r=>r.rank));
// The visible decal text for each real rank. No rank invents a new capability.
const TITLES=Object.freeze({
 "recruit":"Recruit",
 "pilot":"Fleet Pilot",
 "wingman":"Wingman",
 "squad-lead":"Squad Leader",
 "wing-lead":"Wing Leader",
 "front-commander":"Front Commander",
 "admiral":"Fleet Admiral",
});
const empty=()=>({version:1,records:{}});
function validate(state){
 if(!state||state.version!==1||!state.records||
  typeof state.records!=="object"||Array.isArray(state.records)||
  Object.keys(state.records).length>MAX_RECORDS)
  throw Error("WAR_TITLE_LEDGER_INVALID");
 for(const [id,row] of Object.entries(state.records)){
  if(!pilot(id)||row?.pilotID!==id||!RANKS.has(String(row.rank))||
   String(row.title)!==TITLES[String(row.rank)]||!pos(row.at))
   throw Error("WAR_TITLE_RECORD_CORRUPT");
 }
 return state;
}
function titleForRank(rank){
 const name=String(rank||"");
 return Object.prototype.hasOwnProperty.call(TITLES,name)?TITLES[name]:null;
}
// Pure: what the ledger should say after this merit record. Null when nothing
// about the decal changed, so a caller never rewrites the same title.
function nextTitle({existing=null,pilotID,record,at}={}){
 if(!pilot(pilotID)||!pos(at))return {status:"REFUSED",reason:"INVALID_TITLE_IDENTITY"};
 const rank=String(record?.rank||"");
 const title=titleForRank(rank);
 if(!title)return {status:"REFUSED",reason:"UNKNOWN_RANK"};
 if(existing&&existing.rank===rank&&existing.title===title)
  return {status:"UNCHANGED",rank,title};
 return {status:"CHANGED",pilotID,rank,title,at,
  previousRank:String(existing?.rank||""),previousTitle:String(existing?.title||""),
  merit:Number(record?.merit)||0,unlocks:[]};
}
function createRankTitles({gameStore,clock=()=>Date.now(),env=process.env}={}){
 if(typeof gameStore?.coopAtomicNativeRows?.transact!=="function")
  throw Error("WAR_TITLE_AUTHORITIES_REQUIRED");
 const enabled=()=>env.EVEJS_COOP_FACTION_WAR==="1"&&
  env.EVEJS_COOP_FACTION_WAR_MERIT==="1"&&env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1";
 function read(){
  return gameStore.coopAtomicNativeRows.transact([TABLE],tx=>
   structuredClone(validate(tx.get(TABLE,KEY)||empty())));
 }
 // Idempotent: the same rank can be applied many times and only the first write
 // reports CHANGED.
 function apply({pilotID,record,at}={}){
  if(!enabled())return {status:"DISABLED"};
  const when=pos(Number(at))?Number(at):clock();
  return gameStore.coopAtomicNativeRows.transact([TABLE],tx=>{
   const state=validate(tx.get(TABLE,KEY)||empty());
   const existing=own(state.records,String(pilotID))?state.records[pilotID]:null;
   const next=nextTitle({existing,pilotID,record,at:when});
   if(next.status!=="CHANGED")return next;
   state.records[pilotID]={pilotID,rank:next.rank,title:next.title,at:when,
    previousRank:next.previousRank,previousTitle:next.previousTitle,
    merit:next.merit,unlocks:[]};
   validate(state);
   tx.put(TABLE,KEY,state);
   return next;
  });
 }
 return Object.freeze({read,apply});
}
module.exports={TABLE,KEY,TITLES,empty,validate,titleForRank,nextTitle,createRankTitles};
