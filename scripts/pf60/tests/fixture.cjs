'use strict';
const {DatabaseSync}=require('node:sqlite');
const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const {createTerminalCustody,DEPLOY,HANDOFF,LOCK,RETURN,LEDGER,CLAIMS,terminalKey,
 terminalShipKey}=require('../native/coopPersonalFleetTerminalCustody.cjs');
const P='coop-personal-fleet\u001f';
const INDEX=P+'ship-index-v1',ROSTER=P+'roster-v1:';
const c0={operationID:'terminal-1',assignmentID:'assignment-1',pilotID:'coop-pilot-123',
 shipItemID:1001,ownerCharacterID:202,systemID:300,actorGeneration:8,
 generation:2,typeID:606,mode:'DOCK',stationID:900};
const clone=x=>structuredClone(x);
const shipItem=c=>({itemID:c.shipItemID,ownerID:c.ownerCharacterID,typeID:c.typeID,
 categoryID:6,locationID:c.stationID,flagID:4,spaceState:null});
const nativeRow=(c,isController=false)=>({entityID:c.shipItemID,systemID:c.systemID,
 personalFleetOriginal:true,personalFleetAssignmentID:c.assignmentID,
 personalFleetPilotID:c.pilotID,personalFleetGeneration:c.generation,
 ...(isController?{operatorKind:'PERSONAL_FLEET'}:{ownerID:c.ownerCharacterID})});
const witness=c=>({source:c.mode==='DOCK'?'ORIGINAL_EVEJS_PF60_DOCK_V1':'ORIGINAL_EVEJS_PF60_LOSS_V1',
 assignmentID:c.assignmentID,shipItemID:c.shipItemID,ownerCharacterID:c.ownerCharacterID,
 pilotID:c.pilotID,systemID:c.systemID,actorGeneration:c.actorGeneration,
 noLiveSceneActor:true,noCompetingWriter:true,originalAssetsAccountedFor:true,
 noDuplicateOriginalItemIDs:true,receiptHash:'a'.repeat(64),
 ...(c.mode==='DOCK'?{stationID:c.stationID,originalShipInHangar:true,
 originalDockReceiptPersisted:true}:{wreckID:c.wreckID,originalShipDestroyed:true,
 originalKillPersisted:true})});
