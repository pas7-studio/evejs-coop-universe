import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createTactics}=require("../integration/coopNpcTactics.cjs");
const npc=(itemID,x,y=0)=>({itemID,kind:"ship",position:{x,y,z:0},mode:"STOP"});
const anchors=[{id:44,kind:"station",name:"Safety Station",position:{x:2000000,y:0,z:0}}];
function setup({now=1000000,ships=[],assignments=[],controllers={},
 health=()=>({armor:1,structure:1}),scrambled=()=>false,additionalResponders=()=>0}={}){
 let current=now;
 const entities=new Map(ships.map(s=>[s.itemID,s])),orders=[],events=[];
 const scene={getEntityByID:id=>entities.get(id)};
 const tactics=createTactics({
  clock:()=>current,warpToPoint:(id,p)=>{orders.push({type:"retreat",id,p});return {success:true}},
  warpToEntity:(id,target)=>{orders.push({type:"respond-warp",id,target});return {success:true}},
  attack:(id,target)=>{orders.push({type:"attack",id,target});return {success:true}},
  resumeBehavior:id=>{orders.push({type:"resume",id});return {success:true}},
  stopOrder:id=>{orders.push({type:"stop",id});return {success:true}},
  notify:event=>events.push(event)
 });
 const tick=()=>tactics.tick({systemID:30000142,scene,assignments,
  controllers,health,isScrambled:scrambled,waypoints:anchors,additionalResponders});
 return {tick,orders,events,tactics,entities,advance:ms=>{current+=ms}};
}
test("real damage and attacker trigger native warp retreat to existing safe station",()=>{
 const victim=npc(101,0),attacker=npc(990,10000);
 const a=setup({ships:[victim,attacker],assignments:[{pilotID:"coop-pilot-001",entityID:101,role:"trader",faction:"frontier"}],
  controllers:{101:{lastAggressorID:990,lastAggressedAtMs:999900}},
  health:entity=>entity===victim?{armor:0.15,structure:0.9}:{armor:1,structure:1}});
 const first=a.tick();
 assert.ok(first.events.some(e=>e.kind==="npc-retreat"&&e.destinationID===44));
 assert.deepEqual(a.orders.map(e=>e.type),["retreat"]);
 a.advance(31000);
 assert.ok(a.tick().events.some(e=>e.kind==="npc-tactical-standdown"));
 assert.deepEqual(a.orders.map(e=>e.type),["retreat","stop"]);
 a.advance(91000);
 assert.ok(a.tick().events.some(e=>e.kind==="npc-tactical-recovered"));
 assert.deepEqual(a.orders.map(e=>e.type),["retreat","stop","resume"]);
 assert.equal(victim.mode,"STOP"); // Native EveJS owns actual warp physics.
 assert.equal(a.tick().events.filter(e=>e.kind==="npc-retreat").length,0);
});
test("warp scrambler and no real safe point never fake a retreat or kill",()=>{
 const victim=npc(101,0),attacker=npc(990,10000);
 const a=setup({ships:[victim,attacker],assignments:[{pilotID:"coop-pilot-001",entityID:101,role:"trader",faction:"frontier"}],
  controllers:{101:{lastAggressorID:990,lastAggressedAtMs:999900}},
  health:()=>({armor:0.1,structure:0.5}),scrambled:()=>true});
 assert.equal(a.tick().events.length,0);
 assert.equal(a.orders.length,0);
});
test("a distressed civilian calls only existing same-faction patrol ships; no wave NPC spawned",()=>{
 const a=setup({ships:[npc(101,0),npc(201,11000),npc(202,33000),npc(203,12000),npc(990,20000)],
  assignments:[
   {pilotID:"coop-pilot-001",entityID:101,role:"miner",faction:"frontier"},
   {pilotID:"coop-pilot-002",entityID:201,role:"patrol",faction:"frontier"},
   {pilotID:"coop-pilot-003",entityID:202,role:"patrol",faction:"frontier"},
   {pilotID:"coop-pilot-004",entityID:203,role:"patrol",faction:"enemy"}
  ],controllers:{101:{lastAggressorID:990,lastAggressedAtMs:999900}},
  health:()=>({armor:1,structure:1})});
 const result=a.tick();
 assert.equal(result.events.filter(e=>e.kind==="npc-help-request").length,1);
 assert.equal(result.events.filter(e=>e.kind==="reinforcement-attack").length,2);
 assert.deepEqual(a.orders.map(x=>x.id).sort(),[201,202]);
 assert.equal(a.tactics.activeIDs().size,2);
 assert.equal(a.tick().events.filter(e=>e.kind==="npc-help-request").length,0);
});
test("an allied attacker never causes friendly-fire call-ins",()=>{
 const a=setup({ships:[npc(101,0),npc(201,11000),npc(990,20000)],
  assignments:[
   {pilotID:"coop-pilot-001",entityID:101,role:"trader",faction:"frontier"},
   {pilotID:"coop-pilot-002",entityID:201,role:"patrol",faction:"frontier"},
   {pilotID:"coop-pilot-003",entityID:990,role:"pirate",faction:"frontier"}
  ],controllers:{101:{lastAggressorID:990,lastAggressedAtMs:999900}}});
 assert.equal(a.tick().events.length,0);
 assert.equal(a.orders.length,0);
});
test("long-distance backup warps to attacker and actually engages after physical arrival",()=>{
 const helper=npc(201,0),target=npc(990,1000000);
 const a=setup({ships:[npc(101,800000),helper,target],
  assignments:[{pilotID:"coop-pilot-001",entityID:101,role:"hauler",faction:"frontier"},
   {pilotID:"coop-pilot-002",entityID:201,role:"patrol",faction:"frontier"}],
  controllers:{101:{lastAggressorID:990,lastAggressedAtMs:999900}}});
 assert.equal(a.tick().events.find(e=>e.responderID===201)?.kind,"reinforcement-warp");
 helper.position.x=990000;
 a.advance(31000);
 const result=a.tick();
 assert.ok(result.events.some(e=>e.kind==="reinforcement-attack"&&e.responderID===201));
 assert.deepEqual(a.orders.map(x=>x.type),["respond-warp","attack"]);
});

test("a known repeat aggressor can summon one more existing patrol, never a spawned ship",()=>{
 const ships=[npc(101,0),npc(201,11000),npc(202,12000),npc(203,13000),npc(990,20000)];
 const assignments=[
  {pilotID:"coop-pilot-001",entityID:101,role:"miner",faction:"frontier"},
  ...[201,202,203].map((id,i)=>({pilotID:"coop-pilot-"+String(i+2).padStart(3,"0"),
   entityID:id,role:"patrol",faction:"frontier"}))
 ];
 const a=setup({ships,assignments,
  controllers:{101:{lastAggressorID:990,lastAggressedAtMs:999900}},
  additionalResponders:()=>1});
 const out=a.tick();
 assert.equal(out.events.filter(e=>e.kind==="reinforcement-attack").length,3);
 assert.equal(a.orders.length,3);
 assert.deepEqual(a.orders.map(e=>e.id).sort(),[201,202,203]);
});
