import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeFactionProofs}=require('../integration/coopFactionWarNativeProofs.cjs');
const native={getFaction:id=>id===11?{factionID:11,militiaCorporationID:21}:
 id===22?{factionID:22,militiaCorporationID:23}:null,
 getSystem:id=>({solarSystemID:id,factionID:id===101?11:22}),
 getGates:id=>id===101?[{itemID:801,solarSystemID:101}]:[],
 getGate:id=>id===801?{itemID:801,solarSystemID:101,destinationID:802}:
 id===802?{itemID:802,solarSystemID:102,destinationID:801}:null};
test('native SDE identity and territory original owner require exact ID match',()=>{
 const p=createNativeFactionProofs(native);
 assert.equal(p.territory({systemID:101,ownerFactionID:11}),true);
 assert.equal(p.territory({systemID:101,ownerFactionID:22}),false);
 assert.equal(p.territory({systemID:102,ownerFactionID:22}),true);
 assert.equal(p.territory({systemID:999,ownerFactionID:88}),false);
});
test('requires reciprocal native stargates and same-system physical identifiers',()=>{
 const p=createNativeFactionProofs(native);
 assert.equal(p.adjacency({sourceSystemID:101,targetSystemID:102}),true);
 assert.equal(p.adjacency({sourceSystemID:102,targetSystemID:101}),false);
 const wrong=createNativeFactionProofs({...native,getGate:id=>id===802?
  {itemID:802,solarSystemID:102,destinationID:999}:native.getGate(id)});
 assert.equal(wrong.adjacency({sourceSystemID:101,targetSystemID:102}),false);
});
test('real factions never automatically imply war, supply or conquest permission',()=>{
 const p=createNativeFactionProofs(native);
 assert.equal(p.declaration({warID:'x',attackerFactionID:11,defenderFactionID:22}),false);
 assert.equal(p.supply(),false);assert.equal(p.capture(),false);
 const verified=createNativeFactionProofs({...native,allowDeclaration:()=>true});
 assert.equal(verified.declaration({warID:'x',attackerFactionID:11,defenderFactionID:22}),true);
});
