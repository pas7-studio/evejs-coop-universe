import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {observeAppliedDamage}=require('../integration/coopPlayerCombatWitness.cjs');
const {patch}=require('../scripts/coop-player-damage-native-patch.cjs');
function fixture(){
 const source={itemID:201,kind:'ship',nativeNpc:false,pilotCharacterID:101};
 const victim={itemID:501,kind:'ship',nativeNpc:true};
 const session={characterID:101,_space:{shipID:201,systemID:30000144,initialStateSent:true},socket:{destroyed:false}};
 const scene={systemID:30000144,getEntityByID:id=>new Map([[201,source],[501,victim]]).get(Number(id))};
 const emitted=[];
 return {args:{attackerEntity:source,targetEntity:victim,appliedDamage:17,sessions:[session],sceneForSession:()=>scene,emit:r=>emitted.push(r)},source,victim,session,scene,emitted};
}
test('a native applied hit from one authentic player gets a narrow evidence receipt',()=>{
 const f=fixture();const result=observeAppliedDamage(f.args);
 assert.equal(result.status,'APPLIED_NATIVE_PLAYER_DAMAGE');
 assert.equal(result.appliedDamage,17);
 assert.equal(result.characterID,101);
 assert.equal(result.victimEntityID,501);
 assert.equal(result.source,'NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE');
 assert.equal(f.emitted.length,1);
});
test('zero, negative or invalid native applied damage cannot count',()=>{
 for(const amount of [0,-1,NaN,Infinity,undefined]){
  const f=fixture();assert.equal(observeAppliedDamage({...f.args,appliedDamage:amount}).status,'NOT_VERIFIED_NATIVE_PLAYER_DAMAGE');
  assert.equal(f.emitted.length,0);
 }
});
test('native NPC, player target and wreck cannot qualify as authentic player-on-NPC damage',()=>{
 const f=fixture();f.source.nativeNpc=true;
 assert.equal(observeAppliedDamage(f.args).status,'NOT_VERIFIED_NATIVE_PLAYER_DAMAGE');
 f.source.nativeNpc=false;f.victim.nativeNpc=false;
 assert.equal(observeAppliedDamage(f.args).status,'NOT_VERIFIED_NATIVE_PLAYER_DAMAGE');
 f.victim.nativeNpc=true;f.victim.kind='wreck';
 assert.equal(observeAppliedDamage(f.args).status,'NOT_VERIFIED_NATIVE_PLAYER_DAMAGE');
});
test('ghost/duplicate/cross-system/disconnected sessions fail closed',()=>{
 const f=fixture();f.session._space.initialStateSent=false;
 assert.equal(observeAppliedDamage(f.args).status,'NO_UNIQUE_NATIVE_SHIP_OWNER');
 f.session._space.initialStateSent=true;f.session.socket.destroyed=true;
 assert.equal(observeAppliedDamage(f.args).status,'NO_UNIQUE_NATIVE_SHIP_OWNER');
 f.session.socket.destroyed=false;f.session._space.systemID=30000142;
 assert.equal(observeAppliedDamage(f.args).status,'NO_UNIQUE_NATIVE_SHIP_OWNER');
 f.session._space.systemID=30000144;f.args.sessions.push({...f.session});
 assert.equal(observeAppliedDamage(f.args).status,'NO_UNIQUE_NATIVE_SHIP_OWNER');
});
test('a different authoritative target object cannot borrow same item ID',()=>{
 const f=fixture();f.args.targetEntity={...f.victim};
 assert.equal(observeAppliedDamage(f.args).status,'NO_UNIQUE_NATIVE_SHIP_OWNER');
});
test('explicit attacker pilot ID must match authenticated owner; absent ID uses physical session',()=>{
 const f=fixture();f.source.pilotCharacterID=300;
 assert.equal(observeAppliedDamage(f.args).status,'PLAYER_IDENTITY_MISMATCH');
 delete f.source.pilotCharacterID;
 assert.equal(observeAppliedDamage(f.args).status,'APPLIED_NATIVE_PLAYER_DAMAGE');
});
test('failed optional telemetry never alters combat and never pretends recorded evidence',()=>{
 const f=fixture();f.args.emit=()=>{throw Error('disk unavailable');};
 assert.equal(observeAppliedDamage(f.args).status,'TELEMETRY_NOT_RECORDED');
});
const pinnedFragment=[
 'function noteDamage(attackerEntity, targetEntity, appliedDamage, options = {}) {',
 '  const damageAmount = Math.max(0, toFiniteNumber(appliedDamage, 0));',
 '  ledger.attackers[attackerKey] = currentEntry;',
 '  ledger.damageTaken = toFiniteNumber(ledger.damageTaken, 0) + damageAmount;',
 '  ledger.lastUpdatedAtMs = whenMs;',
 '  ledger.solarSystemID = toPositiveInt(',
 '    targetEntity.systemID,',
 '    toPositiveInt(ledger.solarSystemID, null),',
 '  );'
].join('\n');
test('pinned native damage hook is idempotent, reversible and never changes ledger writes',()=>{
 const added=patch(pinnedFragment);
 assert.match(added,/coopPlayerCombatWitness/);
 assert.equal(patch(added),added);
 assert.equal(patch(added,{remove:true}),pinnedFragment);
 assert.equal(patch(pinnedFragment,{remove:true}),pinnedFragment);
 assert.ok(added.indexOf('ledger.damageTaken')<added.indexOf('coopPlayerCombatWitness'));
});
test('unknown, duplicate or partly patched upstream source is rejected',()=>{
 assert.throws(()=>patch('unknown source'),/UNKNOWN_PINNED/);
 assert.throws(()=>patch(pinnedFragment+pinnedFragment),/UNKNOWN_PINNED_DAMAGE_HOOK_ANCHOR/);
 const bad=patch(pinnedFragment).replace('    catch (error)', '    unexpected\n    catch (error)');
 assert.throws(()=>patch(bad),/PARTIAL_NATIVE_DAMAGE_HOOK/);
});
