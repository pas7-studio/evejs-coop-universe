'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalCombatAuthority.js'),'utf8');
const T='corporationRuntime',F='coop-personal-fleet\u001f',OWNER=9001,SHIP=2301,TARGET=5555,SYSTEM=30000142;
function fixture(fn,{action='ATTACK'}={}){
 const row={action,shipItemID:SHIP,targetEntityID:TARGET,ownerCharacterID:OWNER,
  systemID:SYSTEM,actorGeneration:2,assignmentID:'assignment-1',
  pilotID:'coop-pilot-123456',followRangeMeters:action==='DEFEND'?2500:null};
 const live={kind:'ship',itemID:SHIP,ownerID:OWNER,nativeNpc:true,npcEntityType:'npc',personalFleetOriginal:true};
 const target={kind:'ship',itemID:TARGET,nativeNpc:action==='ATTACK',
  npcEntityType:action==='ATTACK'?'npc':undefined,ownerID:action==='ATTACK'?8000:OWNER,
  session:action==='ATTACK'?null:{characterID:OWNER,socket:{destroyed:false}}};
 const scene={systemID:SYSTEM,getEntityByID:id=>id===SHIP?live:id===TARGET?target:null};
 const ctrl={entityID:SHIP,systemID:SYSTEM,personalFleetOriginal:true,
  personalFleetAssignmentID:row.assignmentID,personalFleetPilotID:row.pilotID};
 const stock={...ctrl,ownerID:OWNER};
 const dep={phase:'ACTIVE',shipItemID:SHIP,ownerCharacterID:OWNER,actorGeneration:2};
 const values={
  [T]:{
   [F+'deploy-v1:assignment-1']:dep,
   [F+'actor-claims-v1']:{claims:{[SHIP]:{ownerType:'PERSONAL_FLEET',generation:2}}},
   index:{ships:{[SHIP]:{assignmentID:'assignment-1'}}},
   ['roster:'+OWNER]:{pilots:{[row.pilotID]:{shipItemID:SHIP}}}},
  items:{items:{[SHIP]:{itemID:SHIP,ownerID:OWNER,categoryID:6,locationID:SYSTEM}}},
  characters:{[OWNER]:{characterID:OWNER,shipID:TARGET}}
 };
 let allowed=true,enabled=true,fenced=true,poison=false;
 const modules={
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
    transact:()=>{throw Error('NO_ADHOC_TRANSACTIONS_EXPECTED')},
    isPoisoned:()=>poison}},
  './runtime':{scenes:new Map([[SYSTEM,scene]])},
  './npc/npcRegistry':{getControllerByEntityID:id=>id===SHIP?ctrl:null},
  './npc/nativeNpcStore':{getNativeEntity:()=>stock,getNativeController:()=>stock},
  './npc/npcBehaviorLoop':{__testing:{isValidCombatTarget:()=>allowed}},
  './coopPersonalFleetHangarBridge':{
   REGISTRY_KEY:'index',ROSTER_PREFIX:'roster:',validateIndex:x=>x,validateRoster:x=>x}
 };
 const m={exports:{}};
 vm.runInNewContext(source,{require:id=>{
  if(!(id in modules))throw Error('MISSING_ORIGINAL_SOURCE '+id);return modules[id];
 },module:m,exports:m.exports,Object,Array,Number,Set,Map},{filename:'PF95Combat.js'});
 const owner=m.exports.createOriginalCombatAuthority({
  enabled:()=>enabled,allWritersFenced:()=>fenced});
 const tx={get:(table,key)=>values[table]?.[key]??null};
 fn({owner,row,tx,live,target,scene,ctrl,stock,dep,values,denyTarget:()=>allowed=false,
  disable:()=>enabled=false,unfence:()=>fenced=false,poison:()=>poison=true});
}
test('PF95 genuine stock-legal PvE native target is accepted',()=>fixture(f=>{
 assert.equal(f.owner.verify(f.row,f.tx),true);
}));
test('PF95 stock combat policy retains the final veto',()=>fixture(f=>{
 f.denyTarget();assert.equal(f.owner.verify(f.row,f.tx),false);
}));
test('PF95 personal NPC cannot attack player ships through PvE ATTACK',()=>fixture(f=>{
 f.target.session={characterID:9999};f.target.nativeNpc=false;
 assert.equal(f.owner.verify(f.row,f.tx),false);
}));
test('PF95 cannot attack its own real player-owned hull',()=>fixture(f=>{
 f.target.ownerID=OWNER;assert.equal(f.owner.verify(f.row,f.tx),false);
}));
test('PF95 GUARD follows actual owner physical player ship',()=>fixture(f=>{
 assert.equal(f.owner.verify(f.row,f.tx),true);
},{action:'DEFEND'}));
test('PF95 GUARD refuses a foreign player ship',()=>fixture(f=>{
 f.target.ownerID=999;assert.equal(f.owner.verify(f.row,f.tx),false);
},{action:'DEFEND'}));
test('PF95 native actor assignment conflict blocks combat',()=>fixture(f=>{
 f.stock.personalFleetAssignmentID='foreign';
 assert.equal(f.owner.verify(f.row,f.tx),false);
}));
test('PF95 revoked writer gate blocks all combat',()=>fixture(f=>{
 f.unfence();assert.equal(f.owner.verify(f.row,f.tx),false);
}));
test('PF95 a target already in warp is not a legal attack',()=>fixture(f=>{
 f.target.mode='WARP';assert.equal(f.owner.verify(f.row,f.tx),false);
}));
