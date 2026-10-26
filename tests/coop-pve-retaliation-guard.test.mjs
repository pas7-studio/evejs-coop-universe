import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {authorize}=require('../integration/coopPveRetaliationGuard.cjs');
const systemID=30000144,now=1000000;
const ship=(itemID,nativeNpc,x)=>({itemID,kind:'ship',nativeNpc,position:{x,y:0,z:0}});
function fixture(){
 const victim=ship(101,true,0),helper=ship(102,true,4000),attacker=ship(901,false,10000);
 const session={characterID:77,_space:{shipID:901,systemID,initialStateSent:true},socket:{destroyed:false}};
 const entities=new Map([victim,helper,attacker].map(s=>[s.itemID,s]));
 const scene={systemID,sessions:new Map([[77,session]]),getEntityByID:x=>entities.get(x)};
 return {systemID,scene,victim,helper,attacker,session,verifiedCharacterID:77,
  aggression:{lastAggressorID:901,lastAggressedAtMs:now-30000},now};
}
test('recent verified native aggression allows defending the attacked NPC',()=>{
 assert.equal(authorize(fixture()),true);
});
test('no recent exact aggressor never authorizes an NPC attack on a player',()=>{
 for(const aggression of [undefined,{}, {lastAggressorID:902,lastAggressedAtMs:now-1},
   {lastAggressorID:901,lastAggressedAtMs:now+1},
   {lastAggressorID:901,lastAggressedAtMs:now-120001},
   {lastAggressorID:901,lastAggressedAtMs:'999990'}])
  assert.equal(authorize({...fixture(),aggression}),false);
});
test('fake or disconnected attacker, wrong system, duplicate sessions and hull swaps fail closed',()=>{
 const checks=[
  f=>{f.session.socket.destroyed=true;},
  f=>{f.session._space.shipID=902;},
  f=>{f.session._space.systemID=30000142;},
  f=>{f.session._space.initialStateSent=false;},
  f=>{f.verifiedCharacterID=78;},
  f=>{f.scene.systemID=30000142;},
  f=>{f.scene.sessions.set(88,{...f.session,characterID:77,socket:{destroyed:false}});},
  f=>{f.scene.sessions.set(88,{...f.session,characterID:78,socket:{destroyed:false}});},
  f=>{f.scene.sessions.delete(77);}
 ];
 for(const change of checks){const f=fixture();change(f);assert.equal(authorize(f),false);}
});
test('refuse absent, wrong-kind, fake, reused or nonphysical NPCs',()=>{
 const checks=[
  f=>{f.victim.nativeNpc=false;},
  f=>{f.helper.nativeNpc=false;},
  f=>{f.attacker.nativeNpc=true;},
  f=>{f.helper.itemID=101;},
  f=>{f.attacker.kind='drone';},
  f=>{f.helper.position.x=Infinity;},
  f=>{f.victim.position.x=400000;},
  f=>{f.scene.getEntityByID=()=>null;},
  f=>{f.victim.session={characterID:5};}
 ];
 for(const change of checks){const f=fixture();change(f);assert.equal(authorize(f),false);}
});
test('exact 120-second aggression boundary and range boundary',()=>{
 const f=fixture();f.aggression.lastAggressedAtMs=now-120000;
 f.attacker.position.x=250000;
 assert.equal(authorize(f),true);
 f.attacker.position.x=250001;
 assert.equal(authorize(f),false);
});
test('stale, malformed or out-of-range clock/config fails closed',()=>{
 for(const change of [f=>{f.now=-1;},f=>{f.now=1.5;},
  f=>{f.maxRangeMeters=500000;},f=>{f.maxRangeMeters=NaN;}]){
  const f=fixture();change(f);assert.equal(authorize(f),false);
 }
});
