import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMemory,noteVerified}=require("../integration/coopNpcMemory.cjs");
function fixture(fn){const dir=mkdtempSync(path.join(tmpdir(),"coop-memory-"));try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
const event={eventID:"mining-assault:30000142:7:456:1",pilotID:"coop-pilot-001",characterID:456,kind:"assault",systemID:30000142};
test("persistent NPC remembers a specific authenticated player and does not penalize others",()=>fixture(dir=>{
 const file=path.join(dir,"memory.json");let memory=createMemory({file});
 assert.equal(memory.remember(event).status,"RECORDED");
 assert.equal(memory.recall({pilotID:event.pilotID,characterID:456}).attitude,"WARY");
 assert.equal(memory.recall({pilotID:event.pilotID,characterID:457}).status,"UNKNOWN");
 memory=createMemory({file});
 assert.equal(memory.remember(event).status,"DUPLICATE");
 assert.equal(memory.recall({pilotID:event.pilotID,characterID:456}).encounters,1);
 assert.equal(Object.keys(JSON.parse(readFileSync(file,"utf8")).events).length,1);
}));
test("events have bounded changes, history and verified categories",()=>fixture(dir=>{
 const m=createMemory({file:path.join(dir,"memory.json")});
 for(let i=0;i<10;i++)assert.equal(m.remember({...event,eventID:"damage-"+i}).status,"RECORDED");
 assert.equal(m.recall({pilotID:event.pilotID,characterID:456}).score,-100);
 assert.equal(m.recall({pilotID:event.pilotID,characterID:456}).incidents.length,6);
 assert.equal(m.remember({...event,kind:"inventedKill",eventID:"other"}).status,"INVALID");
 assert.equal(m.remember({...event,characterID:0,eventID:"other"}).status,"INVALID");
 assert.equal(m.remember({...event,eventID:"__proto__"}).status,"RECORDED");
}));
test("fail closed on malformed state and event cap",()=>fixture(dir=>{
 const file=path.join(dir,"memory.json");
 const m=createMemory({file,maxEvents:1});
 assert.equal(m.remember(event).status,"RECORDED");
 assert.equal(m.remember({...event,eventID:"second"}).status,"CAP_REACHED");
 writeFileSync(file,'{"version":99,"events":{},"relations":{}}');
 assert.throws(()=>createMemory({file}),/invalid saved/);
}));
test("native evidence resolves actual registered named NPCs, ignores invented IDs",()=>fixture(dir=>{
 const registry=path.join(dir,"links.json"),file=path.join(dir,"memory.json");
 writeFileSync(registry,JSON.stringify({links:{a:{pilotID:"coop-pilot-001",systemID:30000142,entityID:987},
  b:{pilotID:"coop-pilot-002",systemID:30000144,entityID:988}}}));
 const old={flag:process.env.EVEJS_COOP_NPC_MEMORY,ids:process.env.EVEJS_COOP_IDENTITY_FILE,
  file:process.env.EVEJS_COOP_NPC_MEMORY_FILE};
 process.env.EVEJS_COOP_NPC_MEMORY="1";process.env.EVEJS_COOP_IDENTITY_FILE=registry;
 process.env.EVEJS_COOP_NPC_MEMORY_FILE=file;
 try{
  assert.equal(noteVerified({...event,entityIDs:[999]}).status,"NO_NAMED_NPC");
  const r=noteVerified({...event,entityIDs:[987]});
  assert.equal(r.status,"PROCESSED");assert.equal(r.results.length,1);
  assert.equal(noteVerified({...event,entityIDs:[987]}).results[0].status,"DUPLICATE");
  assert.equal(noteVerified({...event,pilotIDs:["coop-pilot-999"]}).status,"NO_NAMED_NPC");
  // A corrupt persistent identity map must not credit unrelated NPCs.
  writeFileSync(registry,JSON.stringify({links:{
   a:{pilotID:"coop-pilot-001",systemID:30000142,entityID:987},
   c:{pilotID:"coop-pilot-003",systemID:30000142,entityID:987}
  }}));
  assert.equal(noteVerified({...event,eventID:"ambiguous:987",entityIDs:[987]}).status,
   "AMBIGUOUS_NPC_IDENTITY");
 }finally{
  for(const [name,value] of [["EVEJS_COOP_NPC_MEMORY",old.flag],["EVEJS_COOP_IDENTITY_FILE",old.ids],["EVEJS_COOP_NPC_MEMORY_FILE",old.file]])
   if(value===undefined)delete process.env[name];else process.env[name]=value;
 }
}));

test("CHAT18 NPC memory fsync failure does not consume the event or increment a player twice",()=>fixture(dir=>{
 const fs=require("node:fs");
 const file=path.join(dir,"memory.json"),memory=createMemory({file});
 assert.equal(memory.remember(event).status,"RECORDED");
 const snapshot=memory.snapshot(),saved=readFileSync(file,"utf8"),old=fs.fsyncSync;
 fs.fsyncSync=()=>{throw Error("CHAT18_MEMORY_FSYNC")};
 try{assert.throws(()=>memory.remember({...event,eventID:"assault:second"}),/CHAT18_MEMORY_FSYNC/);}
 finally{fs.fsyncSync=old;}
 assert.deepEqual(memory.snapshot(),snapshot);
 assert.equal(readFileSync(file,"utf8"),saved);
 assert.equal(memory.remember({...event,eventID:"assault:second"}).status,"RECORDED");
 const restarted=createMemory({file});
 assert.equal(restarted.recall({pilotID:event.pilotID,characterID:456}).encounters,2);
 assert.equal(restarted.recall({pilotID:event.pilotID,characterID:457}).status,"UNKNOWN");
 assert.equal(restarted.remember({...event,eventID:"assault:second"}).status,"DUPLICATE");
}));
test("CHAT18 corrupt durable memory relation is never silently reset",()=>fixture(dir=>{
 const file=path.join(dir,"memory.json"),m=createMemory({file});
 m.remember(event);
 const saved=JSON.parse(readFileSync(file,"utf8"));
 saved.relations[event.pilotID+":456"].score=999;
 writeFileSync(file,JSON.stringify(saved));
 assert.throws(()=>createMemory({file}),/invalid saved NPC memory/);
}));
