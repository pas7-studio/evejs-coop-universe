import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createTactics}=require('../integration/coopNpcTactics.cjs');
const {authorize}=require('../integration/coopPveRetaliationGuard.cjs');
const systemID=30000144;
const ship=(itemID,nativeNpc,x)=>({itemID,kind:'ship',nativeNpc,position:{x,y:0,z:0},mode:'STOP'});
function harness({allow=true,aggressionAgeMs=1000,duplicate=false,disconnected=false}={}){
 const now=1000000, victim=ship(101,true,0),helper=ship(102,true,4000),attacker=ship(901,false,10000);
 const objects=new Map([victim,helper,attacker].map(s=>[s.itemID,s]));
 const session={characterID:77,_space:{shipID:901,systemID,initialStateSent:true},socket:{destroyed:disconnected}};
 const scene={systemID,sessions:new Map([[77,session]]),getEntityByID:id=>objects.get(id)};
 if(duplicate)scene.sessions.set(78,{...session,characterID:78,socket:{destroyed:false}});
 const aggression={entityID:101,systemID,lastAggressorID:901,lastAggressedAtMs:now-aggressionAgeMs};
 const orders=[];
 const tactics=createTactics({clock:()=>now,
  warpToPoint:()=>({success:false}),warpToEntity:()=>({success:false}),
  attack:(id,targetID)=>{orders.push({id,targetID});return {success:true}},
  stopOrder:()=>({success:false}),resumeBehavior:()=>({success:false}),
  authorizePlayerDefense:context=>allow&&authorize({...context,
   verifiedCharacterID:77,aggression,now})});
 const result=tactics.tick({systemID,scene,
  assignments:[
   {pilotID:'coop-pilot-001',entityID:101,systemID,role:'pirate',faction:'raiders'},
   {pilotID:'coop-pilot-002',entityID:102,systemID,role:'pirate',faction:'raiders'}
  ],controllers:{101:aggression,102:{entityID:102,systemID}},
  health:()=>({armor:1,structure:1})});
 return {result,orders};
}
test('authenticated player actually attacks: allied native pirate counterattacks, no synthetic ship',()=>{
 const {orders,result}=harness();
 assert.deepEqual(orders,[{id:102,targetID:901}]);
 assert.equal(result.events.filter(e=>e.kind==='reinforcement-attack').length,1);
 assert.equal(result.events.filter(e=>e.kind==='npc-help-request').length,1);
});
test('feature OFF leaves existing NPC AI unable to order reactive player attack',()=>{
 assert.deepEqual(harness({allow:false}).orders,[]);
});
test('late, duplicate and disconnected players cannot trigger NPC reinforcement',()=>{
 for(const scenario of [{aggressionAgeMs:120001},{duplicate:true},{disconnected:true}])
  assert.deepEqual(harness(scenario).orders,[]);
});
