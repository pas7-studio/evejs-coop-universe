import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
function harness(){
 const src=fs.readFileSync(new URL("../integration/coopDuoCoordinator.cjs",import.meta.url),"utf8");
 const shipA={itemID:1001,kind:"ship",mode:"STOP",position:{x:0,y:0,z:0}};
 const shipB={itemID:1002,kind:"ship",mode:"STOP",position:{x:50000,y:0,z:0}};
 const a={characterID:501,_space:{systemID:30000144,shipID:1001,initialStateSent:true},
  socket:{destroyed:false}};
 const b={characterID:502,_space:{systemID:30000144,shipID:1002,initialStateSent:true},
  socket:{destroyed:false}};
 const scene={systemID:30000144,
  sessions:new Map([[501,a]]),getEntityByID:id=>id===1001?shipA:id===1002?shipB:null};
 const events=[],greetings=[],module={exports:{}};
 const requireMock=id=>{
  if(id==="./runtime")return {getSceneForSession:()=>scene};
  if(id==="./coopRuntimeProbe")return {observe:(name,_session,_ship,details)=>
   events.push({name,...details})};
  if(id==="./coopDuoPresence")return {observe:()=>({status:"SERVER_OBSERVATION"})};
  if(id==="./coopPartyNotices")return {createNotices:()=>({
   rendezvous:details=>{greetings.push(details.party.pilots.map(p=>p.characterID));return {status:"SENT",sent:2};}
  })};
  if(id==="./coopNativeNpcDemo")return {maybeSpawn:()=>false};
  throw Error("Unexpected dependency: "+id);
 };
 vm.runInNewContext(src,{
  module,exports:module.exports,require:requireMock,console,process:{
   env:{EVEJS_COOP_REQUIRE_TWO_PILOTS:"1",EVEJS_COOP_PARTY_NOTICES:"1"}
  },setInterval:()=>({unref:()=>{}}),clearInterval:()=>{}
 },{filename:"coopDuoCoordinator.cjs"});
 return {logic:module.exports,shipA,shipB,scene,a,b,events,greetings};
}
test("LivingCoop joins two real sessions on grid and sends exactly one native rendezvous",()=>{
 const f=harness();
 assert.equal(f.logic.register(f.a,f.shipA),true);
 assert.equal(f.greetings.length,0);
 f.scene.sessions.set(502,f.b);
 assert.equal(f.logic.register(f.b,f.shipB),true);
 assert.deepEqual(f.greetings.map(row=>Array.from(row)),[[501,502]]);
 assert.equal(f.events.some(e=>e.name==="coop-party-proximity"&&e.ready===true),true);
 f.logic.tick();
 assert.equal(f.greetings.length,1);
});
test("two pilots in different systems cannot create fictitious co-op encounter",()=>{
 const f=harness();
 f.b._space.systemID=30000142;
 f.scene.sessions.set(502,f.b);
 f.logic.register(f.a,f.shipA);
 assert.equal(f.logic.register(f.b,f.shipB),true);
 assert.equal(f.greetings.length,0);
});
test("one ship in warp must not count as the physically assembled duo",()=>{
 const f=harness();
 f.shipB.mode="WARP";
 f.scene.sessions.set(502,f.b);
 f.logic.register(f.a,f.shipA);
 f.logic.register(f.b,f.shipB);
 assert.equal(f.greetings.length,0);
});
