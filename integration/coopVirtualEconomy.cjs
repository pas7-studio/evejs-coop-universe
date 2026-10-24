"use strict";
// Bounded offline simulation. Virtual resources are NOT EveJS market inventory.
const fs=require("node:fs"),path=require("node:path");
const ROLES=["miner","hauler","patrol","trader"];
const cap=n=>Math.max(0,Math.min(1000000,Math.floor(Number(n)||0)));
function createEconomy({file,clock=()=>Date.now(),stepMs=60000,maxCatchup=1440}){
 if(!file||!Number.isInteger(stepMs)||stepMs<10000||!Number.isInteger(maxCatchup)||maxCatchup<1||maxCatchup>10000)throw Error("invalid economy settings");
 let state;
 try{state=JSON.parse(fs.readFileSync(file,"utf8"));if(state.version!==1)throw Error("incompatible economy state");}catch(e){if(e.code!=="ENOENT")throw e;}
 if(!state)state={version:1,lastAt:clock(),systems:{},pilots:{},events:[]};
 const persist=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+".tmp-"+process.pid;fs.writeFileSync(tmp,JSON.stringify(state));fs.renameSync(tmp,file);};
 function ensure(systemID){const id=String(systemID);return state.systems[id]??={ore:200,goods:100,demand:100,security:50,losses:0};}
 function register(pilots){
   for(const [i,p] of pilots.entries()){
     if(!p?.id||!Number.isSafeInteger(Number(p.systemID)))continue;
     ensure(p.systemID);
     state.pilots[p.id]??={role:ROLES[i%ROLES.length],cargo:0,credits:100,completed:0};
   }
 }
 function step(pilots){
  // Accumulate decisions first, then commit. No negative or infinite balances.
  const ordered=[...pilots].sort((a,b)=>a.id.localeCompare(b.id));
  for(const p of ordered){
   const sys=ensure(p.systemID),agent=state.pilots[p.id];
   if(!agent)continue;
   if(agent.role==="miner"){const produced=Math.min(3,1000000-sys.ore);sys.ore+=produced;agent.completed+=produced;}
   if(agent.role==="hauler"){const qty=Math.min(2,sys.ore,1000000-agent.cargo);sys.ore-=qty;agent.cargo+=qty;agent.completed+=qty;}
   if(agent.role==="trader"){const qty=Math.min(2,agent.cargo);agent.cargo-=qty;sys.goods=cap(sys.goods+qty);agent.credits=cap(agent.credits+qty*3);agent.completed+=qty;}
   if(agent.role==="patrol"){sys.security=Math.min(100,sys.security+1);agent.completed++;}
   sys.demand=cap(Math.max(0,sys.demand-1)+(sys.goods<25?1:0));
  }
 }
 function advance(pilots){
  register(pilots);
  const now=clock();if(now<state.lastAt)return {status:"CLOCK_REWIND",steps:0};
  const due=Math.floor((now-state.lastAt)/stepMs);
  const steps=Math.min(due,maxCatchup);
  for(let i=0;i<steps;i++)step(pilots);
  if(steps){state.lastAt+=steps*stepMs;persist();}
  else if(Object.keys(state.pilots).length)persist();
  return {status:due>steps?"CATCHUP_REMAINING":"OK",steps,remaining:due-steps};
 }
 function recordLoss(systemID,amount=1){
  const s=ensure(systemID);const n=Math.max(1,Math.min(100,Math.floor(amount)));
  s.losses=cap(s.losses+n);s.security=Math.max(0,s.security-n);s.demand=cap(s.demand+n*4);
  const entry={type:"loss",systemID:Number(systemID),amount:n,at:clock()};
  state.events.push(entry);if(state.events.length>100)state.events.shift();persist();return entry;
 }
 return {advance,recordLoss,snapshot:()=>structuredClone(state)};
}
module.exports={createEconomy};
