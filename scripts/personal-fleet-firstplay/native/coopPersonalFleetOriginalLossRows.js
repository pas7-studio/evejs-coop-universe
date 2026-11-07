'use strict';
/**
 * PF89: read actual original EveJS NPC SQLite row shapes for PF57 loss.
 * This module constructs READ-ONLY aggregates only for legacy PF57's
 * validation algorithm. It never writes an entity, wreck or asset; source
 * is the original tx.get/tx.scan from the same BEGIN IMMEDIATE transaction.
 */
const SEP='\u001f',pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function readWreckRoot(tx){
 if(typeof tx?.get!=='function')return null;
 const wrecks=tx.get('npcWrecks','wrecks');
 if(!obj(wrecks)||Object.keys(wrecks).length>100000)return null;
 for(const [id,w] of Object.entries(wrecks)){
  if(!/^[1-9][0-9]*$/.test(id)||!pos(Number(id))||
     !obj(w)||w.wreckID!==Number(id)||!pos(w.sourceEntityID))
   return null;
 }
 return {wrecks};
}
function readNativeAssets(tx,shipItemID){
 if(!pos(shipItemID)||typeof tx?.get!=='function'||typeof tx?.scan!=='function')
  return null;
 const entitySkeleton=tx.get('npcEntities','entities'),
  moduleSkeleton=tx.get('npcModules','modules'),
  entity=tx.get('npcEntities','entities'+SEP+shipItemID),
  cargo=tx.get('npcCargo','cargo'),items=tx.get('npcWreckItems','items'),
  rows=tx.scan('npcModules');
 // The stock group skeletons are {} and the real records are keyed per
 // entity/module. A legacy whole-group blob is NEVER accepted as evidence.
 if(!obj(entitySkeleton)||Object.keys(entitySkeleton).length!==0||
    !obj(moduleSkeleton)||Object.keys(moduleSkeleton).length!==0||
    !obj(cargo)||!obj(items)||!Array.isArray(rows)||
    rows.length>100000||Object.keys(cargo).length>100000||
    Object.keys(items).length>100000)return null;
 const modules={};
 for(const row of rows){
  if(!obj(row)||typeof row.key!=='string')return null;
  if(row.key==='modules'){
   if(!obj(row.value)||Object.keys(row.value).length!==0)return null;
   continue;
  }
  if(row.key==='nextModuleID'){
   if(!pos(row.value))return null;
   continue;
  }
  const match=/^modules\u001f([1-9][0-9]*)$/.exec(row.key);
  if(!match||!pos(Number(match[1]))||!obj(row.value)||
     row.value.moduleID!==Number(match[1])||!pos(row.value.entityID)||
     own(modules,match[1]))return null;
  modules[match[1]]=row.value;
 }
 for(const [id,asset] of Object.entries(cargo)){
  if(!/^[1-9][0-9]*$/.test(id)||!pos(Number(id))||
     !obj(asset)||asset.cargoID!==Number(id)||!pos(asset.entityID))
   return null;
 }
 const uniqueOriginalTitles=new Set();
 for(const [id,asset] of Object.entries(items)){
  if(!/^[1-9][0-9]*$/.test(id)||!pos(Number(id))||
     !obj(asset)||asset.wreckItemID!==Number(id)||!pos(asset.wreckID))
   return null;
  // The stock wreck writer can preserve sourceCargoID (not sourceItemID).
  // A destroyed title cannot appear twice in any original native wreck.
  const origin=asset.originalItemID??asset.sourceItemID??asset.sourceCargoID;
  if(origin!==undefined&&origin!==null){
   if(!pos(origin)||uniqueOriginalTitles.has(origin))return null;
   uniqueOriginalTitles.add(origin);
  }
 }
 if(entity!==null&&(!obj(entity)||entity.entityID!==shipItemID))
  return null;
 return Object.freeze({entityRoot:{entities:entity===null?{}:{[shipItemID]:entity}},
  cargoRoot:{cargo},moduleRoot:{modules},wreckItems:{items}});
}
module.exports=Object.freeze({readWreckRoot,readNativeAssets});
