'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalOrderWitness.js'),'utf8');
const T='corporationRuntime',F='coop-personal-fleet\u001f';
function harness(run,{combatAuthority=null}={}){
 const owner=900101,ship=2001,target=3003,system=30000142,station=600001,
  assignment='pf-assignment-1',pilot='coop-pilot-123';
 const c={shipItemID:ship,ownerCharacterID:owner,systemID:system,actorGeneration:2,
  assignmentID:assignment,pilotID:pilot,action:'FOLLOW',targetEntityID:target};
 const player={characterID:owner,userid:12,socket:{destroyed:false},_space:{shipID:target,systemID:system,initialStateSent:true}};
 const entity={kind:'ship',itemID:ship,nativeNpc:true,nativeNpcOccupied:true,
  personalFleetOriginal:true,ownerID:owner,operatorKind:'PERSONAL_FLEET',
  selectionID:assignment,session:null,characterID:0,pilotCharacterID:0};
 const other={kind:'ship',itemID:target,nativeNpc:false,transient:false,session:player};
 const controller={entityID:ship,systemID:system,personalFleetOriginal:true,
  personalFleetGeneration:1,personalFleetAssignmentID:assignment,
  personalFleetPilotID:pilot,operatorKind:'PERSONAL_FLEET',runtimeKind:'nativeAmbient'};
 const storedEntity={entityID:ship,systemID:system,ownerID:owner,personalFleetOriginal:true,
  personalFleetAssignmentID:assignment,personalFleetPilotID:pilot,personalFleetGeneration:1};
 const storedController={...controller};
 const map=new Map([[ship,entity],[target,other]]), scene={systemID:system,getEntityByID:id=>map.get(id)||null};
 const idx={ships:{[ship]:{ownerCharacterID:owner,pilotID:pilot,assignmentID:assignment,generation:1}}};
 const roster={pilots:{[pilot]:{pilotID:pilot,contractID:'contract-1',status:'HANGAR_RESERVED',
  assignmentID:assignment,shipItemID:ship,generation:1}}};
 const claims={claims:{[ship]:{ownerType:'PERSONAL_FLEET',entityID:ship,pilotID:pilot,
   ownerCharacterID:owner,assignmentID:assignment,systemID:system,generation:2}},generations:{[ship]:2}};
 const dep={phase:'ACTIVE',assignmentID:assignment,shipItemID:ship,ownerCharacterID:owner,
  pilotID:pilot,systemID:system,actorGeneration:2,generation:1,contractID:'contract-1',typeID:603};
 const items={[ship]:{itemID:ship,ownerID:owner,categoryID:6,locationID:system,flagID:0,
  typeID:603,spaceState:{systemID:system}},
  [target]:{itemID:target,ownerID:owner,categoryID:6,locationID:system,flagID:0}};
 const character={characterID:owner,accountId:12,shipID:target};
 const values=new Map([[T+'|'+F+'deploy-v1:'+assignment,dep],
  [T+'|'+F+'actor-claims-v1',claims],
  [T+'|roster-index',idx],[T+'|roster:'+owner,roster],['items|items',items],
  ['characters|'+owner,character]]);
 let enabled=true,fenced=true,poisoned=false,registered=[player], storedActive=controller;
 const tx={get:(table,key)=>values.get(table+'|'+key)??null};
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',transact:(groups,cb)=>cb(tx),isPoisoned:()=>poisoned}};
 const modules={
  '../gameStore':gameStore,
  './npc/nativeNpcStore':{getNativeEntity:()=>storedEntity,getNativeController:()=>storedController},
  './npc/npcRegistry':{getControllerByEntityID:()=>storedActive},
  './runtime':{scenes:new Map([[system,scene]])},
  '../services/chat/sessionRegistry':{getSessions:()=>registered},
  './coopPersonalFleetNativeOrders':{signature:x=>x.signature},
  './coopPersonalFleetHangarBridge':{REGISTRY_KEY:'roster-index',ROSTER_PREFIX:'roster:',
     validateIndex:x=>x,validateRoster:x=>x},
  './coopPersonalFleetNativeActorProof':{matchesOriginalPersonalFleetActor:(row,e,ctrl)=>
    e===entity&&ctrl===controller&&row.shipItemID===ship&&ctrl.personalFleetGeneration===row.reservationGeneration},
 };
 const scope={module:{exports:{}},exports:{},require:name=>{
  if(!(name in modules))throw Error('UNKNOWN_IMPORT '+name);return modules[name];
 },process,structuredClone,Object,Array,Number,RegExp,String,Map,Set};
 vm.runInNewContext(source,scope,{filename:'coopPersonalFleetOriginalOrderWitness.js'});
 const witness=scope.module.exports.createOriginalOrderWitness({combatAuthority,enabled:()=>enabled,allWritersFenced:()=>fenced});
 const fixture={c,tx,witness,owner,ship,target,player,entity,other,controller,storedEntity,
  storedController,claims,dep,idx,roster,items,character,map,scene,values,
  setEnabled:x=>enabled=x,setFenced:x=>fenced=x,setPoisoned:x=>poisoned=x,
  setSessions:x=>registered=x,setController:x=>storedActive=x};
 run(fixture);
}
const positive=(f)=>{
 assert.equal(f.witness.verifyNativeActor(f.c,f.tx),true);
 assert.equal(f.witness.verifyOriginalControl(f.c,f.tx),true);
 assert.equal(f.witness.verifyTarget(f.c,f.tx),true);
 assert.equal(f.witness.verifyPersonalClaim(f.c),true);
};
test('source-bound original actor/order/target succeeds only on full proof',()=>harness(positive));
const cases=[
 ['actor generation drift',f=>f.dep.actorGeneration++,'actor'],
 ['claim actor generation drift',f=>f.claims.claims[f.ship].generation++,'actor'],
 ['different original stock item owner',f=>f.items[f.ship].ownerID++,'actor'],
 ['missing source stock ship',f=>delete f.items[f.ship],'actor'],
 ['altered original station claimant',f=>f.roster.pilots[f.c.pilotID].contractID='fake','actor'],
 ['altered original assignment',f=>f.idx.ships[f.ship].assignmentID='stale','actor'],
 ['original NPC persisted store changed',f=>f.storedEntity.personalFleetOriginal=false,'actor'],
 ['persisted original controller generation changed',f=>f.storedController.personalFleetGeneration++,'actor'],
 ['physical entity removed',f=>f.map.delete(f.ship),'actor'],
 ['native controller unregistered',f=>f.setController(null),'actor'],
 ['game store poisoned',f=>f.setPoisoned(true),'actor'],
 ['writer gate revoked',f=>f.setFenced(false),'actor'],
 ['feature flag off',f=>f.setEnabled(false),'actor'],
 ['combat controller blocks manual control',f=>f.controller.runtimeKind='nativeCombat','control'],
 ['hostile ATTACK pending blocks control',f=>f.controller.manualOrder={type:'attack'},'control'],
 ['other player target',f=>f.items[f.target].ownerID++,'target'],
 ['player account switched',f=>f.character.accountId++,'target'],
 ['player disconnected',f=>f.player.socket.destroyed=true,'target'],
 ['double login',f=>f.setSessions([f.player,{...f.player}]),'target'],
 ['different physical target scene session',f=>f.other.session={...f.player},'target'],
 ['target physical actor removed',f=>f.map.delete(f.target),'target'],
 ['stale player ship reference',f=>f.player._space.shipID++,'target'],
 ['target ship not in original space',f=>f.items[f.target].flagID=4,'target'],
 ['target entity is NPC',f=>f.other.nativeNpc=true,'target'],
 ['external PvP/ATTACK request denied in first-play',f=>f.c.action='ATTACK','target'],
];
for(const [name,change,which] of cases){test('fail closed: '+name,()=>harness(f=>{
  positive(f);change(f);
  const got=which==='actor'?f.witness.verifyNativeActor(f.c,f.tx):
    which==='control'?f.witness.verifyOriginalControl(f.c,f.tx):
    f.witness.verifyTarget(f.c,f.tx);
  assert.equal(got,false);
}));}
test('HOLD allows no target, requires same physical NPC actor',()=>harness(f=>{
  f.c.action='HOLD';f.c.targetEntityID=null;
  assert.equal(f.witness.verifyTarget(f.c,f.tx),true);
  f.dep.actorGeneration++;
  assert.equal(f.witness.verifyTarget(f.c,f.tx),false);
}));
test('source witness never issues original writes or creates NPCs',()=>{
 const s=source;
 assert.ok(!s.includes('.put('));
 assert.ok(!s.includes('.upsertNative'));
 assert.ok(!s.includes('.issueManualOrder('));
});

