"use strict";
// Bounded offline simulation. Virtual resources are NOT EveJS market inventory.
const fs=require("node:fs"),path=require("node:path");
const ROLES=["miner","hauler","patrol","trader","pirate"];
const cap=n=>Math.max(0,Math.min(1000000,Math.floor(Number(n)||0)));
function createEconomy({file,clock=()=>Date.now(),stepMs=60000,maxCatchup=1440,fsApi=fs}){
 if(!file||!Number.isInteger(stepMs)||stepMs<10000||!Number.isInteger(maxCatchup)||maxCatchup<1||maxCatchup>10000)throw Error("invalid economy settings");
 let state,journalPresent=false,persistenceUnverified=false;
 try{
  state=JSON.parse(fsApi.readFileSync(file,"utf8"));
  if(state.version!==1)throw Error("incompatible economy state");
  // nativeDelivered is a durable monotone high-water mark of original
  // depot receipts. Treating a malformed value as zero would re-credit
  // historical cargo on the next syncNativeDeliveries() call.
  if(!state.systems||typeof state.systems!=="object"||Array.isArray(state.systems))
   throw Error("ECONOMY_NATIVE_DELIVERY_CHECKPOINT_INVALID");
  for(const entry of Object.values(state.systems)){
   if(!entry||typeof entry!=="object"||Array.isArray(entry)||
      (Object.prototype.hasOwnProperty.call(entry,"nativeDelivered")&&
       (!Number.isSafeInteger(entry.nativeDelivered)||entry.nativeDelivered<0)))
    throw Error("ECONOMY_NATIVE_DELIVERY_CHECKPOINT_INVALID");
  }
  journalPresent=true;
 }catch(e){if(e.code!=="ENOENT")throw e;}
 if(!state)state={version:1,lastAt:clock(),systems:{},pilots:{},events:[]};
 // Supply receipts can be replayed if a second process overwrites the
 // 'nativeDelivered' high-water mark. Every mutator, including simulation
 // and loss events, must share the same durable cross-process write fence.
 function verifyCurrentRead(){
  if(persistenceUnverified)throw Error("ECONOMY_PERSISTENCE_UNVERIFIED");
  try{
   try{
    fsApi.readFileSync(file+".lock","utf8");
    throw Error("ECONOMY_WRITE_IN_PROGRESS");
   }catch(e){if(e?.code!=="ENOENT")throw e;}
   let disk=null;
   try{disk=JSON.parse(fsApi.readFileSync(file,"utf8"));}
   catch(e){if(e?.code!=="ENOENT")throw e;}
   if((disk!==null)!==journalPresent||
      (journalPresent&&JSON.stringify(disk)!==JSON.stringify(state)))
    throw Error("ECONOMY_CONCURRENT_JOURNAL_DRIFT");
  }catch(error){persistenceUnverified=true;throw error;}
 }
 function persist(){
  if(persistenceUnverified)throw Error("ECONOMY_PERSISTENCE_UNVERIFIED");
  const folder=path.dirname(file),lock=file+".lock",tmp=file+".tmp-"+process.pid;
  let lockFd=null,held=false;
  try{
   fsApi.mkdirSync(folder,{recursive:true});
   lockFd=fsApi.openSync(lock,"wx",0o600);held=true;
   fsApi.writeFileSync(lockFd,String(process.pid));fsApi.fsyncSync(lockFd);
   fsApi.closeSync(lockFd);lockFd=null;
   let disk=null;
   try{disk=JSON.parse(fsApi.readFileSync(file,"utf8"));}
   catch(e){if(e?.code!=="ENOENT")throw e;}
   if((disk!==null)!==journalPresent||
      (journalPresent&&JSON.stringify(disk)!==JSON.stringify(stateBeforeMutation)))
    throw Error("ECONOMY_CONCURRENT_JOURNAL_DRIFT");
   const fd=fsApi.openSync(tmp,"w");
   try{fsApi.writeFileSync(fd,JSON.stringify(state));fsApi.fsyncSync(fd);}
   finally{fsApi.closeSync(fd);}
   fsApi.renameSync(tmp,file);
   try{
    const directoryFd=fsApi.openSync(folder,"r");
    try{fsApi.fsyncSync(directoryFd);}finally{fsApi.closeSync(directoryFd);}
   }catch(error){
    if(!["EPERM","EACCES","EISDIR","EINVAL","EBADF"].includes(error?.code))throw error;
   }
   journalPresent=true;
  }catch(error){
   persistenceUnverified=true;
   try{fsApi.unlinkSync(tmp);}catch(_ignored){}
   throw error;
  }finally{
   let releaseError=null;
   if(lockFd!==null)try{fsApi.closeSync(lockFd);}catch(e){releaseError=e;}
   if(held)try{fsApi.unlinkSync(lock);}catch(e){releaseError=releaseError||e;}
   if(releaseError){persistenceUnverified=true;throw releaseError;}
  }
 }
 // The expected disk image is retained *before* any in-memory mutation.
 let stateBeforeMutation=structuredClone(state);
 function beforeMutation(){
  verifyCurrentRead();
  stateBeforeMutation=structuredClone(state);
 }
 function ensure(systemID){const id=String(systemID);return state.systems[id]??={ore:200,goods:100,demand:100,security:50,losses:0};}
 function register(pilots){
   const upgradeRoles=state.rolesVersion!==2;
   for(const [i,p] of pilots.entries()){
     if(!p?.id||!Number.isSafeInteger(Number(p.systemID)))continue;
     ensure(p.systemID);
     state.pilots[p.id]??={role:ROLES[i%ROLES.length],cargo:0,credits:100,completed:0};
     if(upgradeRoles)state.pilots[p.id].role=ROLES[i%ROLES.length];
   }
   // An empty registration is not a durable schema upgrade.
   if(pilots.length)state.rolesVersion=2;
 }
 function step(pilots){
  // Accumulate decisions first, then commit. No negative or infinite balances.
  const ordered=[...pilots].sort((a,b)=>a.id.localeCompare(b.id));
  for(const p of ordered){
   const sys=ensure(p.systemID),agent=state.pilots[p.id];
   if(!agent)continue;
   if(agent.role==="miner"){const produced=Math.min(3,1000000-sys.ore);sys.ore+=produced;agent.completed+=produced;}
   if(agent.role==="hauler"){const qty=Math.min(2,sys.ore,1000000-sys.goods);sys.ore-=qty;sys.goods+=qty;agent.credits=cap(agent.credits+qty);agent.completed+=qty;}
   if(agent.role==="trader"){const qty=Math.min(2,sys.goods);sys.goods-=qty;sys.demand=cap(sys.demand+qty);agent.credits=cap(agent.credits+qty*3);agent.completed+=qty;}
   if(agent.role==="patrol"){sys.security=Math.min(100,sys.security+1);agent.completed++;}
   if(agent.role==="pirate"){
     const stolen=Math.min(2,sys.goods);
     sys.goods-=stolen;
     agent.credits=cap(agent.credits+stolen*2);
     agent.completed+=stolen;
     sys.security=Math.max(0,sys.security-1);
     sys.demand=cap(sys.demand+stolen);
   }
   sys.demand=cap(Math.max(0,sys.demand-1)+(sys.goods<25?1:0));
  }
 }
 function advance(pilots){
  beforeMutation();
  const now=clock();if(now<state.lastAt)return {status:"CLOCK_REWIND",steps:0};
  register(pilots);
  const due=Math.floor((now-state.lastAt)/stepMs);
  const steps=Math.min(due,maxCatchup);
  for(let i=0;i<steps;i++)step(pilots);
  if(steps){state.lastAt+=steps*stepMs;persist();}
  else if(JSON.stringify(state)!==JSON.stringify(stateBeforeMutation))persist();
  return {status:due>steps?"CATCHUP_REMAINING":"OK",steps,remaining:due-steps};
 }
 function recordLoss(systemID,amount=1){
  // An unverified loss cannot turn native system security into NaN/null
  // or create non-geolocatable phantom economic systems/events.
  const id=Number(systemID),rawAmount=Number(amount);
  if(!Number.isSafeInteger(id)||id<=0||
     !Number.isFinite(rawAmount)||rawAmount<0)
   throw Error("ECONOMY_INVALID_LOSS");
  beforeMutation();
  const s=ensure(id),n=Math.max(1,Math.min(100,Math.floor(rawAmount)));
  s.losses=cap(s.losses+n);s.security=Math.max(0,s.security-n);s.demand=cap(s.demand+n*4);
  const entry={type:"loss",systemID:id,amount:n,at:clock()};
  state.events.push(entry);if(state.events.length>100)state.events.shift();persist();return entry;
 }
 function syncNativeDeliveries(totals={}){
  beforeMutation();
  let accepted=0,modified=false;
  for(const [id,total] of Object.entries(totals)){
   const systemID=Number(id),count=Number(total);
   if(!Number.isSafeInteger(systemID)||systemID<=0||
      !Number.isSafeInteger(count)||count<0)continue;
   const existing=state.systems[String(systemID)];
   const before=Math.max(0,Number(existing?.nativeDelivered)||0);
   if(count<=before)continue;
   const sys=ensure(systemID),gained=count-before;
   sys.goods=cap(sys.goods+gained);
   sys.demand=Math.max(0,cap(sys.demand-gained));
   sys.nativeDelivered=count;
   accepted+=gained;modified=true;
   state.events.push({type:"real-ore-delivery",systemID,amount:gained,at:clock()});
  }
  // A no-op sync must never change in-memory history without persisting
  // it; otherwise the next read fence flags the same instance as stale.
  if(modified&&state.events.length>100)state.events=state.events.slice(-100);
  if(modified)persist();
  return {status:modified?"UPDATED":"UNCHANGED",quantity:accepted};
 }
 return {advance,recordLoss,syncNativeDeliveries,snapshot:()=>{
  verifyCurrentRead();
  return structuredClone(state);
 }};
}
module.exports={createEconomy};
