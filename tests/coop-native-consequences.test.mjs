import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
const require=createRequire(import.meta.url);
const {createConsequences}=require("../integration/coopNativeConsequences.cjs");

function run(fn){
 const dir=mkdtempSync(join(tmpdir(),"evejs-consequences-"));
 try{return fn(join(dir,"standing-events.json"));}
 finally{rmSync(dir,{recursive:true,force:true});}
}
test("mining assault writes one native standing change per 15-minute period and survives restart",()=>run(file=>{
 let now=1_000_000;
 const applied=[];
 const make=()=>createConsequences({file,clock:()=>now,apply:row=>{
  applied.push(row);return {success:true};
 }});
 const first=make();
 const event={characterID:70001,ownerID:500010,systemID:30000142,fleetID:7,occurredAt:now};
 assert.equal(first.onMiningAggression(event).status,"APPLIED");
 assert.equal(first.onMiningAggression(event).status,"DUPLICATE");
 assert.equal(make().onMiningAggression(event).status,"DUPLICATE");
 assert.equal(applied.length,1);
 assert.equal(applied[0].rawChange,-0.25);
 assert.equal(applied[0].ownerID,500010);
 now+=16*60*1000;
 assert.equal(make().onMiningAggression({...event,occurredAt:now}).status,"APPLIED");
 assert.equal(applied.length,2);
}));
test("native NPC pirate kill requires credited player and valid victim faction; defense is a separate evidenced reward",()=>run(file=>{
 const applied=[];
 const journal=createConsequences({file,apply:e=>{applied.push(e);return {success:true}}});
 assert.equal(journal.onPirateKill({characterID:0,ownerID:500010,systemID:30000142,wreckID:77}).status,"IGNORED_UNATTRIBUTED");
 assert.equal(journal.onPirateKill({characterID:70001,ownerID:500010,systemID:30000142,wreckID:77}).status,"APPLIED");
 assert.equal(journal.onPirateKill({characterID:70001,ownerID:500010,systemID:30000142,wreckID:77}).status,"DUPLICATE");
 assert.equal(journal.onMinerDefense({characterID:70001,ownerID:500001,systemID:30000142,wreckID:77}).status,"APPLIED");
 assert.deepEqual(applied.map(x=>x.rawChange),[-0.12,0.18]);
 assert.equal(journal.snapshot().totals.defense,1);
}));
test("failed authoritative standing update remains journaled and does not double-apply on retry",()=>run(file=>{
 let attempts=0;
 const make=()=>createConsequences({file,apply:()=>{attempts++;return {success:false,errorMsg:"STANDING_NOT_AVAILABLE"}}});
 const event={characterID:70001,ownerID:500001,systemID:30000142,fleetID:3,occurredAt:10000};
 assert.equal(make().onMiningAggression(event).status,"REJECTED");
 assert.equal(make().onMiningAggression(event).status,"DUPLICATE");
 assert.equal(attempts,1);
}));
