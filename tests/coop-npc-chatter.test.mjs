import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createChatter}=require("../integration/coopNpcChatter.cjs");

const SYS=30100032;
const ship=(itemID)=>({itemID,kind:"ship"});
const resident=(pilotID,role,entityID)=>({pilotID,role,entityID,name:"Talon Voss"});
const session=(characterID,systemID=SYS)=>({characterID,_space:{systemID,initialStateSent:true},socket:{destroyed:false}});

function harness({ships={},residents=[],sessions=[session(140000005)],clockRef={now:0},fail=false,limits={}}={}){
 const sent=[];
 const chatter=createChatter({
  send:(target,text)=>{ if(fail) throw new Error("chat down"); sent.push({to:target.characterID,text}); },
  clock:()=>clockRef.now,
  cooldownMs:limits.cooldownMs||120000,
  maxPerMinute:limits.maxPerMinute||4
 });
 const scene={getEntityByID:id=>ships[id]||null};
 const speak=()=>chatter.speak({systemID:SYS,residents,scene,sessions});
 return {sent,speak,clockRef};
}

test("speaks only about a resident that is already a physical ship in the scene",()=>{
 const h=harness({ships:{980000000150:ship(980000000150)},
  residents:[resident("coop-pilot-006","miner",980000000151),resident("coop-pilot-010","pirate",980000000150)]});
 const out=h.speak();
 assert.equal(out.status,"SPOKEN");
 assert.equal(out.pilotID,"coop-pilot-010","skips the resident without a physical native ship");
 assert.equal(h.sent.length,1);
 assert.match(h.sent[0].text,/%s|Talon Voss/);
});

test("nothing is said when no local pilot has a ready session in the system",()=>{
 const h=harness({ships:{980000000150:ship(980000000150)},
  residents:[resident("coop-pilot-010","pirate",980000000150)],sessions:[]});
 assert.equal(h.speak().status,"NO_LOCAL_AUDIENCE");
 assert.equal(h.sent.length,0);
});

test("a pilot speaks once per cooldown, then the system cap stops further lines",()=>{
 const ships={};
 const residents=[];
 for(let i=0;i<6;i++){ ships[980000000200+i]=ship(980000000200+i); residents.push(resident(`coop-pilot-10${i}`,"patrol",980000000200+i)); }
 const h=harness({ships,residents,limits:{cooldownMs:120000,maxPerMinute:2}});
 assert.equal(h.speak().status,"SPOKEN");
 assert.equal(h.speak().status,"SPOKEN");
 assert.equal(h.speak().status,"RATE_LIMITED");
 assert.equal(h.sent.length,2);
 h.clockRef.now=61000;
 assert.equal(h.speak().status,"SPOKEN","a new minute window resets the cap");
 h.clockRef.now=183000;
 const repeated=h.speak();
 assert.equal(repeated.status,"SPOKEN","a different pilot may speak after the pilot cooldown");
});

test("a chat failure is reported instead of crashing the world tick",()=>{
 const h=harness({ships:{980000000150:ship(980000000150)},
  residents:[resident("coop-pilot-010","pirate",980000000150)],fail:true});
 assert.equal(h.speak().status,"DELIVERY_FAILED");
});
