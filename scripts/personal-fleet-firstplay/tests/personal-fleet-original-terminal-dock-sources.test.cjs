'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalTerminalDockSources.js'),'utf8');
function fixture(fn){
 const c={mode:'DOCK',operationID:'return-op-123',assignmentID:'assignment-123',
  ownerCharacterID:101,pilotID:'coop-pilot-123',shipItemID:501,
  stationID:600,systemID:300,actorGeneration:2,generation:3,typeID:587};
 const manifest={source:'ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1',
  shipItemID:501,ownerCharacterID:101,cargoItemIDs:[99],
  fittingHash:'1'.repeat(64),cargoHash:'2'.repeat(64)};
 const ret={...c,phase:'DOCK_ISSUING',reservationGeneration:3,
   dockDispatchCount:1,manifest,signature:'3'.repeat(64)};
 const ship={itemID:501,typeID:587,ownerID:101,categoryID:6,
  singleton:1,stacksize:1,quantity:-1,flagID:4,locationID:600,spaceState:null};
 const sig='4'.repeat(64);
 const rows=new Map([
  ['corporationRuntime\tcoop-personal-fleet\u001freturn-dock-v1:'+c.assignmentID,ret],
  ['corporationRuntime\tcoop-personal-fleet\u001fdock-native-attempt-v1:'+c.assignmentID,
   {version:1,status:'CONSUMED',signature:sig,operationID:c.operationID,
    shipItemID:501,actorGeneration:2,reservationGeneration:3,committedAtMs:100}],
  ['corporationRuntime\tcoop-personal-fleet\u001fdock-scene-attempt-v1:'+c.assignmentID,
   {version:1,status:'CONSUMED',assignmentID:c.assignmentID,shipItemID:501,
    actorGeneration:2,reservationGeneration:3,dockAttemptSignature:sig,committedAtMs:101}],
  ['items\titems',{'501':ship}]
 ]);
 const state={enabled:true,fenced:true,exclusive:true,manifest,
  ship,entity:{entityID:501,personalFleetOriginal:true},controller:{entityID:501},
  modules:[],cargo:[],sceneEntity:null,runtimeController:null};
 const deps={
  'node:crypto':crypto,
  '../services/inventory/itemStore':{findItemById:()=>state.ship},
  './npc/nativeNpcStore':{getNativeEntity:()=>state.entity,
   getNativeController:()=>state.controller,
   listNativeModulesForEntity:()=>state.modules,listNativeCargoForEntity:()=>state.cargo},
  './npc/npcRegistry':{getControllerByEntityID:()=>state.runtimeController},
  './runtime':{scenes:new Map([[300,{systemID:300,getEntityByID:()=>state.sceneEntity}]])},
  './coopPersonalFleetReturnDock':{manifestValid:(m,r)=>m?.shipItemID===r.shipItemID},
  './coopPersonalFleetScopedDock':{valid:r=>r?.phase==='DOCK_ISSUING'&&r?.dockDispatchCount===1,
   signature:()=>sig,stockShip:(item,r,dock)=>!!item&&dock&&item.itemID===r.shipItemID&&
    item.flagID===4&&item.locationID===r.stationID&&item.ownerID===r.ownerCharacterID}
 };
 const sandbox={module:{exports:{}},require:n=>{if(!deps[n])throw Error('UNKNOWN_MODULE');return deps[n];},Object,Array,Map};
 vm.runInNewContext(source,sandbox,{filename:'coopPersonalFleetOriginalTerminalDockSources.js'});
 const owner=sandbox.module.exports.createOriginalTerminalDockSources({
  enabled:()=>state.enabled,allWritersFenced:()=>state.fenced,
  verifyExclusiveOwnership:()=>state.exclusive,
  verifyFinalOriginalManifest:()=>state.manifest});
 const tx={get:(t,k)=>rows.get(t+'\t'+k)??null};
 fn({owner,tx,rows,ret,c,state,manifest,sig,deps});
}
test('real PF66 dock receipt authenticates PF60 command and creates stable source witness',()=>fixture(f=>{
 assert.equal(f.owner.authenticateCommand(f.c,f.tx),true);
 const a=f.owner.verifyOriginalTerminalWitness(f.c,f.tx);
 assert.equal(a.source,'ORIGINAL_EVEJS_PF60_DOCK_V1');
 assert.match(a.receiptHash,/^[a-f0-9]{64}$/);
 assert.equal(a.originalShipInHangar,true);
 f.ret.phase='DOCKED';const b=f.owner.verifyOriginalTerminalWitness(f.c,f.tx);
 assert.equal(b.receiptHash,a.receiptHash);
}));
test('pre-PF61 native identity includes real persisted entity/controller and independent vacant scene',()=>fixture(f=>{
 const r=f.owner.readNativeIdentity(f.c);
 assert.equal(r.sceneAbsent,true);assert.equal(r.entity.entityID,501);
 assert.equal(r.controller.entityID,501);
 f.state.entity=null;f.state.controller=null;
 const cleared=f.owner.readNativeIdentity(f.c);
 assert.equal(cleared.entity,null);assert.equal(cleared.controller,null);
}));
const invalid=[
 ['writer fence revoked',f=>{f.state.fenced=false}],
 ['exclusive ownership revoked',f=>{f.state.exclusive=false}],
 ['PF66 dock token missing',f=>{f.rows.delete('corporationRuntime\tcoop-personal-fleet\u001fdock-native-attempt-v1:'+f.c.assignmentID)}],
 ['PF66 scene token missing',f=>{f.rows.delete('corporationRuntime\tcoop-personal-fleet\u001fdock-scene-attempt-v1:'+f.c.assignmentID)}],
 ['still returning',f=>{f.ret.phase='RETURNING'}],
 ['wrong assignment',f=>{f.ret.assignmentID='foreign'}],
 ['wrong ship item location',f=>{f.state.ship={...f.state.ship,locationID:800}}],
 ['missing original manifest',f=>{f.state.manifest=null}],
 ['changed original fitting hashes',f=>{f.state.manifest={...f.manifest,fittingHash:'f'.repeat(64)}}],
 ['live native NPC scene entity',f=>{f.state.sceneEntity={itemID:501}}],
 ['live native NPC registry controller',f=>{f.state.runtimeController={entityID:501}}],
 ['original system scene never mounted',f=>{f.deps['./runtime'].scenes.clear()}],
 ['duplicate original item ID',f=>{f.rows.get('items\titems')['888']={...f.state.ship}}],
];
for(const [name,mutate] of invalid)test('reject terminal receipt when '+name,()=>fixture(f=>{
 mutate(f);assert.equal(f.owner.authenticateCommand(f.c,f.tx),false);
 assert.equal(f.owner.verifyOriginalTerminalWitness(f.c,f.tx),null);
}));
test('no scene vacancy cannot be mistaken for cleared native identity',()=>fixture(f=>{
 f.state.sceneEntity={itemID:501};assert.equal(f.owner.verifyOriginalSceneVacant(f.c),false);
 assert.equal(f.owner.readNativeIdentity(f.c),null);
}));
test('writer flag OFF prevents terminal source materialization',()=>fixture(f=>{
 f.state.enabled=false;assert.equal(f.owner.authenticateCommand(f.c,f.tx),false);
 assert.equal(f.owner.readNativeIdentity(f.c),null);
}));
