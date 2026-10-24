import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconnectPilot} from '../scripts/coop-reconnect-guard.mjs';
function pilot(clientID,characterID,shipID){return {clientID,characterID,socket:{destroyed:false},_space:{shipID}};}
function setup(){
 const a=pilot(1,101,901),b=pilot(2,102,902),members=new Set([a,b]);
 const registry={register(s){members.add(s)},unregister(s){members.delete(s)}};
 const scene={sessions:new Map([[1,a],[2,b]]),dynamicEntities:new Map([[901,{itemID:901}],[902,{itemID:902}]])};
 return {a,b,scene,registry,members};
}
test('replacement keeps ship ownership and other pilot unchanged',()=>{
 const {a,b,scene,registry,members}=setup(),replacement=pilot(3,101,901);
 const out=reconnectPilot(scene,registry,a,replacement);
 assert.deepEqual(out,{characterID:101,shipID:901,clientID:3});
 assert.equal(scene.sessions.size,2);assert.equal(scene.sessions.get(2),b);
 assert.equal(scene.sessions.get(3),replacement);assert.equal(members.has(a),false);
 assert.equal(members.has(b),true);assert.equal(members.has(replacement),true);
});
test('cross-character reconnect rejected without modifying registry or scene',()=>{
 const {a,scene,registry,members}=setup();
 assert.throws(()=>reconnectPilot(scene,registry,a,pilot(3,102,901)),/identity mismatch/);
 assert.equal(scene.sessions.get(1),a);assert.equal(members.has(a),true);
});
test('duplicate connection and duplicate ship both rejected',()=>{
 const {a,scene,registry}=setup();
 assert.throws(()=>reconnectPilot(scene,registry,a,pilot(2,101,901)),/Duplicate active ownership/);
 assert.throws(()=>reconnectPilot(scene,registry,null,pilot(3,103,902)),/Duplicate active ownership/);
});
test('reconnect to unknown ship rejected before cleanup',()=>{
 const {a,scene,registry}=setup();
 assert.throws(()=>reconnectPilot(scene,registry,a,pilot(3,101,999)),/not present/);
 assert.equal(scene.sessions.get(1),a);
});
