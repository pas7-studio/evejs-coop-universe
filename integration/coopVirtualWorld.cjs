"use strict";
// Offline virtual pilots: deterministic, bounded world-state only.
// Physical ships are exclusively owned by native EveJS when a scene is observed.
const fs=require("node:fs"),path=require("node:path");
function integer(v){const x=Number(v);return Number.isSafeInteger(x)&&x>0?x:null;}
function createWorld({file,route,population=16,clock=()=>Date.now(),travelMs=120000}){
 if(!file||!Array.isArray(route)||route.length<2||route.some(x=>!integer(x)))throw Error("valid route and file required");
 if(!Number.isInteger(population)||population<1||population>100)throw Error("population cap 1..100");
 if(!Number.isInteger(travelMs)||travelMs<10000)throw Error("travelMs must be >= 10000");
 const persist=s=>{fs.mkdirSync(path.dirname(file),{recursive:true});const t=file+".tmp-"+process.pid;fs.writeFileSync(t,JSON.stringify(s));fs.renameSync(t,file);};
 let state;
 try{state=JSON.parse(fs.readFileSync(file,"utf8"));}catch(e){if(e.code!=="ENOENT")throw e;}
 if(!state){
   const now=clock();
   state={version:1,lastAdvancedAt:now,pilots:Array.from({length:population},(_,i)=>({
     id:"coop-pilot-"+String(i+1).padStart(3,"0"),
     name:"Wanderer "+String(i+1).padStart(3,"0"),
     faction:i%2?"frontier":"independent",
     routeIndex:i%route.length,
     systemID:route[i%route.length],
     nextMoveAt:now+travelMs*(1+(i%4)),
     journeys:0
   }))};
   persist(state);
 }
 if(state.version!==1||!Array.isArray(state.pilots)||state.pilots.length>100)throw Error("invalid saved world");
 function advance(){
   const now=clock();
   if(now<state.lastAdvancedAt)return {status:"CLOCK_REWIND",moves:0};
   let moves=0;
   for(const pilot of state.pilots){
     // Mathematical catch-up, not per-tick replay; bounded by elapsed time.
     if(now>=pilot.nextMoveAt){
       const steps=Math.floor((now-pilot.nextMoveAt)/travelMs)+1;
       pilot.routeIndex=(pilot.routeIndex+steps)%route.length;
       pilot.systemID=route[pilot.routeIndex];
       pilot.nextMoveAt+=steps*travelMs;
       pilot.journeys+=steps;
       moves+=steps;
     }
   }
   state.lastAdvancedAt=now;
   if(moves)persist(state);
   return {status:"OK",moves};
 }
 function residents(systemID){return state.pilots.filter(p=>p.systemID===integer(systemID)).map(p=>({...p}));}
 return {advance,residents,snapshot:()=>structuredClone(state)};
}
module.exports={createWorld};
