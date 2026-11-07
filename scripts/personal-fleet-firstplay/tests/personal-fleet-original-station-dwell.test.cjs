'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalStationDwell.js'),'utf8');
const SIG='a'.repeat(64),V=(x=0,y=0,z=0)=>({x,y,z});
const base=Object.freeze({operationID:'pfret-001',assignmentID:'job-001',shipItemID:1400,
  ownerCharacterID:1900,pilotID:'coop-pilot-101',stationID:60000002,systemID:30000001,
  actorGeneration:2,signature:SIG,returnDispatchCount:1,phase:'RETURNING'});
function fixture(){
 let now=1000000,failCommit=false,deny=false,poison=false,transactions=0;
 const t='corporationRuntime',k='coop-personal-fleet\u001freturn-dock-v1:'+base.assignmentID;
 const table=new Map([[t+'\u001f'+k,{...base}],['items\u001fitems',{'1400':{itemID:1400,ownerID:1900,
 categoryID:6,flagID:0,locationID:30000001,spaceState:{systemID:30000001}}}]]);
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poison,transact(names,fn){
   if(failCommit)throw Error('SIMULATED_SQLITE_COMMIT_FAIL');transactions++;
   assert.ok(names.includes('corporationRuntime'));
   const snapshot=new Map([...table].map(([key,v])=>[key,structuredClone(v)]));
   const tx={get:(kind,key)=>snapshot.has(kind+'\u001f'+key)?structuredClone(snapshot.get(kind+'\u001f'+key)):null,
     put:(kind,key,val)=>snapshot.set(kind+'\u001f'+key,structuredClone(val)),
     del:(kind,key)=>snapshot.delete(kind+'\u001f'+key)};
   const r=fn(tx);table.clear();for(const [a,b] of snapshot)table.set(a,b);return r;
 }};
 const actor={entityID:1400,itemID:1400,ownerID:1900,nativeNpc:true,mode:'STOP',
   position:V(1100),velocity:V(),radius:65,warpState:null,pendingWarp:null,isWarping:false};
 const stationBall={entityID:60000002,position:V(1000),radius:300};
 const entities=new Map([[1400,actor],[60000002,stationBall]]);
 const scene={systemID:30000001,getEntityByID:id=>entities.get(id)||null};
 const scenes=new Map([[30000001,scene]]);
 const controller={entityID:1400,systemID:30000001};
 const deps={
  'node:crypto':require('node:crypto'),
  '../gameStore':{coopAtomicNativeRows:atomic},
  './worldData':{getStationByID(id){return id===60000002?{stationID:60000002,solarSystemID:30000001,position:V(1000)}:null;}},
  './runtime':{scenes},
  './npc/npcRegistry':{getControllerByEntityID:id=>id===1400?controller:null},
  './coopPersonalFleetReturnDock':{
    key:id=>'coop-personal-fleet\u001freturn-dock-v1:'+id,
    signature:()=>SIG,manifestValid:(m,r)=>m?.source==='ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1'&&m.shipItemID===r.shipItemID,arrivalValid(p,row){return p.source==='ORIGINAL_EVEJS_SCENE_STATION_V1'&&
      p.sceneEpoch&&p.systemID===row.systemID&&p.shipItemID===row.shipItemID&&
      p.actorGeneration===row.actorGeneration&&p.stationDockAccess===true&&p.shipStopped===true&&
      p.warpInactive===true&&p.nativeControllerPresent===true&&p.noDuplicatePhysicalEntity===true&&
      Math.hypot(p.shipPosition.x-p.stationPosition.x)-p.shipRadius-p.stationRadius<=2500;}}
 };
 let api={exports:{}};vm.runInNewContext(SOURCE,{module:api,require:n=>{if(!(n in deps))throw Error('UNKNOWN_IMPORT:'+n);return deps[n]},Date,
    Object,Array,Number,Set,Map,WeakMap,Math,structuredClone,RegExp},
    {filename:'coopPersonalFleetOriginalStationDwell.js'});
 const source=api.exports.createOriginalStationDwell({orderWitness:{verifyNativeActor:()=>!deny},
   enabled:()=>true,allWritersFenced:()=>true,clock:()=>now});
 const row=()=>({...base,phase:'ARRIVAL_OBSERVED',arrivedAtMs:1000100,
   sceneEpoch:source.inspect(base)?.sceneEpoch});
 const tick=(ms=100)=>{now+=ms;return source.sample(base)};
 return {api:api.exports,source,row,tick,actor,stationBall,scene,scenes,entities,table,k,
    setNow:v=>now=v,now:()=>now,deny:()=>deny=true,poison:()=>poison=true,
    corrupt:()=>{const r=table.get(t+'\u001f'+k);r.signature='b'.repeat(64);table.set(t+'\u001f'+k,r)},
    setPhase:p=>{const r=table.get(t+'\u001f'+k);r.phase=p;table.set(t+'\u001f'+k,r)},
    failCommit:()=>failCommit=true,getTransactions:()=>transactions};
}
const label=(name,fn)=>test(name,()=>fn(fixture()));
label('first in-zone sample is original atomic receipt',f=>{
 const p=f.source.sample(base);assert.equal(p.status,'OBSERVED');assert.equal(p.samples,1);
 const receipt=f.source.inspect(base);assert.equal(receipt.source,'ORIGINAL_EVEJS_TICK_STATION_DWELL_V1');
 assert.ok(typeof receipt.sceneEpoch==='string'&&receipt.sceneEpoch.includes('.'));
});
label('fresh original receipt is insufficient before two seconds',f=>{
 f.source.sample(base);f.tick(100);assert.equal(f.source.verifyContinuousDwell(f.row(),{get:()=>f.source.inspect(base)}),null);
});
label('twenty one server ticks prove bounded continuous arrival',f=>{
 f.source.sample(base);for(let i=0;i<20;i++)f.tick();const r=f.row();
 const p=f.source.verifyStationArrival(r,{get:(table,key)=>f.table.get(table+'\u001f'+key)||null});
 assert.ok(p);assert.equal(p.sceneEpoch,r.sceneEpoch);
 const seen=f.source.verifyContinuousDwell(r,{get:(table,key)=>f.table.get(table+'\u001f'+key)||null});
 assert.equal(seen?.source,'ORIGINAL_EVEJS_CONTINUOUS_DOCK_DWELL_V1');
 assert.equal(seen?.nativeMonitorPersisted,true);
});
label('dwell is not proven if scene disappeared on restart',f=>{
 f.source.sample(base);for(let i=0;i<20;i++)f.tick();const row=f.row();f.scenes.delete(30000001);
 assert.equal(f.source.verifyStationArrival(row,{get:()=>null}),null);
 assert.equal(f.source.verifyContinuousDwell(row,{get:()=>null}),null);
});
label('missing original station ball fails closed',f=>{
 f.entities.delete(60000002);assert.match(f.source.sample(base).reason,/UNVERIFIED/);
});
label('unknown original station geometry cannot dock',f=>{
 f.stationBall.position=V(100000);
 assert.match(f.source.sample(base).reason,/UNVERIFIED/);
});
label('native NPC departures reset the persisted dwell',f=>{
 f.source.sample(base);for(let i=0;i<11;i++)f.tick();f.actor.position=V(1e6);
 assert.equal(f.tick().status,'BLOCKED');assert.equal(f.source.inspect(base),null);
 f.actor.position=V(1000);assert.equal(f.tick().status,'OBSERVED');assert.equal(f.source.inspect(base).samples,1);
});
label('five-hundred ms no native tick resets continuation',f=>{
 f.source.sample(base);f.tick(100);f.tick(500);assert.equal(f.source.inspect(base).samples,1);
});
label('clock rollback cannot preserve or rewrite dwell',f=>{
 f.source.sample(base);f.tick(100);f.setNow(1000000);
 assert.match(f.source.sample(base).reason,/CLOCK/);assert.equal(f.source.inspect(base).samples,2);
});
label('stale samples more than hundred ms cannot authorize docking',f=>{
 f.source.sample(base);for(let i=0;i<20;i++)f.tick();const row=f.row();f.setNow(f.now()+101);
 assert.equal(f.source.verifyContinuousDwell(row,{get:(t,k)=>f.table.get(t+'\u001f'+k)||null}),null);
});
label('tampered original PF56 persisted row blocks sample',f=>{
 f.corrupt();assert.equal(f.source.sample(base).status,'BLOCKED');
});
label('PF56 no longer RETURNING blocks arrival monitor',f=>{
 f.setPhase('DOCK_ISSUING');assert.equal(f.source.sample(base).status,'BLOCKED');
});
label('original PF52 ownership witness revocation blocks sample',f=>{
 f.deny();assert.equal(f.source.sample(base).status,'BLOCKED');
});
label('GameStore poison blocks all monitoring',f=>{
 f.poison();assert.equal(f.source.sample(base).status,'BLOCKED');
});
label('original SQLite failure never returns a positive sample',f=>{
 f.failCommit();assert.match(f.source.sample(base).reason,/UNCERTAIN/);
});
label('duplicate physical actor in another scene invalidates sample',f=>{
 f.scenes.set(30000002,{systemID:30000002,getEntityByID:id=>id===1400?{...f.actor}:null});
 assert.equal(f.source.sample(base).status,'BLOCKED');
});
label('active warp never counts as station arrival',f=>{
 f.actor.mode='WARP';assert.equal(f.source.sample(base).status,'BLOCKED');
});
label('moving ship never counts as STOP',f=>{
 f.actor.velocity=V(10);assert.equal(f.source.sample(base).status,'BLOCKED');
});
label('small intervals do not mint extra samples',f=>{
 f.source.sample(base);assert.equal(f.tick(10).status,'UNCHANGED');
 assert.equal(f.source.inspect(base).samples,1);
});
label('bad signature cannot source a dwell receipt',f=>{
 assert.equal(f.source.sample({...base,signature:'Z'.repeat(64)}).status,'BLOCKED');
});
label('source does not expose executable dock or warp mutations',f=>{
 assert.equal(typeof f.source.executeDock,'undefined');assert.equal(typeof f.source.executeReturn,'undefined');
});

