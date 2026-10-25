import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {observeAppliedDamage}=require('../integration/coopPlayerCombatWitness.cjs');
function nativeScene(){
 const attacker={itemID:201,kind:'ship',nativeNpc:false,pilotCharacterID:11};
 const target={itemID:501,kind:'ship',nativeNpc:true,conditionState:{damage:1}};
 const wreck={itemID:901,kind:'container',nativeNpcWreck:true,launcherID:501};
 const entities=new Map([[201,attacker],[901,wreck]]);
 const scene={systemID:30000144,dynamicEntities:entities,getEntityByID:id=>entities.get(Number(id))||null};
 const session={characterID:11,_space:{shipID:201,systemID:30000144,initialStateSent:true},socket:{destroyed:false}};
 const receipts=[];
 const args={attackerEntity:attacker,targetEntity:target,appliedDamage:99,sessions:[session],sceneForSession:()=>scene,emit:receipt=>receipts.push(receipt)};
 return {attacker,target,wreck,entities,scene,session,receipts,args};
}
const status=f=>observeAppliedDamage(f.args).status;
test('native one-shot is evidenced by terminal condition and actual physical source wreck',()=>{
 const f=nativeScene();const r=observeAppliedDamage(f.args);
 assert.equal(r.status,'APPLIED_NATIVE_PLAYER_DAMAGE');
 assert.equal(r.victimProof,'TERMINAL_NATIVE_WRECK');
 assert.equal(r.victimEntityID,501);
 assert.equal(f.receipts.length,1);
});
test('original still-live target takes priority over historic wreck',()=>{
 const f=nativeScene();f.entities.set(501,f.target);f.target.conditionState.damage=0.1;
 assert.equal(observeAppliedDamage(f.args).victimProof,'LIVE_NATIVE_SHIP');
});
test('missing, nonnative, unrelated or stale wreck never proves a fatal player hit',()=>{
 for(const change of [f=>f.entities.delete(901),f=>f.wreck.nativeNpcWreck=false,
  f=>f.wreck.launcherID=999]){
  const f=nativeScene();change(f);
  assert.equal(status(f),'NO_UNIQUE_NATIVE_SHIP_OWNER');
  assert.equal(f.receipts.length,0);
 }
});
test('terminal condition is mandatory for no-longer-present native NPC',()=>{
 for(const damage of [0,0.95,undefined,null]){
  const f=nativeScene();f.target.conditionState.damage=damage;
  assert.equal(status(f),'NO_UNIQUE_NATIVE_SHIP_OWNER');
 }
});
test('entity ID reuse cannot borrow old NPC death',()=>{
 const f=nativeScene();f.entities.set(501,{itemID:501,kind:'ship',nativeNpc:true});
 assert.equal(status(f),'NO_UNIQUE_NATIVE_SHIP_OWNER');
});
test('authenticated attacker must still be a physical active ship at death',()=>{
 const f=nativeScene();f.entities.delete(201);
 assert.equal(status(f),'NO_UNIQUE_NATIVE_SHIP_OWNER');
 const g=nativeScene();g.session.socket.destroyed=true;
 assert.equal(status(g),'NO_UNIQUE_NATIVE_SHIP_OWNER');
 const h=nativeScene();h.session._space.initialStateSent=false;
 assert.equal(status(h),'NO_UNIQUE_NATIVE_SHIP_OWNER');
});
test('fake pilot identity, duplicate live sessions and different scene are rejected',()=>{
 const f=nativeScene();f.attacker.pilotCharacterID=999;
 assert.equal(status(f),'PLAYER_IDENTITY_MISMATCH');
 const g=nativeScene();g.args.sessions.push({...g.session});
 assert.equal(status(g),'NO_UNIQUE_NATIVE_SHIP_OWNER');
 const h=nativeScene();h.scene.systemID=30000142;
 assert.equal(status(h),'NO_UNIQUE_NATIVE_SHIP_OWNER');
});
test('terminal native NPC must not be replaced by player owned or nonsensical object',()=>{
 const f=nativeScene();f.target.nativeNpc=false;
 assert.equal(status(f),'NOT_VERIFIED_NATIVE_PLAYER_DAMAGE');
 const g=nativeScene();g.target.kind='container';
 assert.equal(status(g),'NOT_VERIFIED_NATIVE_PLAYER_DAMAGE');
});
test('nonphysical wreck without authoritative getEntityByID identity fails',()=>{
 const f=nativeScene();const original=f.scene.getEntityByID;
 f.scene.getEntityByID=id=>Number(id)===901?{...f.wreck}:original(id);
 assert.equal(status(f),'NO_UNIQUE_NATIVE_SHIP_OWNER');
});
test('one-shot proof cannot pretend telemetry succeeded if append throws',()=>{
 const f=nativeScene();f.args.emit=()=>{throw Error('probe failed');};
 assert.equal(status(f),'TELEMETRY_NOT_RECORDED');
});
