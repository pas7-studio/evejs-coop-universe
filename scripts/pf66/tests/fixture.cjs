'use strict';
const {DatabaseSync}=require('node:sqlite');
const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const pf=require('../native/coopPersonalFleetScopedDock.cjs');
const P='coop-personal-fleet\u001f';
const DEFAULT={version:1,phase:'DOCK_ISSUING',operationID:'pf56-dock-1',
 signature:'b'.repeat(64),assignmentID:'assignment-1',shipItemID:1001,
 pilotID:'coop-pilot-123',ownerCharacterID:202,stationID:900,
 systemID:300,reservationGeneration:2,actorGeneration:8,typeID:606,
 arrivalProofHash:'c'.repeat(64),dockDispatchCount:1,manifest:{
  source:'ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1',
  shipItemID:1001,ownerCharacterID:202,assignmentID:'assignment-1',actorGeneration:8,
  fittingHash:'d'.repeat(64),cargoHash:'e'.repeat(64),cargoItemIDs:[],
  originalItemTitlesVerified:true,noUnrecordedCargo:true}};
const ship=(c,docked=false)=>({itemID:c.shipItemID,ownerID:c.ownerCharacterID,
 typeID:c.typeID,categoryID:6,singleton:1,stacksize:1,quantity:-1,
 locationID:docked?c.stationID:c.systemID,flagID:docked?4:0,
 spaceState:docked?null:{systemID:c.systemID,position:{x:10,y:20,z:30}}});
function setup({dir=null,noSeed=false,afterCommit=null}={}){
 const temporary=!dir;dir=dir||fs.mkdtempSync(path.join(os.tmpdir(),'pf66-'));
 const db=new DatabaseSync(path.join(dir,'original.db'));
 db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE IF NOT EXISTS rows(table_name TEXT,key TEXT,json TEXT,PRIMARY KEY(table_name,key))');
 const get=(t,k)=>{const x=db.prepare('SELECT json FROM rows WHERE table_name=? AND key=?').get(t,k);return x?JSON.parse(x.json):null;};
 const put=(t,k,v)=>db.prepare('INSERT INTO rows VALUES (?,?,?) ON CONFLICT(table_name,key) DO UPDATE SET json=excluded.json').run(t,k,JSON.stringify(v));
 const a={mode:'SERVER_INTERNAL_FLAGGED',poison:false,isPoisoned(){return a.poison;},transact(tables,fn){
  db.exec('BEGIN IMMEDIATE');try{
   const tx={get:(t,k)=>{if(!tables.includes(t))throw Error('MISSING_TABLE');return get(t,k);},
    put:(t,k,v)=>{if(!tables.includes(t)||v===null||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_NATIVE_PUT');put(t,k,v);}};
   const result=fn(tx);if(result?.then)throw Error('ASYNC_TRANSACTION');
   db.exec('COMMIT');if(afterCommit)afterCommit(result);
   return result;
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }};
 const c=structuredClone(DEFAULT);
 const state={enabled:true,writers:true,exclusive:true,ready:true,
  physical:true,stockMoves:0,sceneRemovals:0,failStock:false,failScene:false,
  nativeEntity:{entityID:c.shipItemID,personalFleetOriginal:true},
  nativeController:{entityID:c.shipItemID,personalFleetOriginal:true}};
 const originalItemStore={
  findItemById:id=>get('items','items')?.[String(id)]||null,
  dockShipToLocation(id,stationID){state.stockMoves++;
   if(state.failStock)return {success:false,errorMsg:'STOCK_WRITE_UNCERTAIN'};
   return a.transact(['items'],tx=>{const root=tx.get('items','items');
    if(root?.[id]?.flagID!==0)return {success:false};
    tx.put('items','items',{...root,[id]:ship(c,true)});return {success:true};});
  }
 };
 let authority;
 const nativeNpcService={PF66_SCOPED_DOCK_SCENE_DETACH_V1:true,
  installScopedPersonalFleetDockAuthority(p){if(authority)throw Error('ALREADY_INSTALLED');authority=p;return true;},
  detachScopedPersonalFleetDockSceneActor({row,capability}){
   if(!authority||capability!==authority.capability||authority.authorize(row)!==true)
    return {success:false,errorMsg:'UNAUTHORIZED'};
   if(authority.consumeSceneDetach(row)!==true)
    return {success:false,errorMsg:'PF66_SCENE_DURABLE_ATTEMPT_NOT_COMMITTED'};
   if(!state.physical)return {success:false,errorMsg:'ALREADY_GONE'};
   state.sceneRemovals++;
   state.physical=false;
   if(state.failScene)throw Error('SCENE_WRITE_UNKNOWN');
   return {success:true};
  },
  rawAuthorize:()=>authority,
 };
 const claimsPolicy={KEY:P+'actor-claims-v1',validate(v){
  if(!v||v.version!==1||!v.claims||!v.generations||!v.processed||
    [v.claims,v.generations,v.processed].some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('CLAIM_CORRUPT');
  const pilots=new Set();for(const [id,claim] of Object.entries(v.claims)){
   if(!Number.isSafeInteger(Number(id))||claim?.entityID!==Number(id)||
      pilots.has(claim.pilotID)||!Number.isSafeInteger(claim.generation)||
      v.generations[id]<claim.generation)throw Error('CLAIM_CORRUPT');
   pilots.add(claim.pilotID);
  }return v;}};
 const build=()=>pf.createScopedDock({gameStore:{coopAtomicNativeRows:a},originalItemStore,nativeNpcService,claimsPolicy,
  verifyOriginalDockReady:()=>state.ready,verifyExclusiveOwnership:()=>state.exclusive,
  allWritersFenced:()=>state.writers,enabled:()=>state.enabled,clock:()=>1800000000000});
 function seed(){put('corporationRuntime',P+'return-dock-v1:'+c.assignmentID,c);
  put('corporationRuntime',P+'deploy-v1:'+c.assignmentID,{phase:'ACTIVE',
   assignmentID:c.assignmentID,shipItemID:c.shipItemID,ownerCharacterID:c.ownerCharacterID,
   pilotID:c.pilotID,systemID:c.systemID,actorGeneration:c.actorGeneration,generation:c.reservationGeneration});
  put('corporationRuntime',P+'handoff-v1:'+c.assignmentID,{status:'CONSUMED',
   assignmentID:c.assignmentID,shipItemID:c.shipItemID,ownerCharacterID:c.ownerCharacterID,
   generation:c.reservationGeneration,sourcePF54Hash:'f'.repeat(64)});
  put('corporationRuntime',P+'handoff-ship-v1:'+c.shipItemID,{assignmentID:c.assignmentID,
   sourcePF54Hash:'f'.repeat(64)});
  put('corporationRuntime',P+'actor-claims-v1',{version:1,claims:{
   [c.shipItemID]:{entityID:c.shipItemID,ownerType:'PERSONAL_FLEET',ownerCharacterID:c.ownerCharacterID,
    pilotID:c.pilotID,assignmentID:c.assignmentID,generation:c.actorGeneration,
    systemID:c.systemID}},generations:{[c.shipItemID]:c.actorGeneration},processed:{}});
  put('items','items',{[c.shipItemID]:ship(c)});
 }
 if(!noSeed)seed();
 return {c,db,dir,state,a,get,put,ship,build,originalItemStore,nativeNpcService,pf,
  close(){db.close();if(temporary)fs.rmSync(dir,{recursive:true,force:true});}};
}
module.exports={setup,DEFAULT,P,ship};