function dockState(f){
 f.source.sample(base);for(let i=0;i<20;i++)f.tick();
 const previous=f.source.inspect(base);
 const path='corporationRuntime\u001f'+f.k,stored=f.table.get(path);
 const manifest={source:'ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1',shipItemID:1400};
 f.table.set(path,{...stored,phase:'DOCK_ISSUING',dockDispatchCount:1,
   arrivedAtMs:1000100,sceneEpoch:previous.sceneEpoch,
   arrivalProofHash:'a'.repeat(64),manifest});
 return {...base,phase:'DOCK_ISSUING',dockDispatchCount:1,
   arrivedAtMs:1000100,sceneEpoch:previous.sceneEpoch,
   arrivalProofHash:'a'.repeat(64),manifest};
}
const currentTx=f=>({get:(t,k)=>f.table.get(t+'\u001f'+k)||null});
label('native PF66 readiness uses the same persisted 2-second dwell proof',f=>{
 const r=dockState(f);assert.equal(f.source.verifyOriginalDockReady(r,currentTx(f)),true);
});
label('a full original scene unload makes PF66 deny despite durable receipt',f=>{
 const r=dockState(f);f.scenes.delete(30000001);
 assert.equal(f.source.verifyOriginalDockReady(r,currentTx(f)),false);
});
label('PF66 denies a stale receipt before original ItemStore mutation',f=>{
 const r=dockState(f);f.setNow(f.now()+101);
 assert.equal(f.source.verifyOriginalDockReady(r,currentTx(f)),false);
});
label('PF66 requires original committed DOCK_ISSUING not just a valid client row',f=>{
 const r=dockState(f);f.setPhase('ARRIVAL_OBSERVED');
 assert.equal(f.source.verifyOriginalDockReady(r,currentTx(f)),false);
});
label('PF66 fails closed when original fitting/cargo manifest is incomplete',f=>{
 const r=dockState(f),k='corporationRuntime\u001f'+f.k;f.table.get(k).manifest={};
 assert.equal(f.source.verifyOriginalDockReady(r,currentTx(f)),false);
});
label('PF66 rejects unrecorded station return attempts',f=>{
 const r=dockState(f),k='corporationRuntime\u001f'+f.k;f.table.get(k).dockDispatchCount=2;
 assert.equal(f.source.verifyOriginalDockReady(r,currentTx(f)),false);
});
label('PF66 cannot treat a changed NPC actor as dock-ready',f=>{
 const r=dockState(f);f.actor.mode='WARP';
 assert.equal(f.source.verifyOriginalDockReady(r,currentTx(f)),false);
});