test('PF97 real prior ACKED GUARD may retaliate against stock-reported attacker',()=>harness(f=>{
 f.c.operationID='guard-react-1';
 f.c.action='ATTACK';f.c.targetEntityID=5555;
 f.controller.runtimeKind='nativeCombat';
 f.controller.manualOrder={type:'follow',targetID:f.target,allowWeapons:false,allowPodKill:false};
 const prev={version:1,phase:'ACKED',action:'DEFEND',operationID:'guard-1',
  signature:'a'.repeat(64),ownerCharacterID:f.owner,shipItemID:f.ship,
  assignmentID:f.c.assignmentID,pilotID:f.c.pilotID,
  actorGeneration:f.c.actorGeneration,systemID:f.c.systemID,
  targetEntityID:f.target};
 f.values.set('corporationRuntime|coop-personal-fleet\u001fmanual-order-v1:'+f.ship,prev);
 f.values.set('corporationRuntime|coop-personal-fleet\u001fmanual-order-operations-v1',{
  operations:{'guard-1':{phase:'ACKED',signature:prev.signature}}});
 assert.equal(f.witness.verifyOriginalControl(f.c,f.tx),true);
 f.controller.manualOrder.targetID=8888;
 assert.equal(f.witness.verifyOriginalControl(f.c,f.tx),false);
},{combatAuthority:{verify:()=>true}}));
test('PF97 stale GUARD or unacked contract cannot authorize another attack',()=>harness(f=>{
 f.c.action='ATTACK';f.c.targetEntityID=5555;
 f.controller.runtimeKind='nativeCombat';
 f.controller.manualOrder={type:'follow',targetID:f.target,allowWeapons:false};
 f.values.set('corporationRuntime|coop-personal-fleet\u001fmanual-order-v1:'+f.ship,{
  phase:'ISSUING',action:'DEFEND',targetEntityID:f.target,
  ownerCharacterID:f.owner,shipItemID:f.ship,pilotID:f.c.pilotID,
  assignmentID:f.c.assignmentID,actorGeneration:f.c.actorGeneration});
 assert.equal(f.witness.verifyOriginalControl(f.c,f.tx),false);
},{combatAuthority:{verify:()=>true}}));
