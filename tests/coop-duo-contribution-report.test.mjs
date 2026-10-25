import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {report}=require('../scripts/coop-duo-contribution-report.cjs');
const now=Date.parse('2026-10-25T18:00:00Z');
const at=s=>new Date(now-120000+s*1000).toISOString();
const e=(s,event,data={})=>({at:at(s),event,systemID:30000144,...data});
function rows(){return [
 e(1,'living-headless-boot-requested'),
 e(2,'coop-shared-scene',{mutualVisibility:true,pilots:[{characterID:11,shipID:201,shipExists:true},{characterID:12,shipID:202,shipExists:true}]}),
 e(5,'coop-native-player-damage',{status:'APPLIED_NATIVE_PLAYER_DAMAGE',source:'NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE',characterID:11,shipID:201,victimEntityID:501,appliedDamage:15}),
 e(6,'coop-native-player-damage',{status:'APPLIED_NATIVE_PLAYER_DAMAGE',source:'NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE',characterID:12,shipID:202,victimEntityID:501,appliedDamage:9}),
 e(7,'living-native-wreck-evidence',{status:'PHYSICAL_NATIVE_WRECK_VERIFIED',victimEntityID:501,wreckID:701,lootStatus:'ITEMS_STORED',storedItemCount:2}),
 e(10,'coop-fleet-dungeon-objective',{status:'TWO_PLAYER_NATIVE_DUNGEON_OBJECTIVE_CREDITED',characterIDs:[11,12],fleetID:8,sourceInstanceID:303,agentID:404})
];}
const run=a=>report(a.map(x=>JSON.stringify(x)).join('\n'),{now});
test('two real applied damage receipts plus separately credited shared native mission, no reward claim',()=>{
 const r=run(rows());assert.equal(r.status,'SERVER_TWO_PLAYER_DAMAGE_AND_MISSION_CREDIT');
 assert.equal(r.damage.distinctDamagers,2);assert.equal(r.damage.matchedPhysicalWreck,true);
 assert.equal(r.mission.status,'TWO_NATIVE_DUNGEON_OBJECTIVES_CREDITED');
 assert.equal(r.actualGameplayVerified,false);assert.equal(r.clientRenderingVerified,false);
 assert.equal(r.missionRewardsVerified,false);assert.doesNotMatch(JSON.stringify(r),/characterID/);
});
test('one pilot damage is not shared combat despite both on grid and shared mission',()=>{
 const a=rows();a.splice(3,1);const r=run(a);assert.equal(r.damage.distinctDamagers,1);
 assert.equal(r.status,'INCOMPLETE_NATIVE_COOP_EVIDENCE');
});
test('player targeting two different NPCs does not establish same-target collaboration',()=>{
 const a=rows();a[3].victimEntityID=502;assert.equal(run(a).damage.distinctDamagers,1);
});
test('mere weapon order or correlated NPC HP sample is not applied player damage',()=>{
 const a=rows();a[2].status='WEAPON_ORDER_ACCEPTED';a[3].source='NPC_HEALTH_SAMPLER';
 assert.equal(run(a).damage.distinctDamagers,0);
});
test('only authentically paired ship IDs are accepted',()=>{
 const a=rows();a[3].shipID=999;assert.equal(run(a).damage.distinctDamagers,1);
});
test('cross-system damage is not borrowed from another system',()=>{
 const a=rows();a[3].systemID=30000142;assert.equal(run(a).damage.distinctDamagers,1);
});
test('disconnect between grid proof and hit invalidates old co-op presence',()=>{
 const a=rows();a.splice(3,0,e(5.5,'disconnect-after-persist',{characterID:12}));
 assert.equal(run(a).damage.distinctDamagers,1);
});
test('refreshed grid after reconnect admits later verified damage',()=>{
 const a=rows();a.splice(3,0,e(5.2,'disconnect-after-persist',{characterID:12}),e(5.5,'coop-shared-scene',{mutualVisibility:true,pilots:[{characterID:11,shipID:201,shipExists:true},{characterID:12,shipID:202,shipExists:true}]}));
 assert.equal(run(a).damage.distinctDamagers,2);
});
test('mission must identify exactly same two authenticated characters and real native source',()=>{
 for(const patch of [{characterIDs:[11,13]},{agentID:0},{sourceInstanceID:null},{characterIDs:[11,11]},{status:'NATIVE_SHARED_OBJECTIVE_FAILED'}]){
  const a=rows();Object.assign(a.at(-1),patch);
  assert.equal(run(a).mission.status,'NO_INDEPENDENT_NATIVE_MISSION_PROOF');
 }
});
test('old reboot evidence must not be used on a fresh process',()=>{
 const a=rows();a.push(e(20,'living-headless-boot-requested'));
 assert.equal(run(a).status,'BLOCKED');
});
test('malformed log and invalid time are blocked, never gameplay proven',()=>{
 assert.equal(report('{broken',{now}).status,'BLOCKED');
 assert.throws(()=>report('',{now,windowMinutes:9000}),/window/);
});
test('verified damage can be real even without wreck, but no final blow claimed',()=>{
 const a=rows();a.splice(4,1);const r=run(a);
 assert.equal(r.damage.distinctDamagers,2);assert.equal(r.damage.matchedPhysicalWreck,false);
 assert.equal(r.actualGameplayVerified,false);
});
