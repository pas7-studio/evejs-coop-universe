'use strict';
/**
 * PF77: exercise the REAL source-patched EveJS native arbiter/bridge in a
 * disposable WORK worktree. The game process and network are not started.
 * PF77_NATIVE_WORKTREE is explicitly required; never fall back to mocks.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.PF77_NATIVE_WORKTREE;
if(!root||!path.isAbsolute(root))throw Error('PF77_REAL_WORKTREE_REQUIRED');
if(root.split(/[\\/]+/).some(part=>['play','prod','production','deploy','deployment'].includes(part.toLowerCase())))
 throw Error('PF77_PLAY_OR_PROD_PATH_FORBIDDEN');
const base=path.join(root,'Code/server/src/space');
const arbiterPath=path.join(base,'coopNpcOrderArbiter.js');
const bridgePath=path.join(base,'coopNpcOrderBridge.js');
const arbiterSource=fs.readFileSync(arbiterPath,'utf8');
const bridgeSource=fs.readFileSync(bridgePath,'utf8');
if(!arbiterSource.includes('if(existing.owner === "PERSONAL_FLEET") return false;')||
   !bridgeSource.includes('PF55_NATIVE_ACTOR_CLAIM_UNVERIFIED')||
   !bridgeSource.includes('PF55_NATIVE_ACTOR_RESERVED'))
 throw Error('PF77_ORIGINAL_NATIVE_OWNER_PATCH_NOT_INSTALLED_IN_WORK');
const {createOrderArbiter}=require(arbiterPath);
const {createOrderBridge}=require(bridgePath);
const ID=2001,SYSTEM=30000142,PILOT='coop-pilot-123';
const assignment=()=>({pilotID:PILOT,entityID:ID,systemID:SYSTEM});
function setup({claim='ASSIGNED',withClaim=true,links=[assignment()],
  actorChanges={},controllerChanges={}}={}){
 let executed=0,checks=0,now=1800000000000;
 const actor={kind:'ship',nativeNpc:true,itemID:ID,mode:'STOP',session:null,...actorChanges};
 const controller={entityID:ID,systemID:SYSTEM,manualOrder:null,currentTargetID:0,...controllerChanges};
 const arbiter=createOrderArbiter({clock:()=>now,leaseMs:120000});
 let claimValue=claim;
 const options={arbiter,assignments:()=>links,sceneForSystem:()=>({
    systemID:SYSTEM,getEntityByID:id=>id===ID?actor:null
   }),getController:()=>controller};
 if(withClaim)options.pfShipClaim=()=>{checks++;return claimValue};
 const bridge=createOrderBridge(options);
 const issue=(owner,execute=()=>{executed++;return {success:true}})=>bridge.issue({
  entityID:ID,systemID:SYSTEM,owner,action:'pf-follow',holdMs:120000,execute
 });
 return {issue,arbiter,bridge,actor,controller,
  get effects(){return executed},get claimReads(){return checks},
  setClaim:x=>{claimValue=x},setClock:x=>{now=x}};
}

test('stock-patched native bridge admits exactly one authorized PF action',()=>{
 const f=setup();
 assert.equal(f.issue('PERSONAL_FLEET').success,true);
 assert.equal(f.effects,1);
 assert.equal(f.arbiter.snapshot().leases[0].owner,'PERSONAL_FLEET');
 assert.ok(f.claimReads>=2);
});
for(const owner of ['RAID','PATROL','TACTICS','WAR','CIVILIAN','GATE','EXPEDITION']){
 test('foreign '+owner+' cannot command a PF-claimed original hull',()=>{
  const f=setup(),result=f.issue(owner);
  assert.equal(result.success,false);
  assert.equal(f.effects,0);
  assert.equal(f.arbiter.snapshot().leases.length,0);
 });
}
for(const claim of ['UNKNOWN',undefined,'MALFORMED','UNASSIGNED']){
 test('PF original order fails closed on unverified claim '+String(claim),()=>{
  const f=setup();
  f.setClaim(claim);
  assert.equal(f.issue('PERSONAL_FLEET').success,false);
  assert.equal(f.effects,0);
 });
}
test('missing original PF claim authority rejects PF ownership',()=>{
 const f=setup({withClaim:false});
 assert.equal(f.issue('PERSONAL_FLEET').errorMsg,'PF55_NATIVE_ACTOR_CLAIM_UNVERIFIED');
 assert.equal(f.effects,0);
});
test('PF claim changing between native bridge preflight and arbiter verify denies without effect',()=>{
 const f=setup();
 // The genuine native bridge rereads pfShipClaim while verifying its arbiter
 // lease; the callback would be an original authoritative registry read.
 const opts={arbiter:createOrderArbiter({clock:()=>1800000000000}),
  assignments:()=>[assignment()],sceneForSystem:()=>({
   systemID:SYSTEM,getEntityByID:()=>({kind:'ship',nativeNpc:true,itemID:ID,mode:'STOP',session:null})}),
  getController:()=>({entityID:ID,systemID:SYSTEM,manualOrder:null}),
  pfShipClaim:(()=>{let i=0;return()=>++i===1?'ASSIGNED':'UNKNOWN'})()
 };
 const bridge=createOrderBridge(opts);
 let effects=0;
 const got=bridge.issue({entityID:ID,systemID:SYSTEM,owner:'PERSONAL_FLEET',
  action:'pf-hold',execute:()=>{effects++;return {success:true}}});
 assert.equal(got.success,false);
 assert.equal(effects,0);
 assert.equal(f.effects,0);
});
for(const [reason,actorChanges,controllerChanges] of [
 ['player session',{session:{characterID:900001}},{}],
 ['wrong itemID',{itemID:ID+1},{}],
 ['not native',{nativeNpc:false},{}],
 ['wrong controller',{}, {entityID:ID+1}],
 ['wrong controller system',{}, {systemID:SYSTEM+1}]
]){
 test('real bridge rejects '+reason+' before any native command',()=>{
  const f=setup({actorChanges,controllerChanges});
  assert.equal(f.issue('PERSONAL_FLEET').success,false);
  assert.equal(f.effects,0);
 });
}
test('duplicate foreign pilot assignment makes original identity ambiguous',()=>{
 const f=setup({links:[assignment(),{pilotID:PILOT,entityID:ID+2,systemID:SYSTEM}]});
 assert.equal(f.issue('PERSONAL_FLEET').errorMsg,'COOP_NPC_ORDER_IDENTITY_UNVERIFIED');
 assert.equal(f.effects,0);
});
test('TACTICS cannot preempt an established PF arbiter lease even without bridge',()=>{
 const f=setup();
 assert.equal(f.issue('PERSONAL_FLEET').success,true);
 const outcome=f.arbiter.issue({entityID:ID,systemID:SYSTEM,pilotID:PILOT,
  owner:'TACTICS',action:'pf-attack',holdMs:120000,
  verify:()=>true,execute:()=>{throw Error('FORBIDDEN_NATIVE_TAKEOVER')}});
 assert.equal(outcome.errorMsg,'COOP_NPC_ORDER_LEASED');
 assert.equal(f.effects,1);
 assert.equal(f.arbiter.snapshot().leases[0].owner,'PERSONAL_FLEET');
});
test('native bridge remains operational for ordinary non-PF ships',()=>{
 const f=setup({claim:'UNASSIGNED'});
 assert.equal(f.issue('RAID').success,true);
 assert.equal(f.effects,1);
});
test('unverified actor active warp refuses even its legitimate PF controller',()=>{
 const f=setup({actorChanges:{mode:'WARP'}});
 assert.equal(f.issue('PERSONAL_FLEET').errorMsg,'COOP_NPC_ORDER_NATIVE_WARP_ACTIVE');
 assert.equal(f.effects,0);
});
test('unknown original native result fences replay at arbiter level',()=>{
 const f=setup();
 const first=f.issue('PERSONAL_FLEET',()=>({reason:'unknown'}));
 assert.equal(first.errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 assert.equal(f.issue('PERSONAL_FLEET').errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 assert.equal(f.effects,0);
});
