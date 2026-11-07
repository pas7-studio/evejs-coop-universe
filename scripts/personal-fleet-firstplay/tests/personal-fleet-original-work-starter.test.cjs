'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const target=path.join(__dirname,'../native/coopPersonalFleetOriginalWorkStarter.js');
const source=fs.readFileSync(target,'utf8');
function load({flags={},config,bootstrap={},missing=false}={}){
 const events=[];
 const process={env:{EVEJS_COOP_PERSONAL_FLEET_NATIVE:'1',
  EVEJS_COOP_PERSONAL_FLEET_CHAT:'1',
  EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION:'1',
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1',...flags}};
 const m={exports:{}};
 const working={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_WORK_CONFIGURATION_V1',
  loadNativeAuthoredCatalog(){events.push('catalog');return [{npcCharacterID:12345}];},
  createNativeWriterHooks(){events.push('hooks');return {
   source:'ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1',
   verifyOriginalWriterHooks(){return true;},
   allWritersFenced(){return true;},
   allWalletWritersFenced(){return true;}};}};
 const chosen=config??working;
 const originalBoot={createOriginalWorkBootstrap(c){
  events.push('bootstrap');return bootstrap.createOriginalWorkBootstrap?
    bootstrap.createOriginalWorkBootstrap(c):
    {status:'INSTALLED_WORK_SOURCE_BOUND',mayEnable:()=>true,
     getOperationalStatus:()=>({ready:true}),stopNativeStationTick:()=>true};}};
 vm.runInNewContext(source,{require:id=>{
  if(id==='./coopPersonalFleetOriginalWorkBootstrap')return originalBoot;
  if(id==='./coopPersonalFleetOriginalWorkConfiguration'){
   if(missing){const e=Error('module missing');e.code='MODULE_NOT_FOUND';throw e;}
   return chosen;
  }throw Error('FORBIDDEN_IMPORT:'+id);
 },module:m,exports:m.exports,process,Object,Error},{filename:target,timeout:10000});
 return {starter:m.exports,events,process,config:chosen};
}
test('PF88 original WorkStarter enables once only with verified server configuration',()=>{
 const f=load();
 const result=f.starter.bootstrapOriginalWorkFromServer();
 assert.equal(result.status,'ORIGINAL_WORK_READY');
 assert.deepEqual(f.events,['catalog','hooks','bootstrap']);
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/ATTEMPTED_STICKY/);
});
test('PF88 missing original WORK configuration fails before bootstrap',()=>{
 const f=load({missing:true});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/CONFIG_NOT_INSTALLED/);
 assert.deepEqual(f.events,[]);
});
test('PF88 native disabled flag fails without reading catalog or writer hooks',()=>{
 const f=load({flags:{EVEJS_COOP_PERSONAL_FLEET_NATIVE:'0'}});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/REQUIRED_FLAGS_NOT_INSTALLED/);
 assert.deepEqual(f.events,[]);
});
test('PF88 transient isolation flag is mandatory',()=>{
 const f=load({flags:{EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION:'0'}});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/REQUIRED_FLAGS_NOT_INSTALLED/);
 assert.deepEqual(f.events,[]);
});
test('PF88 missing original writer proof aborts before publishing Personal Fleet',()=>{
 const f=load({config:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_WORK_CONFIGURATION_V1',
  loadNativeAuthoredCatalog:()=>[{npcCharacterID:12345}],
  createNativeWriterHooks:()=>({source:'ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1',
   verifyOriginalWriterHooks:()=>false,allWritersFenced:()=>true,
   allWalletWritersFenced:()=>true})}});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/WRITER_FENCES_UNVERIFIED/);
 assert.deepEqual(f.events,[]);
});
test('PF88 empty authored catalog fails before creating hooks',()=>{
 const f=load({config:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_WORK_CONFIGURATION_V1',
  loadNativeAuthoredCatalog:()=>[],createNativeWriterHooks:()=>{throw Error('SHOULD_NOT_LOAD');}}});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/CATALOG_UNAVAILABLE/);
});
test('PF88 only real original source config accepted',()=>{
 const f=load({config:{source:'CLIENT_FAKE',
  loadNativeAuthoredCatalog:()=>[],createNativeWriterHooks:()=>({})}});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/ORIGINAL_SOURCE_CONFIGURATION_REQUIRED/);
});
test('PF88 unsuccessful original native composition cannot report READY',()=>{
 const f=load({bootstrap:{createOriginalWorkBootstrap:()=>({status:'REVIEW_ONLY',
  mayEnable:()=>true,getOperationalStatus:()=>({ready:true})})}});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/BOOT_NOT_OPERATIONAL/);
 assert.deepEqual(f.events,['catalog','hooks','bootstrap']);
});
test('PF88 post-bootstrap revoked operational gate prevents false READY',()=>{
 const f=load({bootstrap:{createOriginalWorkBootstrap:()=>({status:'INSTALLED_WORK_SOURCE_BOUND',
  mayEnable:()=>false,getOperationalStatus:()=>({ready:false})})}});
 assert.throws(()=>f.starter.bootstrapOriginalWorkFromServer(),/BOOT_NOT_OPERATIONAL/);
});
