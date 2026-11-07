'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalGuardAggression.js'),'utf8');
function f(){
 let now=1700000000000,damage=25;
 const owner=500,system=30000142,shipID=2301,enemyID=3333,ownerShip=3003;
 const session={characterID:owner,userid:55,socket:{destroyed:false},
  _space:{shipID:ownerShip,systemID:system,initialStateSent:true}};
 const actor={kind:'ship',itemID:shipID,systemID:system,ownerID:owner,
  nativeNpc:true,personalFleetOriginal:true,corporationID:200};
 const pirate={kind:'ship',itemID:enemyID,systemID:system,nativeNpc:true,
  npcEntityType:'npc',corporationID:300,ownerID:900};
 const player={kind:'ship',itemID:ownerShip,systemID:system,nativeNpc:false,
  ownerID:owner,session};
 const entities=new Map([[shipID,actor],[enemyID,pirate],[ownerShip,player]]);
 const scene={systemID:system,getEntityByID:id=>entities.get(id)||null};
 const pfController={entityID:shipID,systemID:system,personalFleetOriginal:true,
  personalFleetAssignmentID:'assign-1',personalFleetPilotID:'coop-pilot-123',
  manualOrder:{type:'attack',targetID:enemyID,allowWeapons:true,allowPodKill:false}};
 const enemyController={entityID:enemyID,systemID:system,operatorKind:'RAID'};
 const ledger={version:1,phase:'ISSUING',operationID:'pf-guard-react-abc',
  signature:'a'.repeat(64),action:'ATTACK',shipItemID:shipID,targetEntityID:enemyID,
  systemID:system,ownerCharacterID:owner,assignmentID:'assign-1',
  actorGeneration:2,pilotID:'coop-pilot-123'};
 const PF='coop-personal-fleet\u001f',T='corporationRuntime';
 const db={
  [T]:{
   [PF+'manual-order-v1:'+shipID]:ledger,
   [PF+'manual-order-operations-v1']:{operations:{
    [ledger.operationID]:{signature:ledger.signature,phase:'ISSUING'}}},
   [PF+'actor-claims-v1']:{claims:{[shipID]:{ownerType:'PERSONAL_FLEET',
    entityID:shipID,ownerCharacterID:owner,generation:2}}},
   [PF+'deploy-v1:assign-1']:{phase:'ACTIVE',actorGeneration:2}
  },
  items:{items:{[shipID]:{itemID:shipID,ownerID:owner,categoryID:6,locationID:system}}}
 };
 const nativeEntity={entityID:shipID,systemID:system,ownerID:owner,
  personalFleetOriginal:true,personalFleetAssignmentID:'assign-1',
  personalFleetPilotID:'coop-pilot-123'};
 const deps={
  '../services/chat/sessionRegistry':{getSessions:()=>[session]},
  './runtime':{getSceneForSession:()=>scene},
  './npc/npcRegistry':{getControllerByEntityID:id=>id===shipID?pfController:
    id===enemyID?enemyController:null},
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
   isPoisoned:()=>false,transact:(tables,cb)=>cb({get:(table,key)=>db[table]?.[key]??null})}},
  './coopPersonalFleetNativeOrders':{key:x=>PF+'manual-order-v1:'+x,
   OP_INDEX:PF+'manual-order-operations-v1',signature:()=>ledger.signature},
  './npc/nativeNpcStore':{getNativeEntity:()=>nativeEntity}
 };
 const env={EVEJS_COOP_PERSONAL_FLEET_NATIVE:'1',
  EVEJS_COOP_PERSONAL_FLEET_CHAT:'1',EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1'};
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,
  require:id=>{if(!(id in deps))throw Error('BAD_SOURCE_IMPORT '+id);return deps[id]},
  process:{env},Date:{now:()=>now},Map,Object,Array,Number,Set},
  {filename:'PF97OriginalDamage.js'});
 return {api:module.exports,owner,system,shipID,enemyID,ownerShip,
  session,scene,actor,pirate,player,pfController,ledger,db,
  advance:ms=>now+=ms,setDamage:x=>damage=x,damage:()=>damage,
  disabled:()=>delete env.EVEJS_COOP_PERSONAL_FLEET_NATIVE};
}
test('PF97 real NPC damage on actual owner ship creates verified short-lived proof',()=>{
 const x=f(),r=x.api.note(x.pirate,x.player,x.damage());
 a.equal(r.status,'ORIGINAL_APPLIED_PLAYER_DAMAGE');
 const w=x.api.read({ownerCharacterID:x.owner,
  ownerShipItemID:x.ownerShip,systemID:x.system});
 a.equal(w.attackerEntityID,x.enemyID);a.equal(w.source,'EVEJS_ORIGINAL_KILLMAIL_APPLIED_DAMAGE_V1');
});
test('PF97 zero damage does not create a fake attack',()=>{
 const x=f();a.equal(x.api.note(x.pirate,x.player,0).status,'NO_VERIFIED_NATIVE_AGGRESSION');
 a.equal(x.api.listRecent().length,0);
});
test('PF97 player firing on player is not an NPC guard retaliation event',()=>{
 const x=f();x.pirate.nativeNpc=false;
 a.equal(x.api.note(x.pirate,x.player,25).status,'NO_VERIFIED_NATIVE_AGGRESSION');
});
test('PF97 unseen or recycled physical NPC ID never proves a hit',()=>{
 const x=f();x.scene.getEntityByID=id=>id===x.enemyID?{}:id===x.ownerShip?x.player:null;
 a.equal(x.api.note(x.pirate,x.player,25).status,'NO_VERIFIED_NATIVE_AGGRESSION');
});
test('PF97 expired damage event does not authorize indefinite revenge',()=>{
 const x=f();x.api.note(x.pirate,x.player,25);x.advance(120001);
 a.equal(x.api.listRecent().length,0);
});
test('PF97 owner cannot reuse other player source-damage evidence',()=>{
 const x=f();x.api.note(x.pirate,x.player,25);
 a.equal(x.api.read({ownerCharacterID:999,
  ownerShipItemID:x.ownerShip,systemID:x.system}),null);
});
test('PF97 native stock behavior grants only actual source ACK/ISSUING retaliation',()=>{
 const x=f();x.api.note(x.pirate,x.player,25);
 a.equal(x.api.allowsRetaliation(x.actor,x.pirate),true);
 x.ledger.action='DEFEND';
 a.equal(x.api.allowsRetaliation(x.actor,x.pirate),false);
});
test('PF97 no live manual attack means native NPCs remain friendly',()=>{
 const x=f();x.api.note(x.pirate,x.player,25);
 x.pfController.manualOrder={type:'follow',targetID:x.ownerShip,allowWeapons:false};
 a.equal(x.api.allowsRetaliation(x.actor,x.pirate),false);
});
test('PF97 stock friendly corporation is never targeted by retaliation',()=>{
 const x=f();x.api.note(x.pirate,x.player,25);
 x.actor.corporationID=x.pirate.corporationID;
 a.equal(x.api.allowsRetaliation(x.actor,x.pirate),false);
});
test('PF97 no native damage witness means no NPC-on-NPC exception',()=>{
 const x=f();a.equal(x.api.allowsRetaliation(x.actor,x.pirate),false);
});
