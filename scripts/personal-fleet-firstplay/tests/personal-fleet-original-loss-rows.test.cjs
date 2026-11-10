'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readWreckRoot,readNativeAssets}=require('../native/coopPersonalFleetOriginalLossRows');
const SEP='\u001f',SHIP=2301,WRECK=9901;
const entity=()=>({entityID:SHIP,ownerID:500,systemID:30000142});
const item=id=>({wreckItemID:id,wreckID:WRECK,originalItemID:id+50});
function tx({
 entityRow=null,entitySkeleton={},moduleSkeleton={},
 moduleRows=[{key:'modules',value:{}},{key:'nextModuleID',value:1300}],
 cargo={},wrecks={[WRECK]:{wreckID:WRECK,sourceEntityID:SHIP,systemID:30000142}},
 items={[8001]:item(8001)}
}={}){
 const rows={
  'npcEntities':{'entities':entitySkeleton,['entities'+SEP+SHIP]:entityRow},
  'npcModules':{'modules':moduleSkeleton},
  'npcCargo':{'cargo':cargo},
  'npcWrecks':{'wrecks':wrecks},
  'npcWreckItems':{'items':items}
 };
 return Object.freeze({get:(t,k)=>Object.hasOwn(rows[t]||{},k)?rows[t][k]:null,
  scan:t=>t==='npcModules'?moduleRows:[]});
}
test('PF89 original destroyed NPC + intact item-title roots',()=>{
 const f=tx(),a=readNativeAssets(f,SHIP),w=readWreckRoot(f);
 assert.equal(Object.keys(a.entityRoot.entities).length,0);
 assert.equal(Object.keys(a.cargoRoot.cargo).length,0);
 assert.equal(Object.keys(a.moduleRoot.modules).length,0);
 assert.equal(a.wreckItems.items[8001].originalItemID,8051);
 assert.equal(w.wrecks[WRECK].sourceEntityID,SHIP);
});
test('PF89 rejects live original per-entity NPC',()=>{
 const a=readNativeAssets(tx({entityRow:entity()}),SHIP);
 assert.ok(a.entityRoot.entities[SHIP]); // PF57 original loss gate rejects it
});
test('PF89 rejects incompatible legacy NPC group blob',()=>{
 assert.equal(readNativeAssets(tx({entitySkeleton:{[SHIP]:entity()}}),SHIP),null);
});
test('PF89 rejects incompatible legacy module group blob',()=>{
 assert.equal(readNativeAssets(tx({moduleSkeleton:{2200:{moduleID:2200}}}),SHIP),null);
});
test('PF89 reads real other-NPC module without confusing target custody',()=>{
 const m={moduleID:8801,entityID:2302};
 const a=readNativeAssets(tx({moduleRows:[
  {key:'modules',value:{}},{key:'nextModuleID',value:10001},
  {key:'modules'+SEP+'8801',value:m}]}),SHIP);
 assert.equal(a.moduleRoot.modules[8801].entityID,2302);
});
test('PF89 flags retained module on destroyed target',()=>{
 const a=readNativeAssets(tx({moduleRows:[
  {key:'modules',value:{}},{key:'modules'+SEP+'8802',
    value:{moduleID:8802,entityID:SHIP}}]}),SHIP);
 assert.equal(a.moduleRoot.modules[8802].entityID,SHIP);
});
test('PF89 rejects malformed module ID or key',()=>{
 assert.equal(readNativeAssets(tx({moduleRows:[
  {key:'modules',value:{}},{key:'modules'+SEP+'8802',
   value:{moduleID:8803,entityID:SHIP}}]}),SHIP),null);
 assert.equal(readNativeAssets(tx({moduleRows:[{key:'fake'+SEP+'8801',
   value:{moduleID:8801,entityID:SHIP}}]}),SHIP),null);
});
test('PF89 rejects wrong module next-ID scalar',()=>{
 assert.equal(readNativeAssets(tx({moduleRows:[
  {key:'modules',value:{}},{key:'nextModuleID',value:'bad'}]}),SHIP),null);
});
test('PF89 detects active physical cargo, not unrelated cargo',()=>{
 const a=readNativeAssets(tx({cargo:{'8832':{cargoID:8832,entityID:SHIP},
  '8833':{cargoID:8833,entityID:2302}}}),SHIP);
 assert.equal(Object.values(a.cargoRoot.cargo).filter(x=>x.entityID===SHIP).length,1);
});
test('PF89 rejects wrong cargo row ID, refuses false loss proof',()=>{
 assert.equal(readNativeAssets(tx({cargo:{'8832':{cargoID:8833,entityID:2302}}}),SHIP),null);
});
test('PF89 rejects missing module skeleton',()=>{
 assert.equal(readNativeAssets(tx({moduleSkeleton:null}),SHIP),null);
});
test('PF89 rejects malformed original wreck item title',()=>{
 assert.equal(readNativeAssets(tx({items:{'8001':{wreckItemID:8002,wreckID:WRECK}}}),SHIP),null);
});
test('PF89 rejects malformed native wreck source identity',()=>{
 assert.equal(readWreckRoot(tx({wrecks:{[WRECK]:{wreckID:WRECK,sourceEntityID:0}}})),null);
});
test('PF89 missing native SQLite read authority cannot attest loss',()=>{
 assert.equal(readNativeAssets({},SHIP),null);
 assert.equal(readWreckRoot({}),null);
});
test('PF89 original helper cannot silently modify any SQLite row',()=>{
 const f=tx(),written=[];
 const restricted={get:(...a)=>f.get(...a),scan:(...a)=>f.scan(...a),
  put:(...a)=>written.push(a)};
 readNativeAssets(restricted,SHIP);readWreckRoot(restricted);
 assert.deepEqual(written,[]);
});
test('PF89 rejects duplicate original sourceCargoID preserved in stock wrecks',()=>{
 const a=readNativeAssets(tx({items:{
  '8001':{wreckItemID:8001,wreckID:WRECK,sourceCargoID:7001},
  '8002':{wreckItemID:8002,wreckID:WRECK,sourceCargoID:7001}}}),SHIP);
 assert.equal(a,null);
});
