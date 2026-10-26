import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {evaluate,allowJump,POCHVEN_REGION_ID,TRIGLAVIAN_FACTION_ID}=require('../integration/coopPochvenConduit.cjs');
const {patch,ANCHOR,HOOK,FILE}=require('../scripts/coop-pochven-conduit-patch.cjs');
const S=1001,D=1002,K=1003;
function fixture({src='Senda',dst='Archee',toRegion=POCHVEN_REGION_ID,fromRegion=POCHVEN_REGION_ID}={}){
 const sourceGate={itemID:6001,solarSystemID:S,destinationSolarSystemID:D,destinationID:6002};
 const destinationGate={itemID:6002,solarSystemID:D,destinationSolarSystemID:S,destinationID:6001};
 const systems=new Map([[S,{solarSystemID:S,solarSystemName:src,regionID:fromRegion}],
 [D,{solarSystemID:D,solarSystemName:dst,regionID:toRegion}]]);
 const gates=new Map([[S,[sourceGate]],[D,[destinationGate]]]);
 const worldData={getSolarSystemByID:id=>systems.get(id),getStargatesForSystem:id=>gates.get(id)};
 const standing=new Map([[101,6],[102,0]]);
 const getRawStanding=(charID,factionID)=>{assert.equal(factionID,TRIGLAVIAN_FACTION_ID);return standing.get(charID)??0;};
 const ships=new Map([[101,{itemID:1101,typeID:587,ownerID:101}],[102,{itemID:1102,typeID:587,ownerID:102}]]);
 const types=new Map([[587,{typeID:587,categoryID:6,groupID:25}]]);
 const resolveItemByTypeID=id=>types.get(id);
 const ctx=(charID=101)=>({session:{characterID:charID,_space:{systemID:S,shipID:1000+charID}},sourceGate,destinationGate,worldData,getRawStanding,activeShip:ships.get(charID),resolveItemByTypeID});
 return {ctx,standing,ships,types,systems,gates,sourceGate,destinationGate,worldData};
}
test('two independent authenticated characters use same real native gate pair; only eligible enters Home',()=>{
 const f=fixture();const a=evaluate(f.ctx(101)),b=evaluate(f.ctx(102));
 assert.equal(a.allowed,true);assert.equal(b.allowed,false);
 assert.equal(b.reason,'POCHVEN_HOME_REQUIRES_6_RAW_TRIGLAVIAN_STANDING');
 assert.equal(a.destID,D);assert.equal(a.classification,'home');
 // Native persisted standings read again: no overlay standing is created.
 f.standing.set(102,6);
 assert.equal(evaluate(f.ctx(102)).allowed,true);
 assert.equal(evaluate(f.ctx(101)).allowed,true);
});
test('6.00 exactly grants Home; 5.99 and negative do not; destination, never origin, is gated',()=>{
 const f=fixture(); f.standing.set(101,5.99);assert.equal(allowJump(f.ctx()),false);
 f.standing.set(101,6);assert.equal(allowJump(f.ctx()),true);
 f.standing.set(101,-10);assert.equal(allowJump(f.ctx()),false);
 const reverse=fixture({src:'Archee',dst:'Senda'});reverse.standing.set(101,-10);
 assert.equal(evaluate(reverse.ctx()).allowed,true);
});
test('Border/Internal do not demand 0/1/3 raw standings in the current rule',()=>{
 for(const name of ['Otela','Raravoss','Sakenta','Ahtila','Wirashoda']){
  const f=fixture({dst:name});f.standing.set(101,-10);
  assert.equal(evaluate(f.ctx()).allowed,true,name);
 }
});
test('no ordinary static stargate may cross the Pochven/k-space regional boundary',()=>{
 for(const args of [{fromRegion:POCHVEN_REGION_ID,toRegion:10000002},{fromRegion:10000002,toRegion:POCHVEN_REGION_ID}]){
  assert.equal(evaluate(fixture(args).ctx()).reason,'POCHVEN_NOT_REACHABLE_BY_KSPACE_GATE');
 }
});
test('ordinary native k-space gates pass unchanged with their real counterpart',()=>{
 const f=fixture({fromRegion:10000002,toRegion:10000002});
 assert.deepEqual(evaluate(f.ctx()),{allowed:true,reason:'NON_POCHVEN_NATIVE_GATE',sourceID:S,destID:D});
});
test('rejected if source/destination SDE links are not reciprocal or cataloged',()=>{
 const mutators=[
  f=>{f.sourceGate.destinationID=999},
  f=>{f.destinationGate.destinationID=999},
  f=>{f.sourceGate.destinationSolarSystemID=K},
  f=>{f.destinationGate.destinationSolarSystemID=K},
  f=>{f.sourceGate.solarSystemID=K},
  f=>{f.gates.set(D,[])},
  f=>{f.gates.set(S,[])},
  f=>{f.systems.delete(D)},
  f=>{f.systems.get(D).regionID=0},
 ];
 for(const mutate of mutators){const f=fixture();mutate(f);assert.equal(allowJump(f.ctx()),false);}
});
test('native stargates without redundant destinationSolarSystemID remain topology-verifiable',()=>{
 const f=fixture();delete f.sourceGate.destinationSolarSystemID;delete f.destinationGate.destinationSolarSystemID;
 assert.equal(allowJump(f.ctx()),true);
});
test('unverified native Pochven system names are not treated as unlocked internal systems',()=>{
 for(const dst of ['Unknown','',null,'Niarja ']){
  const f=fixture({dst});
  // Whitespace is normalized ONLY for the canonical known name.
  assert.equal(allowJump(f.ctx()),dst==='Niarja ');
 }
});
test('an absent, mismatched or reused source character/ship cannot authorize any jump',()=>{
 const cases=[
  x=>{x.session.characterID=999},x=>{x.session._space.shipID=1112},
  x=>{x.session._space.systemID=999},x=>{x.session._space=null},
  x=>{x.activeShip.itemID=999},x=>{x.activeShip=null},
  x=>{x.session.characterID=0},x=>{x.session._space.shipID=0}
 ];
 for(const mutate of cases){const f=fixture();const x=f.ctx();mutate(x);assert.equal(allowJump(x),false);}
});
test('forbidden capital hull native type group blocked; unknown category/type fails closed',()=>{
 for(const groupID of [30,485,513,547,659,883,902,1538]){
  const f=fixture();f.types.set(587,{typeID:587,categoryID:6,groupID});
  assert.equal(evaluate(f.ctx()).reason,'POCHVEN_CAPITAL_CONDUIT_FORBIDDEN');
 }
 const unknown=fixture();unknown.types.set(587,{typeID:587,categoryID:6,groupID:999});
 assert.equal(evaluate(unknown.ctx()).reason,'POCHVEN_HULL_GROUP_NOT_VERIFIED_SUBCAPITAL');
 for(const invalid of [null,{typeID:587,groupID:25,categoryID:0},{typeID:999,groupID:25,categoryID:6},
  {typeID:587,groupID:0,categoryID:6}]){
  const f=fixture();f.types.set(587,invalid);
  assert.equal(evaluate(f.ctx()).reason,'POCHVEN_NATIVE_HULL_CLASS_UNVERIFIED');
 }
});
test('native missing or malformed standing refuses Home rather than granting free access',()=>{
 for(const v of [NaN,undefined,Infinity,-Infinity,'6',null]){
  const f=fixture();const x=f.ctx();x.getRawStanding=()=>v;
  assert.equal(allowJump(x),false,String(v));
 }
 const f=fixture();const x=f.ctx();x.getRawStanding=()=>{throw Error('db unavailable')};
 assert.equal(evaluate(x).reason,'POCHVEN_STANDINGS_UNAVAILABLE');
});
test('reconnect uses independently refreshed native session and standing, not an in-memory permission token',()=>{
 const f=fixture();const initial=f.ctx();assert.equal(allowJump(initial),true);
 f.standing.set(101,0);
 const reconnected=f.ctx();assert.notEqual(initial.session,reconnected.session);
 assert.equal(allowJump(reconnected),false);
 f.standing.set(101,7);assert.equal(allowJump(reconnected),true);
});
test('native warp/wormhole jump code is never patched or replaced by Pochven Conduit guard',()=>{
 const method='function jumpSessionViaStargate(session,fromStargateID,toStargateID) {\n'+ANCHOR+'\n    return false;\n  }\n  return nativeJump();\n}\n';
 const out=patch(method,FILE,false);
 assert.ok(out.includes(HOOK));
 assert.equal(patch(out,FILE,false),out);
 assert.equal(patch(out,FILE,true),method);
 const others='function completeWormholeJump() { return jumpSessionToSolarSystem(); }';
 assert.throws(()=>patch(others,FILE,false),/ANCHOR_MISMATCH/);
 assert.equal(out.slice(0,out.indexOf('function jumpSessionViaStargate')),method.slice(0,method.indexOf('function jumpSessionViaStargate')));
 new vm.Script(out);
});
test('native patch supports CRLF idempotent apply and byte-for-byte restoration',()=>{
 const src=('function jumpSessionViaStargate(session) {\n'+ANCHOR+'\n    return false;\n  }\n  return nativeJump();\n}\n').replace(/\n/g,'\r\n');
 const patched=patch(src);assert.ok(patched.includes(HOOK+'\r\n'+ANCHOR));
 assert.equal(patch(patched),patched);assert.equal(patch(patched,FILE,true),src);
 assert.throws(()=>patch(src,'server/src/space/unrelated.js'),/UNSUPPORTED/);
 assert.throws(()=>patch(src+src),/ANCHOR_MISMATCH/);
 assert.throws(()=>patch(src.replace(ANCHOR,HOOK+'\r\n'+HOOK+'\r\n'+ANCHOR)),/PARTIAL_PATCH/);
});
