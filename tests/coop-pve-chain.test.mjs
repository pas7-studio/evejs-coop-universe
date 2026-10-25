import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {summarize,parse}=require('../scripts/coop-pve-chain.cjs');
const now=Date.parse('2026-10-25T15:00:00Z');
const t=n=>new Date(now-20*60000+n*1000).toISOString();
const event=(n,name,extra={})=>({at:t(n),event:name,systemID:30000144,...extra});
function sequence(){
 return [
 event(0,'living-headless-boot-requested'),
 event(5,'coop-shared-scene',{mutualVisibility:true,pilots:[
  {characterID:1,shipID:101,shipExists:true},
  {characterID:2,shipID:102,shipExists:true}]}),
 event(8,'living-pirate-raid',{actions:[{action:'attack',pirateID:77,targetID:88,targetRole:'hauler'}]}),
 event(15,'living-native-wreck-evidence',{status:'PHYSICAL_NATIVE_WRECK_VERIFIED',victimEntityID:77,wreckID:99,lootStatus:'ITEMS_STORED',storedItemCount:2}),
 event(17,'living-native-loot-pickup',{status:'VERIFIED_NATIVE_LOOT_PICKUP',sourceEntityID:77,wreckID:99,wreckItemID:901,characterID:1,shipID:101,quantity:3,remainingQuantity:0,typeID:34,destinationLocationID:101,evidence:'NATIVE_GRANT_SUCCESS_PLUS_PHYSICAL_WRECK_AND_POST_TRANSFER_SOURCE_STORE'}),
 event(18,'living-native-loot-pickup',{status:'VERIFIED_NATIVE_LOOT_PICKUP',sourceEntityID:77,wreckID:99,wreckItemID:902,characterID:2,shipID:102,quantity:2,remainingQuantity:0,typeID:35,destinationLocationID:102,evidence:'NATIVE_GRANT_SUCCESS_PLUS_PHYSICAL_WRECK_AND_POST_TRANSFER_SOURCE_STORE'})
 ];
}
const report=(events,minutes=120)=>summarize(events.map(e=>JSON.stringify(e)).join('\n'),{now,minutes});
test('real native raid/wreck/source-debited loot for both is correlated, not called gameplay PASS',()=>{
 const r=report(sequence());
 assert.equal(r.status,'BOTH_PILOTS_LOOTED_SAME_NATIVE_WRECK');
 assert.equal(r.distinctNativeLooters,2);
 assert.equal(r.verifiedNativeLootPickups,2);
 assert.equal(r.gameplayVerified,false);
 assert.equal(r.combatParticipationVerified,false);
 assert.equal(r.missionProgressVerified,false);
 assert.equal(r.clientRenderingVerified,false);
 assert.equal(r.timeline.length,5);
 assert.equal(r.timeline[0].at,t(5));
 assert.equal(JSON.stringify(r).includes('characterID'),false);
});
test('single looter does not qualify as both and missing loot never qualifies',()=>{
 const s=sequence();s.pop();
 assert.equal(report(s).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
 s.pop();
 assert.equal(report(s).status,'PHYSICAL_RAID_WRECK_OBSERVED');
});
test('missing boot and malformed JSONL fail without phantom success',()=>{
 const s=sequence();s.shift();
 assert.equal(report(s).status,'BLOCKED_TELEMETRY');
 assert.equal(summarize(sequence().map(e=>JSON.stringify(e)).join('\n')+'\n{broken',{now}).status,'INVALID_EVENT_STREAM');
});
test('two authenticated-looking ships must be different, present, mutually visible',()=>{
 const s=sequence();s[1].mutualVisibility=false;
 assert.equal(report(s).status,'TWO_PILOTS_NOT_EVIDENCED');
 s[1].mutualVisibility=true;s[1].pilots[1].shipID=101;
 assert.equal(report(s).status,'TWO_PILOTS_NOT_EVIDENCED');
 s[1].pilots[1].shipID=102;s[1].pilots[1].shipExists=false;
 assert.equal(report(s).status,'TWO_PILOTS_NOT_EVIDENCED');
});
test('warp approach is not an attack',()=>{
 const s=sequence();s[2].actions[0].action='warp-to-hauler';
 assert.equal(report(s).status,'NATIVE_RAID_NOT_EVIDENCED');
});
test('unrelated native pirate death does not match raid',()=>{
 const s=sequence();s[3].victimEntityID=700;
 assert.equal(report(s).status,'LINKED_WRECK_NOT_EVIDENCED');
});
test('different wreck ID, pirate source or fake grant rejects second looter',()=>{
 for(const change of [{wreckID:700},{sourceEntityID:700},{status:'NATIVE_GRANT_NOT_CONFIRMED'},{quantity:0}]){
  const s=sequence();Object.assign(s.at(-1),change);
  assert.equal(report(s).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
 }
});
test('wrong-system, ghost and replacement player ship prevent pickup credit',()=>{
 const s=sequence();s.at(-1).systemID=30000142;
 assert.equal(report(s).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
 s.at(-1).systemID=30000144;s.at(-1).shipID=900;
 assert.equal(report(s).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
});
test('disconnect between native scene witness and loot invalidates stale character',()=>{
 const s=sequence();s.splice(5,0,event(17.5,'disconnect-after-persist',{characterID:2,shipID:102}));
 assert.equal(report(s).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
});
test('valid renewed shared-scene proof after reconnect allows real pickup',()=>{
 const s=sequence();s.splice(4,0,event(16,'disconnect-after-persist',{characterID:2,shipID:102}));
 s.splice(5,0,event(16.5,'coop-shared-scene',{mutualVisibility:true,pilots:[
  {characterID:1,shipID:101,shipExists:true},{characterID:2,shipID:102,shipExists:true}]}));
 assert.equal(report(s).status,'BOTH_PILOTS_LOOTED_SAME_NATIVE_WRECK');
});
test('cross-system later scene cannot borrow earlier shared presence',()=>{
 const s=sequence();s.splice(4,0,event(16,'coop-shared-scene',{systemID:30000142,mutualVisibility:true,pilots:[
  {characterID:1,shipID:101,shipExists:true},{characterID:2,shipID:102,shipExists:true}]}));
 assert.equal(report(s).status,'PHYSICAL_RAID_WRECK_OBSERVED');
});
test('old events cannot be borrowed across a new server headless boot',()=>{
 const s=sequence();s.push(event(19,'living-headless-boot-requested'));
 assert.equal(report(s).status,'TWO_PILOTS_NOT_EVIDENCED');
});
test('stale encounter time windows and clock future are rejected',()=>{
 const s=sequence();s[3].at=t(8+21*60);s[4].at=t(8+21*60+3);s[5].at=t(8+21*60+4);
 assert.equal(report(s).status,'LINKED_WRECK_NOT_EVIDENCED');
 assert.equal(report(sequence(),1).status,'BLOCKED_TELEMETRY');
 assert.throws(()=>parse('',{now,minutes:2000}),/window/);
});
test('historical wrong order pickup cannot prove wreck source debit',()=>{
 const s=sequence();s[4].at=t(14);s[5].at=t(13);
 assert.equal(report(s).status,'PHYSICAL_RAID_WRECK_OBSERVED');
});

// P0: source-debited native wreck item conservation (run by standard verifier).
{
 const {summarize,nativeReceipt,nativeLootConservation}=require('../scripts/coop-pve-chain.cjs');
 const now=Date.parse('2026-10-25T15:00:00Z');
 const stamp=s=>new Date(now-120000+s*1000).toISOString();
 const ev=(n,event,more={})=>({at:stamp(n),event,systemID:30000144,...more});
 const evidence='NATIVE_GRANT_SUCCESS_PLUS_PHYSICAL_WRECK_AND_POST_TRANSFER_SOURCE_STORE';
 const pickup=(n,{characterID,shipID,wreckItemID,quantity,remainingQuantity,typeID=34,sourceEntityID=77,wreckID=99,...extra})=>
  ev(n,'living-native-loot-pickup',{status:'VERIFIED_NATIVE_LOOT_PICKUP',
   characterID,shipID,wreckItemID,quantity,remainingQuantity,typeID,
   sourceEntityID,wreckID,destinationLocationID:shipID,evidence,...extra});
 function scene(){
  return [
   ev(0,'living-headless-boot-requested'),
   ev(1,'coop-shared-scene',{mutualVisibility:true,pilots:[
    {characterID:1,shipID:101,shipExists:true},{characterID:2,shipID:102,shipExists:true}]}),
   ev(3,'living-pirate-raid',{actions:[{action:'attack',pirateID:77,targetID:88,targetRole:'hauler'}]}),
   ev(5,'living-native-wreck-evidence',{status:'PHYSICAL_NATIVE_WRECK_VERIFIED',
    victimEntityID:77,wreckID:99,lootStatus:'ITEMS_STORED',storedItemCount:2})
  ];
 }
 const run=items=>summarize(items.map(x=>JSON.stringify(x)).join('\n'),{now});
 test('two verified separate native items debit to the correct two pilots',()=>{
  const s=[...scene(),
   pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:3,remainingQuantity:0}),
   pickup(7,{characterID:2,shipID:102,wreckItemID:902,quantity:2,remainingQuantity:0})];
  const result=run(s);
  assert.equal(result.status,'BOTH_PILOTS_LOOTED_SAME_NATIVE_WRECK');
  assert.equal(result.verifiedNativeLootPickups,2);
  assert.equal(result.gameplayVerified,false);
 });
 test('two pilots can split the exact SAME native stack, with source conserved',()=>{
  const s=[...scene(),
   pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:4}),
   pickup(7,{characterID:2,shipID:102,wreckItemID:901,quantity:4,remainingQuantity:0})];
  assert.equal(run(s).status,'BOTH_PILOTS_LOOTED_SAME_NATIVE_WRECK');
  assert.equal(nativeLootConservation(s.slice(-2)).ok,true);
 });
 test('duplicated full-stack receipt can never count as loot for both pilots',()=>{
  const s=[...scene(),
   pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:6,remainingQuantity:0}),
   pickup(7,{characterID:2,shipID:102,wreckItemID:901,quantity:6,remainingQuantity:0})];
  assert.equal(run(s).status,'NATIVE_LOOT_CHAIN_INVALID');
  assert.equal(nativeLootConservation(s.slice(-2)).reason,'NATIVE_LOOT_SOURCE_CHAIN_CONFLICT');
 });
 test('impossible partial stack debit is not two-player loot',()=>{
  const s=[...scene(),
   pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:4}),
   pickup(7,{characterID:2,shipID:102,wreckItemID:901,quantity:2,remainingQuantity:3})];
  assert.equal(run(s).status,'NATIVE_LOOT_CHAIN_INVALID');
 });
 test('later replay invalidates an otherwise apparently completed two-player pickup',()=>{
  const a=pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:2});
  const b=pickup(7,{characterID:2,shipID:102,wreckItemID:901,quantity:2,remainingQuantity:0});
  const s=[...scene(),a,b,{...b,at:stamp(8)}];
  assert.equal(run(s).status,'NATIVE_LOOT_CHAIN_INVALID');
 });
 test('missing authoritative source-debit proof never qualifies as a verified pickup',()=>{
  for(const patch of [
   {evidence:'CLIENT_CONFIRMED'},
   {evidence:null},{remainingQuantity:undefined},{remainingQuantity:-1},
   {remainingQuantity:'0'},{typeID:0},{destinationLocationID:0}
  ]){
   const good=pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:0});
   const second={...pickup(7,{characterID:2,shipID:102,wreckItemID:902,quantity:2,remainingQuantity:0}),...patch};
   assert.equal(run([...scene(),good,second]).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
  }
 });
 test('missing proof for both pickups yields only a physical wreck observation',()=>{
  const p=pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:0});
  delete p.evidence;
  assert.equal(run([...scene(),p]).status,'PHYSICAL_RAID_WRECK_OBSERVED');
 });
 test('wrong-system, wrong-source, wrong-wreck and pre-wreck receipts remain excluded',()=>{
  const good=pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:0});
  for(const patch of [{systemID:30000142},{sourceEntityID:78},{wreckID:100},
   {at:stamp(4)}]){
   const other={...pickup(7,{characterID:2,shipID:102,wreckItemID:902,quantity:1,remainingQuantity:0}),...patch};
   assert.equal(run([...scene(),good,other]).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
  }
 });
 test('a source chain from a different physical wreck cannot debit this wreck',()=>{
  const a=pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:2});
  const b=pickup(7,{characterID:2,shipID:102,wreckItemID:901,quantity:2,remainingQuantity:0,wreckID:100});
  assert.equal(nativeLootConservation([a,b]).ok,true);
  assert.equal(run([...scene(),a,b]).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
 });
 test('unrelated ghost looters cannot borrow a member identity',()=>{
  const good=pickup(6,{characterID:1,shipID:101,wreckItemID:901,quantity:2,remainingQuantity:0});
  const fake=pickup(7,{characterID:3,shipID:103,wreckItemID:902,quantity:2,remainingQuantity:0});
  assert.equal(run([...scene(),good,fake]).status,'ONE_PILOT_NATIVE_LOOT_OBSERVED');
 });
}
