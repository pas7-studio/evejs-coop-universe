'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalDockCompletionWitness.js'),'utf8');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const H='f'.repeat(64);
function fixture(fn) {
  const row={version:1,phase:'DOCK_ISSUING',dockDispatchCount:1,
    operationID:'op-123',assignmentID:'assignment-123',pilotID:'coop-pilot-123',
    shipItemID:50001,ownerCharacterID:40001,stationID:60001,systemID:30001,
    actorGeneration:2,reservationGeneration:3,typeID:587,signature:H,
    manifest:{source:'ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1',
      shipItemID:50001,ownerCharacterID:40001,assignmentID:'assignment-123',
      actorGeneration:2,cargoItemIDs:[111,222],fittingHash:H,cargoHash:H,
      originalItemTitlesVerified:true,noUnrecordedCargo:true}};
  const stock={itemID:row.shipItemID,ownerID:row.ownerCharacterID,
    typeID:row.typeID,categoryID:6,singleton:1,stacksize:1,quantity:-1,
    flagID:4,locationID:row.stationID,spaceState:null};
  const cmd={mode:'DOCK',operationID:row.operationID,assignmentID:row.assignmentID,
    pilotID:row.pilotID,shipItemID:row.shipItemID,ownerCharacterID:row.ownerCharacterID,
    systemID:row.systemID,generation:row.reservationGeneration,
    actorGeneration:row.actorGeneration,typeID:row.typeID,stationID:row.stationID};
  const sig=()=>hash(['dock',row.assignmentID,row.operationID,row.shipItemID,row.actorGeneration]);
  const terminalSig=()=>hash(['terminal',row.assignmentID,row.operationID]);
  const terminal={version:1,phase:'NATIVE_CLEARED',dispatchCount:1,
    signature:terminalSig(),mode:'DOCK',operationID:row.operationID,
    assignmentID:row.assignmentID,pilotID:row.pilotID,
    shipItemID:row.shipItemID,ownerCharacterID:row.ownerCharacterID,
    systemID:row.systemID,actorGeneration:row.actorGeneration,
    generation:row.reservationGeneration,typeID:row.typeID,
    stationID:row.stationID,witnessHash:H};
  const cleanupSig=()=>hash(['cleanup',cmd,terminal.witnessHash]);
  const prefix='coop-personal-fleet\u001f';
  const key=name=>prefix+name+':'+row.assignmentID;
  const rows=new Map([
    ['corporationRuntime\t'+key('dock-native-attempt-v1'),{version:1,status:'CONSUMED',
      signature:sig(),assignmentID:row.assignmentID,operationID:row.operationID,
      shipItemID:row.shipItemID,actorGeneration:row.actorGeneration,
      reservationGeneration:row.reservationGeneration,committedAtMs:123456}],
    ['corporationRuntime\t'+key('dock-scene-attempt-v1'),{version:1,status:'CONSUMED',
      assignmentID:row.assignmentID,shipItemID:row.shipItemID,
      actorGeneration:row.actorGeneration,reservationGeneration:row.reservationGeneration,
      dockAttemptSignature:sig(),committedAtMs:123457}],
    ['corporationRuntime\t'+key('terminal-v1'),terminal],
    ['corporationRuntime\t'+key('terminal-native-attempt-v1'),{version:1,status:'CONSUMED',
      signature:cleanupSig(),assignmentID:row.assignmentID,operationID:row.operationID,
      shipItemID:row.shipItemID,actorGeneration:row.actorGeneration,
      generation:row.reservationGeneration,consumedAtMs:123458}],
    ['corporationRuntime\t'+key('return-dock-v1'),{phase:'DOCK_ISSUING',signature:row.signature,
      operationID:row.operationID,shipItemID:row.shipItemID,
      actorGeneration:row.actorGeneration,stationID:row.stationID}],
    ['items\titems',{[row.shipItemID]:stock}],
  ]);
  const state={enabled:true,fenced:true,servicePatch:true,storePatch:true,
    stock, nativeEntity:null,nativeController:null,runtimeController:null,
    modules:[],cargo:[], sceneEntity:null,
    duplicateScene:false, manifest:row.manifest, manifestCalls:0};
  const scene=()=>({systemID:row.systemID,getEntityByID:()=>state.sceneEntity});
  const scene2=()=>({getEntityByID:()=>state.duplicateScene?{itemID:50001}:null});
  const originals={
    '../services/inventory/itemStore':{findItemById:()=>state.stock},
    './npc/nativeNpcStore':{
      PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:true,
      getNativeEntity:()=>state.nativeEntity,
      getNativeController:()=>state.nativeController,
      listNativeModulesForEntity:()=>state.modules,
      listNativeCargoForEntity:()=>state.cargo
    },
    './npc/nativeNpcService':{PF66_SCOPED_DOCK_SCENE_DETACH_V1:true},
    './npc/npcRegistry':{getControllerByEntityID:()=>state.runtimeController},
    './runtime':{scenes:new Map([[row.systemID,scene()],['other',scene2()]])},
    './coopPersonalFleetScopedDock':{
      valid:r=>r?.phase==='DOCK_ISSUING'&&r?.dockDispatchCount===1,
      signature:sig,attemptKey:a=>prefix+'dock-native-attempt-v1:'+a,
      sceneAttemptKey:a=>prefix+'dock-scene-attempt-v1:'+a,
      stockShip:(item,r,docked)=>Boolean(item&&docked&&item.itemID===r.shipItemID&&
        item.ownerID===r.ownerCharacterID&&item.typeID===r.typeID&&
        item.locationID===r.stationID&&item.flagID===4&&item.spaceState==null)
    },
    './coopPersonalFleetTerminalCustody':{
      terminalKey:a=>prefix+'terminal-v1:'+a,terminalSignature:terminalSig
    },
    './coopPersonalFleetScopedNativeCleanup':{
      attemptKey:a=>prefix+'terminal-native-attempt-v1:'+a,
      attemptSignature:cleanupSig
    },
    './coopPersonalFleetReturnDock':{
      manifestValid:(m,r)=>m?.source==='ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1'&&
        m?.shipItemID===r.shipItemID&&m?.cargoItemIDs?.length===2
    }
  };
  const sandbox={module:{exports:{}},exports:{},require:id=>{
    if(!Object.prototype.hasOwnProperty.call(originals,id))throw Error('UNEXPECTED_IMPORT:'+id);
    return originals[id];
  },Object,Array,String,Number,Boolean,RegExp,Map};
  vm.runInNewContext(source,sandbox,{filename:'coopPersonalFleetOriginalDockCompletionWitness.js'});
  const build=(extras={})=>sandbox.module.exports.createOriginalDockCompletionWitness({
    enabled:()=>state.enabled,allWritersFenced:()=>state.fenced,
    verifyFinalOriginalManifest:()=>{state.manifestCalls++;return state.manifest;},...extras});
  const tx={get:(table,id)=>rows.get(table+'\t'+id)??null};
  const verify=()=>build().verifyOriginalDockReceipt(row,tx);
  return fn({row,rows,state,tx,verify,build,key,originals});
}
test('a real PF66+PF60/61 docked item produces exact PF56 receipt',()=>fixture(f=>{
  const proof=f.verify();
  assert.equal(proof.source,'ORIGINAL_EVEJS_DOCK_COMPLETION_V1');
  assert.equal(proof.shipItemID,50001);
  for(const key of ['originalItemStoreCommitted','nativeEntityAbsent','nativeControllerAbsent',
   'noOtherLivePhysicalEntity','cargoAndFittingTitlesPreserved','sessionlessNativeDockReceiptPersisted'])
    assert.equal(proof[key],true);
  assert.equal(f.state.manifestCalls,1);
}));
const negative=[
 ['disabled',f=>{f.state.enabled=false}],
 ['fence revoked',f=>{f.state.fenced=false}],
 ['dock token missing',f=>{f.rows.delete('corporationRuntime\t'+f.key('dock-native-attempt-v1'))}],
 ['dock attempt signature altered',f=>{f.rows.get('corporationRuntime\t'+f.key('dock-native-attempt-v1')).signature=H}],
 ['dock attempt not consumed',f=>{f.rows.get('corporationRuntime\t'+f.key('dock-native-attempt-v1')).status='PENDING'}],
 ['dock attempt generation changed',f=>{f.rows.get('corporationRuntime\t'+f.key('dock-native-attempt-v1')).actorGeneration=19}],
 ['dock scene attempt missing',f=>{f.rows.delete('corporationRuntime\t'+f.key('dock-scene-attempt-v1'))}],
 ['dock scene attempt mismatched',f=>{f.rows.get('corporationRuntime\t'+f.key('dock-scene-attempt-v1')).dockAttemptSignature=H}],
 ['dock scene attempt generation swapped',f=>{f.rows.get('corporationRuntime\t'+f.key('dock-scene-attempt-v1')).reservationGeneration=4}],
 ['terminal prepare is not enough',f=>{f.rows.get('corporationRuntime\t'+f.key('terminal-v1')).phase='PREPARED'}],
 ['terminal issuing is not enough',f=>{f.rows.get('corporationRuntime\t'+f.key('terminal-v1')).phase='ISSUING'}],
 ['terminal foreign signature',f=>{f.rows.get('corporationRuntime\t'+f.key('terminal-v1')).signature=H}],
 ['terminal generation change',f=>{f.rows.get('corporationRuntime\t'+f.key('terminal-v1')).generation=4}],
 ['native cleanup attempt absent',f=>{f.rows.delete('corporationRuntime\t'+f.key('terminal-native-attempt-v1'))}],
 ['native cleanup signature forged',f=>{f.rows.get('corporationRuntime\t'+f.key('terminal-native-attempt-v1')).signature=H}],
 ['original return intent missing',f=>{f.rows.delete('corporationRuntime\t'+f.key('return-dock-v1'))}],
 ['original return not dock issuing',f=>{f.rows.get('corporationRuntime\t'+f.key('return-dock-v1')).phase='RETURNING'}],
 ['original return signature changed',f=>{f.rows.get('corporationRuntime\t'+f.key('return-dock-v1')).signature='0'.repeat(64)}],
 ['original item owner changed',f=>{f.state.stock={...f.state.stock,ownerID:0}}],
 ['original item no longer in hangar',f=>{f.state.stock={...f.state.stock,flagID:0}}],
 ['SQLite item row mismatches',f=>{f.rows.get('items\titems')[50001].ownerID=5}],
 ['original NPC entity remains',f=>{f.state.nativeEntity={entityID:50001}}],
 ['original NPC controller remains',f=>{f.state.nativeController={entityID:50001}}],
 ['original runtime controller remains',f=>{f.state.runtimeController={entityID:50001}}],
 ['native modules remain',f=>{f.state.modules=[{moduleID:1001}]}],
 ['native cargo remains',f=>{f.state.cargo=[{cargoID:1001}]}],
 ['physical actor still in scene',f=>{f.state.sceneEntity={itemID:50001}}],
 ['duplicate physical actor another scene',f=>{f.state.duplicateScene=true}],
 ['original system scene unmounted',f=>{f.originals['./runtime'].scenes.delete(f.row.systemID)}],
 ['fitting/cargo manifest changed',f=>{f.state.manifest={...f.state.manifest,cargoItemIDs:[111,999]}}],
 ['unknown item root',f=>{f.rows.delete('items\titems')}],
];
for(const [name,edit] of negative)test('fails closed: '+name,()=>fixture(f=>{
  edit(f);assert.equal(f.verify(),null);
}));
test('requires independent final original manifest provider',()=>fixture(f=>{
  assert.throws(()=>f.build({verifyFinalOriginalManifest:null}),/ORIGINAL_NATIVE_SOURCES_MISSING/);
}));
test('malformed and missing transaction never count as success',()=>fixture(f=>{
  const witness=f.build();
  assert.equal(witness.verifyOriginalDockReceipt(f.row,{}),null);
  assert.equal(witness.verifyOriginalDockReceipt({},f.tx),null);
}));
test('native service without scoped scene detach patch refuses',()=>fixture(f=>{
  f.originals['./npc/nativeNpcService'].PF66_SCOPED_DOCK_SCENE_DETACH_V1=false;
  assert.equal(f.verify(),null);
}));
test('native store without scoped cleanup patch refuses',()=>fixture(f=>{
  f.originals['./npc/nativeNpcStore'].PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1=false;
  assert.equal(f.verify(),null);
}));
