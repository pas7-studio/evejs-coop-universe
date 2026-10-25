import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFence}=require('../integration/coopWormholeJumpFence.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const originalEnv=process.env.EVEJS_COOP_WORMHOLE_JUMP_FENCE;
function fixture({mass=90,shipMass=40,expires=2_000_000,failTransition=false,
 flushSuccess=true,failCommit=false,wrongExit=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wormhole23-'));
 let now=1_000_000;
 const pair={pairID:7,state:'active',remainingMass:mass,totalMass:90,expiresAtMs:expires,
  maxJumpMass:100,source:{endpointID:501,systemID:30000101},
  destination:{endpointID:502,systemID:31000001}};
 const state={pairsByID:{'7':pair},polarizationByCharacter:{}};
 const scenes=new Map();const transitions=[];
 const source={systemID:30000101,getEntityByID:id=>id===501?{itemID:501,kind:'wormhole',position:{x:0,y:0,z:0},radius:1000}:null,
  getShipEntityForSession:session=>({kind:'ship',itemID:session._space.shipID,position:{x:1000,y:0,z:0}})};
 const destination={systemID:31000001,getShipEntityForSession:session=>({kind:'ship',itemID:session._space.shipID})};
 scenes.set(30000101,source);scenes.set(31000001,destination);
 const wormholeRuntime={
  prepareJump(endpointID,characterID,massArg,at){
   if(endpointID!==501||pair.state!=='active'||pair.expiresAtMs<=at)return {success:false,errorMsg:'WORMHOLE_COLLAPSED'};
   if(massArg>pair.maxJumpMass)return {success:false,errorMsg:'SHIP_TOO_MASSIVE'};
   if(state.polarizationByCharacter[characterID]?.[endpointID]?.endAtMs>at)return {success:false,errorMsg:'WORMHOLE_POLARIZED'};
   return {success:true,data:{pairID:7,role:'source',pair:clone(pair),destinationSystemID:31000001,destinationEndpointID:502}};
  },
  commitJump(endpointID,characterID,massArg,at){
   if(failCommit)return {success:false};
   if(pair.state!=='active')return {success:false};
   pair.remainingMass=Math.max(0,pair.remainingMass-massArg);
   if(!pair.remainingMass)pair.state='collapsed';
   (state.polarizationByCharacter[characterID]??={})[endpointID]={endAtMs:at+300000,durationSeconds:300};
   return {success:true};
  },
  buildJumpSpawnState(p,role){return {anchorType:'wormhole',anchorID:wrongExit?900:p.destination.endpointID,position:{x:3000,y:2000,z:0}}},
  syncSceneEntities(){},
 };
 const world={getSceneForSession:session=>scenes.get(session._space.systemID)};
 const deps={wormholeRuntime,wormholeRuntimeState:{getStateSnapshot:()=>clone(state)},
  gameStore:{flushTableSync:()=>({success:flushSuccess})},spaceRuntime:world,
  getActiveShipRecord:c=>({itemID:c===101?1001:1002}),buildShipResourceState:()=>({mass:shipMass}),
  jumpSessionToSolarSystem:(session,systemID,opts)=>{
   transitions.push({systemID,opts});
   if(failTransition)return {success:false};
   session._space.systemID=systemID;return {success:true};
  },syncSessionSystemWideEffectsForSystem:()=>{},notifyWormholeJumpCancel:()=>{}};
 const fence=createFence({root,clock:()=>now});
 const session=id=>({characterID:id,_space:{shipID:id===101?1001:1002,systemID:30000101},
  _wormholeJumpPending:{endpointID:501,queuedAtMs:now-1500}});
 const perform=s=>{
  const initial=wormholeRuntime.prepareJump(501,s.characterID,shipMass,now);
  return fence.complete({...deps,session:s,sourceScene:source,sourceEndpointID:501,
   shipMass,prepareResult:initial});
 };
 return {root,fence,deps,state,source,perform,session,transitions,
  advance(ms){now+=ms},cleanup(){fs.rmSync(root,{recursive:true,force:true})}};
}

test('two independent players cross the SAME native pair; exact mass debit, same hull IDs',()=>{
 const x=fixture({mass:90,shipMass:40});try{
  const a=x.session(101),b=x.session(202);
  assert.equal(x.perform(a).status,'ARRIVED');
  assert.equal(x.state.pairsByID['7'].remainingMass,50);
  assert.equal(x.perform(b).status,'ARRIVED');
  assert.equal(x.state.pairsByID['7'].remainingMass,10);
  assert.equal(x.transitions.length,2);
  assert.deepEqual(x.transitions.map(t=>t.opts.spawnStateOverride.anchorID),[502,502]);
  assert.equal(a._space.shipID,1001);assert.equal(b._space.shipID,1002);
  assert.equal(x.fence.pendingFor(101).blocked,false);
  assert.equal(x.fence.pendingFor(202).blocked,false);
 }finally{x.cleanup()}
});
test('second jump cannot pass after first collapses remaining mass',()=>{
 const x=fixture({mass:60,shipMass:40});try{
  assert.equal(x.perform(x.session(101)).status,'ARRIVED');
  assert.equal(x.perform(x.session(202)).status,'ARRIVED');
  assert.equal(x.state.pairsByID['7'].state,'collapsed');
  assert.equal(x.perform(x.session(101)).status,'BLOCKED');
  assert.equal(x.transitions.length,2);
 }finally{x.cleanup()}
});
test('native mass commit failure blocks physical jump and quarantines durable receipt',()=>{
 const x=fixture({failCommit:true});try{
  let s=x.session(101),r=x.perform(s);
  assert.equal(r.status,'NEEDS_OPERATOR_REPAIR');assert.equal(x.transitions.length,0);
  assert.equal(x.fence.pendingFor(101).reason,'WORMHOLE_PENDING_OPERATOR_REPAIR');
  assert.equal(createFence({root:x.root}).pendingFor(101).blocked,true);
 }finally{x.cleanup()}
});
test('flush failure blocks wormhole jump rather than granting free passage',()=>{
 const x=fixture({flushSuccess:false});try{
  const r=x.perform(x.session(101));assert.equal(r.status,'NEEDS_OPERATOR_REPAIR');
  assert.equal(x.transitions.length,0);assert.equal(x.state.pairsByID['7'].remainingMass,50);
 }finally{x.cleanup()}
});
test('transition failure leaves mass debited and durable operator-repair fence across restart',()=>{
 const x=fixture({failTransition:true});try{
  const r=x.perform(x.session(101));assert.equal(r.reason,'WORMHOLE_PHYSICAL_TRANSITION_UNCONFIRMED');
  assert.equal(x.transitions.length,1);assert.equal(x.state.pairsByID['7'].remainingMass,50);
  assert.equal(createFence({root:x.root}).pendingFor(101).reason,'WORMHOLE_PENDING_OPERATOR_REPAIR');
 }finally{x.cleanup()}
});
test('expired wormhole rejects without transition or mass mutation',()=>{
 const x=fixture({expires:999999});try{
  assert.equal(x.perform(x.session(101)).status,'BLOCKED');
  assert.equal(x.transitions.length,0);assert.equal(x.state.pairsByID['7'].remainingMass,90);
 }finally{x.cleanup()}
});
test('forged destination exit anchor rejects, debited receipt remains quarantined',()=>{
 const x=fixture({wrongExit:true});try{
  const r=x.perform(x.session(101));assert.equal(r.status,'NEEDS_OPERATOR_REPAIR');
  assert.equal(x.transitions.length,0);
 }finally{x.cleanup()}
});
test('wrong source ship cannot cross and cannot debit mass',()=>{
 const x=fixture();try{
  const s=x.session(101);s._space.shipID=9999;
  assert.equal(x.perform(s).status,'BLOCKED');
  assert.equal(x.state.pairsByID['7'].remainingMass,90);
 }finally{x.cleanup()}
});
test('corrupt unresolved journal denies further attempts after restart',()=>{
 const x=fixture();try{
  fs.writeFileSync(path.join(x.root,'wh23-101-7-100.json'),'not-json');
  assert.equal(createFence({root:x.root}).pendingFor(101).reason,'WORMHOLE_JOURNAL_CORRUPT');
 }finally{x.cleanup()}
});
test('missing journal directory created and clean read accepted',()=>{
 const dir=path.join(os.tmpdir(),`wormhole23-missing-${process.pid}-${Date.now()}`);
 const f=createFence({root:dir});try{assert.equal(f.pendingFor(777).blocked,false)}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('native five-minute polarization blocks same character without any new mass debit',()=>{
 const x=fixture();try{
  x.state.polarizationByCharacter[101]={'501':{endAtMs:1_100_000,durationSeconds:300}};
  const r=x.perform(x.session(101));assert.equal(r.status,'BLOCKED');
  assert.equal(x.state.pairsByID['7'].remainingMass,90);
  assert.equal(x.transitions.length,0);
 }finally{x.cleanup()}
});
test('max single-jump ship mass is enforced before ticket and transition',()=>{
 const x=fixture({shipMass:110});try{
  const r=x.perform(x.session(101));assert.equal(r.status,'BLOCKED');
  assert.equal(x.state.pairsByID['7'].remainingMass,90);assert.equal(x.transitions.length,0);
 }finally{x.cleanup()}
});
test('ticket in PREPARED state blocks replay across a new instance after native failure',()=>{
 const x=fixture({failCommit:true});try{
  assert.equal(x.perform(x.session(101)).status,'NEEDS_OPERATOR_REPAIR');
  const recovered=createFence({root:x.root});
  assert.equal(recovered.pendingFor(101).blocked,true);
  assert.equal(recovered.pendingFor(202).blocked,false);
 }finally{x.cleanup()}
});
test('never accepts a stale queued jump after ship switches to a new physical hull',()=>{
 const x=fixture();try{
  const s=x.session(101);s._space.shipID=1002;
  const r=x.perform(s);assert.equal(r.status,'BLOCKED');
  assert.equal(x.transitions.length,0);
 }finally{x.cleanup()}
});