function setup(options={}) {
 const c={...c0,...options.command};if(c.mode==='LOSS')delete c.stationID;
 const dir=options.dir||fs.mkdtempSync(path.join(os.tmpdir(),'pf60-'));
 const file=path.join(dir,'game.db'), db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS cells(table_name TEXT NOT NULL,key TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(table_name,key))');
 const read=(table,key)=>{const r=db.prepare('SELECT json FROM cells WHERE table_name=? AND key=?').get(table,key);
  return r?JSON.parse(r.json):null;};
 const put=(table,key,value)=>db.prepare('INSERT INTO cells(table_name,key,json) VALUES(?,?,?) ON CONFLICT(table_name,key) DO UPDATE SET json=excluded.json').run(table,key,JSON.stringify(value));
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',poison:false,transact(tables,fn){
  db.exec('BEGIN IMMEDIATE');try{
   const r=fn({get:(table,key)=>{if(!tables.includes(table))throw Error('UNLISTED_TABLE');return read(table,key);},
    put:(table,key,value)=>{if(!tables.includes(table))throw Error('UNLISTED_TABLE');put(table,key,value);}});
   if(options.beforeCommit)options.beforeCommit(r);
   db.exec('COMMIT');if(options.afterCommit)options.afterCommit(r);return r;
  }catch(e){db.exec('ROLLBACK');throw e;}
 },isPoisoned(){return atomic.poison;}};
 const root={coopAtomicNativeRows:atomic},pf52={REGISTRY_KEY:INDEX,ROSTER_PREFIX:ROSTER,
 validateIndex:x=>{if(!x||!x.ships)throw Error('INVALID_INDEX');return x;},
 validateRoster:(x,owner)=>{if(x?.ownerCharacterID!==owner||!x.pilots)throw Error('INVALID_ROSTER');return x;}};
 const claimsPolicy={validate:x=>{if(!x||!x.claims)throw Error('INVALID_CLAIMS');return x;}};
 const flags={enabled:true,writers:true,auth:true,exclusive:true};
 const physical={entity:nativeRow(c),controller:nativeRow(c,true),sceneAbsent:true,
 modules:[],cargo:[],calls:0,failAfterSideEffect:false};
 const nativeIdentity=()=>({source:'ORIGINAL_EVEJS_NATIVE_ENTITY_CONTROLLER_V1',
 shipItemID:c.shipItemID,systemID:c.systemID,sceneAbsent:physical.sceneAbsent,
 modules:clone(physical.modules),cargo:clone(physical.cargo),
 entity:clone(physical.entity),controller:clone(physical.controller)});
 const cleanup=()=>{physical.calls++;
  physical.entity=null;physical.controller=null;
  if(physical.failAfterSideEffect)throw Error('SIGKILL-LIKE_UNKNOWN');
  return {success:true};};
 const proof=witness(c);
 const create=()=>createTerminalCustody({gameStore:root,pf52,claimsPolicy,
  authenticateCommand:()=>flags.auth,verifyExclusiveOwnership:()=>flags.exclusive,
  verifyOriginalTerminalWitness:()=>clone(proof),readNativeIdentity:nativeIdentity,
  executeScopedNativeCleanup:cleanup,allWritersFenced:()=>flags.writers,
  enabled:()=>flags.enabled,clock:()=>1_800_000_000_000});
 const seed=()=>{
  const hand={status:'CONSUMED',assignmentID:c.assignmentID,shipItemID:c.shipItemID,
   ownerCharacterID:c.ownerCharacterID,pilotID:c.pilotID,systemID:c.systemID,
   generation:c.generation,sourcePF54Hash:'c'.repeat(64)};
  put('corporationRuntime',DEPLOY+c.assignmentID,{assignmentID:c.assignmentID,
   shipItemID:c.shipItemID,ownerCharacterID:c.ownerCharacterID,pilotID:c.pilotID,
   systemID:c.systemID,generation:c.generation,actorGeneration:c.actorGeneration,
   typeID:c.typeID,phase:'ACTIVE'});
  put('corporationRuntime',HANDOFF+c.assignmentID,hand);
  put('corporationRuntime',LOCK+c.shipItemID,{assignmentID:c.assignmentID,
    sourcePF54Hash:hand.sourcePF54Hash});
  put('corporationRuntime',INDEX,{ships:{[c.shipItemID]:{assignmentID:c.assignmentID,generation:c.generation}}});
  put('corporationRuntime',ROSTER+c.ownerCharacterID,{ownerCharacterID:c.ownerCharacterID,
   pilots:{[c.pilotID]:{status:'HANGAR_RESERVED',shipItemID:c.shipItemID}}});
  put('corporationRuntime',CLAIMS,{claims:{[c.shipItemID]:{
   assignmentID:c.assignmentID,generation:c.actorGeneration,ownerType:'PERSONAL_FLEET'}}});
  if(c.mode==='DOCK'){
   put('corporationRuntime',RETURN+c.assignmentID,{assignmentID:c.assignmentID,
    shipItemID:c.shipItemID,ownerCharacterID:c.ownerCharacterID,pilotID:c.pilotID,
    systemID:c.systemID,actorGeneration:c.actorGeneration,stationID:c.stationID,
    dockDispatchCount:1,phase:'DOCK_ISSUING'});
   put('items','items',{[c.shipItemID]:shipItem(c)});
  }else{
   put('items','items',{});
   put('npcWrecks','npcWrecks',{wrecks:{[c.wreckID]:{wreckID:c.wreckID,
    sourceEntityID:c.shipItemID,systemID:c.systemID}}});
  }
 };
 const settle=()=>{
  const dep=read('corporationRuntime',DEPLOY+c.assignmentID);
  put('corporationRuntime',DEPLOY+c.assignmentID,{...dep,phase:c.mode==='DOCK'?'DOCKED':'LOST',
   ...(c.mode==='LOSS'?{lossWreckID:c.wreckID}:{})});
  if(c.mode==='DOCK'){
   const ret=read('corporationRuntime',RETURN+c.assignmentID);
   put('corporationRuntime',RETURN+c.assignmentID,{...ret,phase:'DOCKED'});
  }else{
   put('corporationRuntime',LEDGER,{losses:{[c.assignmentID]:{
    shipItemID:c.shipItemID,wreckID:c.wreckID,ownerCharacterID:c.ownerCharacterID,pilotID:c.pilotID}}});
  }
  put('corporationRuntime',INDEX,{ships:{}});
  put('corporationRuntime',ROSTER+c.ownerCharacterID,{ownerCharacterID:c.ownerCharacterID,
   pilots:{[c.pilotID]:{status:'CONTRACTED',shipItemID:null}}});
  put('corporationRuntime',CLAIMS,{claims:{}});
 };
 if(!options.noSeed)seed();
 const close=()=>{db.close();if(!options.dir)fs.rmSync(dir,{recursive:true,force:true});};
 return {c,db,file,dir,root,pf52,flags,physical,proof,read,put,create,seed,settle,close,
  terminalKey,terminalShipKey,DEPLOY,HANDOFF,LOCK,RETURN,CLAIMS,LEDGER,INDEX,ROSTER};
}
module.exports={setup,c0,witness,nativeRow};
