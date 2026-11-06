'use strict';
/**
 * PF85: execute ORIGINAL, source-pinned EveJS npcRuntime.js in a hermetic VM.
 * This checks real exported command adapters and argument propagation against
 * contract doubles for spaceRuntime/npcService. No engine writes, server boot,
 * network, ItemStore, gameplay receipts, or fake native success declarations.
 * Run manually: PF85_NATIVE_WORKTREE=<clean native fork> node --test <this file>
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');

const input=process.env.PF85_NATIVE_WORKTREE;
if(!input||!path.isAbsolute(input))
 throw Error('PF85_ABSOLUTE_NATIVE_WORKTREE_REQUIRED');
const root=fs.realpathSync(input);
if(root.split(/[\\/]+/).some(p=>['play','prod','production','deploy','deployment'].includes(p.toLowerCase())))
 throw Error('PF85_PLAY_OR_PROD_FORBIDDEN');
const relative='Code/server/src/space/npc/npcRuntime.js';
const file=path.join(root,relative);
const actual=fs.realpathSync(file);
if(!actual.startsWith(root+path.sep)||!fs.statSync(actual).isFile())
 throw Error('PF85_NATIVE_RUNTIME_OUTSIDE_WORKTREE');
const bytes=fs.readFileSync(actual);
const hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const EXPECTED_BLOB='8ee3d4f82db1600094df8de1060a9aa8e575af1a';
if(hash!==EXPECTED_BLOB)
 throw Error('PF85_ORIGINAL_NPC_RUNTIME_SOURCE_DRIFT '+hash);
const source=bytes.toString('utf8');
const ID=2001, TARGET=2002, SYSTEM=30000142;

function originalRuntime({
 followOK=true,stopOK=true,withController=true,withEntity=true,withTarget=true,
 nativeWarpOK=true,manualOK=true
}={}){
 const calls={follow:[],stop:[],manual:[],warp:[],wake:[],schedule:[]};
 const controller={entityID:ID,systemID:SYSTEM,runtimeKind:'nativeAmbient',
  currentTargetID:0,manualOrder:null};
 const actor={kind:'ship',itemID:ID,position:{x:100,y:0,z:0},mode:'STOP'};
 const target={kind:'ship',itemID:TARGET,position:{x:20000,y:300,z:400}};
 const scene={
  getCurrentSimTimeMs:()=>10000,
  getEntityByID:id=>id===ID&&withEntity?actor:
    id===TARGET&&withTarget?target:null
 };
 const runtime={
  ensureScene:systemID=>systemID===SYSTEM?scene:null,
  followDynamicEntity:(systemID,entityID,targetID,range,opts)=>{
   calls.follow.push({systemID,entityID,targetID,range,opts});return followOK;},
  stopDynamicEntity:(systemID,entityID,opts)=>{
   calls.stop.push({systemID,entityID,opts});return stopOK;},
  startSessionlessWarpIngress:(systemID,entityID,point,opts)=>{
   calls.warp.push({systemID,entityID,point,opts});
   return nativeWarpOK?{success:true,data:{entity:actor,ingressCompleteAtMs:12500}}:
    {success:false,errorMsg:'NATIVE_WARP_FAILED'};
  }
 };
 const service={
  getControllerByEntityID:id=>id===ID&&withController?controller:null,
  issueManualOrder:(id,order)=>{
   calls.manual.push({id,order});
   if(!manualOK)return {success:false,errorMsg:'NATIVE_MANUAL_ORDER_REJECTED'};
   controller.manualOrder=order;
   if(order.type==='stop')controller.currentTargetID=0;
   if(order.type==='attack'){
    controller.currentTargetID=order.targetID;
    controller.runtimeKind='nativeCombat';
   }
   return {success:true,data:controller};
  },
  wakeNpcController:(id,whenMs)=>{calls.wake.push({id,whenMs});return {success:true};},
  scheduleNpcController:(id,whenMs)=>{calls.schedule.push({id,whenMs});return {success:true};}
 };
 const sourceDir=path.dirname(actual);
 const dependencies=new Map([
  [path.normalize(path.join(sourceDir,'../runtime')),runtime],
  [path.normalize(path.join(sourceDir,'./npcService')),service],
  [path.normalize(path.join(sourceDir,'./npcWarpOrigins')),{ONE_AU_IN_METERS:149597870700,
   findSafeWarpOriginAnchor:()=>{throw Error('PF85_UNEXPECTED_WARP_ANCHOR');}}]
 ]);
 const module={exports:{}};
 const guardedRequire=name=>{
  if(name==='path')return path;
  const found=dependencies.get(path.normalize(name));
  if(!found)throw Error('PF85_UNDECLARED_NATIVE_REQUIRE '+String(name));
  return found;
 };
 const context=vm.createContext({module,exports:module.exports,require:guardedRequire,
  __dirname:sourceDir,__filename:actual});
 new vm.Script(source,{filename:actual}).runInContext(context,{timeout:4000});
 return {api:module.exports,calls,controller,actor,target};
}

test('PF85 original source SHA and native API surface are exact',()=>{
 const f=originalRuntime();
 for(const fn of ['resolveNpcContext','follow','stop','issueAttackOrder',
                    'warpToPoint','warpToEntity'])
  assert.equal(typeof f.api[fn],'function',fn);
 assert.equal(hash,EXPECTED_BLOB);
});
test('PF85 original FOLLOW uses physics and does not wake a combat controller',()=>{
 const f=originalRuntime();
 const r=f.api.follow(ID,TARGET,1500,{wakeController:false,allowWeapons:false});
 assert.equal(r.success,true);
 assert.equal(f.calls.follow.length,1);
 assert.equal(f.calls.follow[0].targetID,TARGET);
 assert.equal(f.calls.follow[0].range,1500);
 assert.equal(f.calls.follow[0].opts.wakeController,false);
 assert.equal(f.calls.follow[0].opts.allowWeapons,false);
 assert.equal(f.calls.manual.length,0);
 assert.equal(f.calls.wake.length,0);
});
test('PF85 original ATTACK forwards target and prohibits pod kill',()=>{
 const f=originalRuntime();
 const r=f.api.issueAttackOrder(ID,TARGET,{allowWeapons:true,keepLock:true,allowPodKill:false});
 assert.equal(r.success,true);
 assert.equal(f.calls.manual.length,1);
 const o=f.calls.manual[0].order;
 assert.equal(o.type,'attack');
 assert.equal(o.targetID,TARGET);
 assert.equal(o.allowWeapons,true);
 assert.equal(o.keepLock,true);
 assert.equal(o.allowPodKill,false);
});
test('PF85 original STOP prevents warp abort and issues a native manual stop',()=>{
 const f=originalRuntime();
 f.controller.currentTargetID=TARGET;
 const r=f.api.stop(ID,{reason:'pf83-return-base',allowSessionlessWarpAbort:false,
  issueStopOrder:true});
 assert.equal(r.success,true);
 assert.equal(f.calls.stop.length,1);
 assert.equal(f.calls.stop[0].opts.allowSessionlessWarpAbort,false);
 assert.equal(f.calls.manual.length,1);
 assert.equal(f.calls.manual[0].order.type,'stop');
 assert.equal(f.controller.currentTargetID,0);
});
test('PF85 original WARP_ENTITY resolves the real target position, not a synthetic target',()=>{
 const f=originalRuntime();
 const r=f.api.warpToEntity(ID,TARGET,{forceImmediateStart:true,
  broadcastWarpStartToVisibleSessions:true});
 assert.equal(r.success,true);
 assert.equal(f.calls.warp.length,1);
 const w=f.calls.warp[0];
 assert.equal(w.entityID,ID);
 assert.equal(w.point.x,f.target.position.x);
 assert.equal(w.point.y,f.target.position.y);
 assert.equal(w.point.z,f.target.position.z);
 assert.equal(w.opts.targetEntityID,TARGET);
 assert.equal(w.opts.forceImmediateStart,true);
 assert.equal(w.opts.broadcastWarpStartToVisibleSessions,true);
 assert.equal(f.calls.schedule.length,1);
});
test('PF85 original WARP_POINT accepts canonical PF83 return coordinates',()=>{
 const f=originalRuntime();
 const r=f.api.warpToPoint(ID,{x:1950,y:0,z:0},{forceImmediateStart:true,
  broadcastWarpStartToVisibleSessions:true});
 assert.equal(r.success,true);
 assert.equal(f.calls.warp.length,1);
 assert.equal(f.calls.warp[0].point.x,1950);
 assert.equal(f.calls.warp[0].point.y,0);
 assert.equal(f.calls.warp[0].opts.forceImmediateStart,true);
});
test('PF85 missing original actor or controller never executes physics',()=>{
 for(const opts of [{withController:false},{withEntity:false}]){
  const f=originalRuntime(opts);
  assert.equal(f.api.follow(ID,TARGET,1500,{wakeController:false}).success,false);
  assert.equal(f.calls.follow.length,0);
  assert.equal(f.api.stop(ID,{issueStopOrder:true}).success,false);
  assert.equal(f.calls.stop.length,0);
  assert.equal(f.api.warpToPoint(ID,{x:1000,y:0,z:0}).success,false);
  assert.equal(f.calls.warp.length,0);
 }
});
test('PF85 original failure is not elevated to success',()=>{
 const a=originalRuntime({followOK:false});
 assert.equal(a.api.follow(ID,TARGET,1500,{wakeController:false}).success,false);
 const b=originalRuntime({stopOK:false});
 assert.equal(b.api.stop(ID,{issueStopOrder:true}).success,false);
 assert.equal(b.calls.manual.length,0,'stop failure cannot issue a manual order');
 const c=originalRuntime({nativeWarpOK:false});
 assert.equal(c.api.warpToPoint(ID,{x:2000,y:0,z:0}).success,false);
 assert.equal(c.calls.schedule.length,0,'failed warp cannot schedule wake');
 const d=originalRuntime({manualOK:false});
 assert.equal(d.api.stop(ID,{issueStopOrder:true}).success,false);
});
