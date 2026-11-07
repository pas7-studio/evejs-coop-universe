'use strict';
/**
 * Actual source-owned Node/SQLite station monitor scheduler for original EveJS.
 * Polls ONLY already-issued, validated PF56 return intents and invokes the
 * original station dwell witness on a 100ms unref'd native server timer.
 * May advance an EXISTING durable PF56 order via its server-only authority.
 * Never requests a new return, forges a player session, or blindly retries.
 */
const gameStore=require('../gameStore');
const pf56=require('./coopPersonalFleetReturnDock');
const T='corporationRuntime',MAX_OPEN=32,INTERVAL_MS=100;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const no=reason=>Object.freeze({status:'BLOCKED',reason});
function createOriginalStationTickDriver({stationDwell,advanceReturn=()=>no('PF56_SERVER_CONTINUATION_NOT_INSTALLED'),enabled=()=>false,
 allWritersFenced=()=>false,scheduler={setInterval,clearInterval}}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
    typeof atomic.isPoisoned!=='function'||
    typeof pf56.key!=='function'||typeof pf56.signature!=='function'||
    typeof stationDwell?.sample!=='function'||
    [advanceReturn,enabled,allWritersFenced,scheduler?.setInterval,scheduler?.clearInterval].some(f=>typeof f!=='function'))
  throw Error('PF56_ORIGINAL_STATION_NATIVE_TICK_SOURCE_REQUIRED');
 let handle=null,busy=false,started=false;
 const live=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 function openReturns(){
  return atomic.transact([T],tx=>{
   const ix=tx.get(T,pf56.OPS);
   if(ix===null)return [];
   if(!obj(ix)||ix.version!==1||!obj(ix.operations)||
      Object.keys(ix.operations).length>2048)return null;
   const rows=[],seen=new Set();
   for(const [op,entry] of Object.entries(ix.operations)){
    if(!token(op)||!obj(entry)||!token(entry.assignmentID)||
       typeof entry.signature!=='string'||!/^[0-9a-f]{64}$/.test(entry.signature))return null;
    if(seen.has(entry.assignmentID))return null;
    seen.add(entry.assignmentID);
    const r=tx.get(T,pf56.key(entry.assignmentID));
    if(r===undefined)return null;
    if(r===null)return null; // A committed index without its return row is corrupt.
    if(!obj(r)||r.assignmentID!==entry.assignmentID||r.operationID!==op||
       r.signature!==entry.signature||r.signature!==pf56.signature(r))return null;
    if(['RETURN_ISSUING','RETURNING','ARRIVAL_OBSERVED','DOCK_ISSUING'].includes(r.phase)){
      if(!positive(r.stationID)||!positive(r.systemID)||!positive(r.shipItemID))return null;
      rows.push(structuredClone(r));
      if(rows.length>MAX_OPEN)return null;
    }else if(r.phase!=='DOCKED')return null;
   }
   return rows;
  });
 }
 function tick(){
  if(!live())return no('PF56_MONITOR_OFF_OR_NATIVE_SOURCE_FENCED');
  if(busy)return no('PF56_MONITOR_OVERLAPPING_TICK');
  busy=true;
  try{
   const rows=openReturns();
   if(!Array.isArray(rows))return no('PF56_MONITOR_ORIGINAL_RETURN_ROWS_UNCERTAIN');
   let observed=0,blocked=0,advanced=0,pending=0;
   for(const row of rows){
    if(!live())return no('PF56_MONITOR_GATE_REVOKED');
    if(['RETURNING','ARRIVAL_OBSERVED'].includes(row.phase)){
     let sampled;
     try{sampled=stationDwell.sample(row);}catch{sampled=null;}
     if(sampled?.status==='OBSERVED'||sampled?.status==='UNCHANGED')observed++;
     else blocked++;
    }
    if(!live())return no('PF56_MONITOR_GATE_REVOKED');
    let result;
    try{result=advanceReturn(row);}catch{result=null;}
    if(['RETURNING','ARRIVAL_OBSERVED','DOCKED','ALREADY_DOCKED'].includes(result?.status))advanced++;
    else pending++;
   }
   return {status:'SAMPLED',active:rows.length,observed,blocked,advanced,pending};
  }catch{return no('PF56_MONITOR_SQLITE_OR_SOURCE_UNCERTAIN');}
  finally{busy=false;}
 }
 function start(){
  if(started||handle!==null)throw Error('PF56_MONITOR_ALREADY_STARTED_OR_STOPPED');
  started=true;
  handle=scheduler.setInterval(()=>{try{tick();}catch{}},INTERVAL_MS);
  if(!handle)throw Error('PF56_MONITOR_TIMER_NOT_INSTALLED');
  handle.unref?.();
  return true;
 }
 function stop(){
  if(handle!==null){scheduler.clearInterval(handle);handle=null;}
  // Sticky start fence: never create overlapping timers in one process.
  return true;
 }
 return Object.freeze({start,stop,tick,getStatus:()=>({started,active:handle!==null})});
}
module.exports=Object.freeze({createOriginalStationTickDriver,INTERVAL_MS,MAX_OPEN});
