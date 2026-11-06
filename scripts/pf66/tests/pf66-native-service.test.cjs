'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../build_native_dock_scene_patch.py'),'utf8');
const code=source.match(/INSERT = '''([\s\S]*?)'''/)[1];
function setup({entity=true,controller=true,physical=true,session=false,modules=[],cargo=[],removeSucceeds=true}={}){
 const row={shipItemID:1001,ownerCharacterID:202,assignmentID:'a1',pilotID:'coop-pilot-123',
  reservationGeneration:2,systemID:300};
 const marker={entityID:row.shipItemID,systemID:row.systemID,personalFleetOriginal:true,
  personalFleetAssignmentID:row.assignmentID,personalFleetPilotID:row.pilotID,
  personalFleetGeneration:row.reservationGeneration};
 let physicalRow=physical?{itemID:row.shipItemID,nativeNpc:true,ownerID:row.ownerCharacterID,
  ...(session?{session:{characterID:row.ownerCharacterID}}:{})}:null;
 let runtimeController=controller?{entityID:1001,systemID:300}:null;
 const scene={systemID:300,getEntityByID:id=>id===1001?physicalRow:null};
 const state={removalCalls:0,unregisterCalls:0,options:null,authorized:false,authCalls:0};
 const store={getNativeEntity:()=>entity?{...marker,ownerID:row.ownerCharacterID}:null,
  getNativeController:()=>controller?{...marker}:null,
  listNativeModulesForEntity:()=>modules,
  listNativeCargoForEntity:()=>cargo};
 const runtime={scenes:new Map([[300,scene]]),removeDynamicEntity(id,ship,options){
  state.removalCalls++;state.options=options;
  if(removeSucceeds)physicalRow=null;
 }};
 const sandbox={process:{env:{EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION:'1',
  EVEJS_COOP_PERSONAL_FLEET_DOCK_SCENE_DETACH:'1'}},
  nativeNpcStore:store,spaceRuntime:runtime,
  getControllerByEntityID:()=>runtimeController,
  unregisterController:id=>{state.unregisterCalls++;runtimeController=null;}};
 vm.runInNewContext(code+'\nthis.install = installScopedPersonalFleetDockAuthority;'+
  'this.detach = detachScopedPersonalFleetDockSceneActor;',sandbox);
 const capability=Symbol('cap');
 sandbox.install({capability,authorize:c=>{state.authCalls++;return state.authorized;}});
 return {row,state,store,runtime,sandbox,capability,detach:()=>sandbox.detach({row,capability})};
}
test('PF66 actual inserted native source rejects direct scene detach before token proof',()=>{
 const f=setup();let r=f.detach();assert.equal(r.success,false);
 assert.equal(f.state.removalCalls,0);assert.equal(f.state.unregisterCalls,0);
});
test('PF66 source private capability denies foreign caller',()=>{
 const f=setup();f.state.authorized=true;
 const x=f.sandbox.detach({row:f.row,capability:Symbol('foreign')});
 assert.equal(x.success,false);assert.equal(f.state.removalCalls,0);
});
test('PF66 source removes only original runtime actor and unregisters controller',()=>{
 const f=setup();f.state.authorized=true;
 const r=f.detach();assert.equal(r.success,true,r.errorMsg);
 assert.equal(f.state.authCalls,2);assert.equal(f.state.removalCalls,1);
 assert.equal(f.state.unregisterCalls,1);
 assert.equal(f.state.options.allowSessionOwned,false);
 assert.equal(f.store.getNativeEntity().entityID,1001);
 assert.equal(f.store.getNativeController().entityID,1001);
});
test('PF66 source refuses player session, missing actor, missing runtime controller',()=>{
 for(const options of [{session:true},{physical:false},{controller:false}]){
  const f=setup(options);f.state.authorized=true;
  assert.equal(f.detach().success,false);
  assert.equal(f.state.removalCalls,0);
 }
});
test('PF66 source refuses native module and cargo rows, not discarding originals',()=>{
 for(const options of [{modules:[{moduleID:4}]},{cargo:[{cargoID:7}]},{cargo:null}]){
  const f=setup(options);f.state.authorized=true;
  assert.equal(f.detach().success,false);
  assert.equal(f.state.removalCalls,0);
 }
});
test('PF66 source refuses when feature env is OFF',()=>{
 const f=setup();f.state.authorized=true;
 f.sandbox.process.env.EVEJS_COOP_PERSONAL_FLEET_DOCK_SCENE_DETACH='0';
 assert.equal(f.detach().errorMsg,'PF66_SCENE_DETACH_OFF');
 assert.equal(f.state.removalCalls,0);
});
test('PF66 source fails closed when scene removal has no effect',()=>{
 const f=setup({removeSucceeds:false});f.state.authorized=true;
 assert.equal(f.detach().errorMsg,'PF66_SCENE_REMOVAL_OUTCOME_UNKNOWN');
 assert.equal(f.state.unregisterCalls,0);
});
test('PF66 source authority is single-owner process singleton',()=>{
 const f=setup();assert.throws(()=>f.sandbox.install({capability:Symbol('again'),authorize:()=>true}),
  /ALREADY_INSTALLED/);
});
