import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {readyPilots,findParty}=require('../integration/coopDuoCoordinator.cjs');
function fixture(){
 const a={characterID:1001,socket:{destroyed:false},_space:{systemID:30000144,shipID:501,initialStateSent:true}};
 const b={characterID:1002,socket:{destroyed:false},_space:{systemID:30000144,shipID:502,initialStateSent:true}};
 const ships=new Map([[501,{kind:'ship',itemID:501,session:a,position:{x:0,y:0,z:0}}],
  [502,{kind:'ship',itemID:502,session:b,position:{x:100,y:0,z:0}}]]);
 const scene={systemID:30000144,sessions:new Map([[11,a],[12,b]]),getEntityByID:id=>ships.get(id)};
 return {a,b,ships,scene};
}
test('two independent native pilots can form a physical party',()=>{
 const f=fixture();assert.equal(readyPilots(f.scene,30000144).length,2);
 assert.equal(findParty(f.scene,30000144)?.pilots.length,2);
});
test('one disconnected pilot leaves the other intact and has no party',()=>{
 const f=fixture();f.a.socket.destroyed=true;
 assert.deepEqual(readyPilots(f.scene,30000144).map(x=>x.characterID),[1002]);
 assert.equal(findParty(f.scene,30000144),null);
});
test('duplicate character prevents a false two-pilot formation',()=>{
 const f=fixture();f.scene.sessions.set(13,{...f.a,socket:{destroyed:false}});
 assert.equal(readyPilots(f.scene,30000144).length,1);
 assert.equal(findParty(f.scene,30000144),null);
});
test('two accounts claiming the same ship are both excluded',()=>{
 const f=fixture();f.b._space.shipID=501;
 assert.equal(readyPilots(f.scene,30000144).length,0);
 assert.equal(findParty(f.scene,30000144),null);
});
test('foreign physical pilot identity or session binding is excluded',()=>{
 const f=fixture();f.ships.get(501).pilotCharacterID=1002;
 assert.equal(readyPilots(f.scene,30000144).length,1);
 delete f.ships.get(501).pilotCharacterID;
 f.ships.get(501).session=f.b;
 assert.equal(readyPilots(f.scene,30000144).length,1);
});
test('wrong-system duplicate character blocks same-system owner',()=>{
 const f=fixture();f.scene.sessions.set(13,{characterID:1001,socket:{destroyed:false},
  _space:{systemID:30000142,shipID:601,initialStateSent:true}});
 assert.equal(readyPilots(f.scene,30000144).length,1);
});
