'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../pf58/native/coopPersonalFleetNativeBootstrap.cjs'),'utf8');
function boot({fail=null,installReturns=true}={}){
 const calls=[];
 const originalItemStore={findItemById:()=>null,moveShipToSpace:()=>({success:true})};
 const noop=()=>true;
 const options={gameStore:{},pf52:{},originalItemStore,nativeNpcStore:{},
  nativeNpcService:{PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true},spaceRuntime:{},
  resolveNativeProfile:noop,resolveOwnerCorporation:noop,
  originalStationUndockPoint:noop,originalNoActiveSession:noop,
  originalNoPhysicalActor:noop,originalEquipmentWitness:noop,
  originalOwnershipWitness:noop,independentOriginalActorWitness:noop};
 const stubs={
  './coopPersonalFleetOriginalNativePermit.cjs':{createPermitVerifier:()=>{
   calls.push('permit');if(fail==='permit')throw Error('BAD_PERMIT');
   return {verify:()=>true};}},
  './coopPersonalFleetNativeShipAdoption.cjs':{createNativeShipAdoption:()=>{
   calls.push('adoption');if(fail==='adoption')throw Error('BAD_ADOPTION');
   return {adoptOriginalShipAsNpc:()=>true};}},
  './coopPersonalFleetOriginalShipHandoff.cjs':{createOriginalShipHandoff:()=>{
   calls.push('handoff');if(fail==='handoff')throw Error('BAD_HANDOFF');
   return {execute:()=>true,inspect:()=>true};}},
  './coopPersonalFleetNativeBindings.cjs':{install:()=>{
   calls.push('install');if(fail==='install')throw Error('BAD_INSTALL');
   return installReturns;}}
 };
 const sandbox={module:{exports:{}},require:k=>{
  if(!(k in stubs))throw Error('UNEXPECTED_REQUIRE:'+k);return stubs[k];}};
 vm.runInNewContext(source,sandbox,{filename:'coopPersonalFleetNativeBootstrap.cjs'});
 const api=sandbox.module.exports.createNativeBootstrap;
 return {calls,run:()=>api(options)};
}
test('PF64 failed permit construction never installs singleton bindings',()=>{
 const f=boot({fail:'permit'});assert.throws(f.run,/BAD_PERMIT/);
 assert.deepEqual(f.calls,['permit']);
});
test('PF64 failed adoption construction never installs singleton bindings',()=>{
 const f=boot({fail:'adoption'});assert.throws(f.run,/BAD_ADOPTION/);
 assert.deepEqual(f.calls,['permit','adoption']);
});
test('PF64 failed handoff construction never installs singleton bindings',()=>{
 const f=boot({fail:'handoff'});assert.throws(f.run,/BAD_HANDOFF/);
 assert.deepEqual(f.calls,['permit','adoption','handoff']);
});
test('PF64 valid bootstrap installs exactly once and only LAST',()=>{
 const f=boot();const result=f.run();
 assert.deepEqual(f.calls,['permit','adoption','handoff','install']);
 assert.equal(typeof result.executeOriginalHandoff,'function');
 assert.equal(typeof result.verifyNativePermit,'function');
 assert.equal(Object.isFrozen(result),true);
});
test('PF64 unconfirmed binding installation must refuse bootstrap',()=>{
 const f=boot({installReturns:false});assert.throws(f.run,/PF64_BINDING_INSTALL_UNCONFIRMED/);
 assert.deepEqual(f.calls,['permit','adoption','handoff','install']);
});
