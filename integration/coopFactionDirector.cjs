"use strict";
// Virtual faction strategy: replacement demand and patrol priorities.
// Never creates real ships or modifies EveJS wallets/standing.
const fs=require("node:fs"),path=require("node:path");
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
const bounded=x=>Math.max(0,Math.min(10000,Math.floor(Number(x)||0)));
function createFactionDirector({file,clock=()=>Date.now(),buildMinutes=30}){
 if(!file||!Number.isInteger(buildMinutes)||buildMinutes<1)throw Error("invalid faction director settings");
 let state;
 try{state=JSON.parse(fs.readFileSync(file,"utf8"));if(state.version!==1||!state.factions)throw Error("invalid faction state");}
 catch(e){if(e.code!=="ENOENT")throw e;}
 state??={version:1,factions:{},processed:{},lastTickAt:clock()};
 const persist=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});const t=file+".tmp-"+process.pid;fs.writeFileSync(t,JSON.stringify(state));fs.renameSync(t,file);};
 const key=(faction,systemID)=>String(faction||"independent").slice(0,48)+"@"+systemID;
 const get=(faction,systemID)=>state.factions[key(faction,systemID)]??={faction:String(faction||"independent"),systemID:Number(systemID),losses:0,replacementDemand:0,readiness:0,threat:0,patrolPriority:0,shipsRebuilt:0};
 function onLoss({eventID,faction,systemID}){
  if(!eventID||!positive(systemID))return {status:"INVALID"};
  if(state.processed[String(eventID)])return {status:"DUPLICATE"};
  const entry=get(faction,systemID);
  entry.losses=bounded(entry.losses+1);
  entry.replacementDemand=bounded(entry.replacementDemand+1);
  entry.threat=bounded(entry.threat+15);
  entry.patrolPriority=Math.min(100,entry.patrolPriority+20);
  state.factions[key(faction,systemID)]=entry;
  state.processed[String(eventID)]=true;
  persist();
  return {status:"RECORDED",faction:entry.faction,systemID:entry.systemID};
 }
 function advance(virtualEconomySystems={}){
  const now=clock(),duration=buildMinutes*60000;
  if(now<state.lastTickAt)return {status:"CLOCK_REWIND",completed:0};
  const steps=Math.min(1440,Math.floor((now-state.lastTickAt)/duration));
  let completed=0;
  for(const entry of Object.values(state.factions)){
   const available=bounded(virtualEconomySystems[String(entry.systemID)]?.goods);
   const affordable=Math.floor(available/10);
   const built=Math.min(steps,entry.replacementDemand,affordable);
   if(built){
    entry.replacementDemand-=built;entry.shipsRebuilt=bounded(entry.shipsRebuilt+built);
    entry.readiness=bounded(entry.readiness+built);
    // Commit production into the virtual faction plan only; no physical ship.
    completed+=built;
   }
   entry.patrolPriority=Math.max(0,entry.patrolPriority-Math.floor(steps/3));
   entry.threat=Math.max(0,entry.threat-Math.floor(steps/6));
  }
  if(steps){state.lastTickAt+=steps*duration;persist();}
  return {status:"OK",completed,steps};
 }
 return {onLoss,advance,snapshot:()=>structuredClone(state)};
}
module.exports={createFactionDirector};
