import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
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
