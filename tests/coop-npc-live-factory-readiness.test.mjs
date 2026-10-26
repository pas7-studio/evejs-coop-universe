import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAuditedLiveFactoryDirector}=require("../integration/coopNpcLiveFactoryReadiness.cjs");
const OP="npc-manufacture:"+"a".repeat(32),OWNER=1000035,STATION=60010001;
function fixture(){
 let writes=0,reads=0;
 const journal={version:1,entries:{},history:{}};
 const director={mode:"NATIVE_AUTHORITIES_ONLY",supportsLiveRuntime:true,
  inspect:()=>{reads++;return structuredClone(journal)},
  tick:ctx=>{writes++;return{status:"PREPARED",ownerID:ctx.ownerID,
   stationID:ctx.stationID,productTypeIDs:ctx.productTypeIDs}}};
 const native={getJob:()=>null,getItem:()=>null,getIndustryDebit:()=>null};
 const market={getOrder:()=>null,getSaleEvidence:()=>[],getWalletEntry:()=>null};
 const create=()=>createAuditedLiveFactoryDirector({
  director,native,market,clock:()=>1000});
 return{director,journal,native,market,create,
  get writes(){return writes},get reads(){return reads}};
}
test("manual or structurally unverified native director cannot obtain a live wrapper",()=>{
 const f=fixture();f.director.supportsLiveRuntime=false;
 assert.throws(f.create,/LIVE_FACTORY_ORIGINAL_DIRECTOR_NOT_ATTESTED/);
 f.director.supportsLiveRuntime=true;f.director.mode="VIRTUAL_ONLY";
 assert.throws(f.create,/LIVE_FACTORY_ORIGINAL_DIRECTOR_NOT_ATTESTED/);
});
test("clean original source journal permits exactly one delegated native action",()=>{
 const f=fixture(),live=f.create();
 const r=live.tick({ownerID:OWNER,stationID:STATION,productTypeIDs:[215]});
 assert.equal(r.status,"PREPARED");assert.equal(f.writes,1);
 assert.equal(f.reads,2);
 assert.equal(live.mode,"NATIVE_AUTHORITIES_ONLY");
 assert.equal(live.supportsLiveRuntime,true);
});
test("a missing/invalid scope cannot reach the real native writer",()=>{
 const f=fixture(),live=f.create();
 const r=live.tick({ownerID:0,stationID:STATION});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.detail,"NPC_INDUSTRY_RECOVERY_SCOPE_INVALID");
 assert.equal(f.writes,0);
});
test("ambiguous original SQLite outcome is rejected even on direct tick bypass",()=>{
 const f=fixture();f.journal.entries[OP]={
  operationID:OP,ownerID:OWNER,stationID:STATION,typeID:215,
  phase:"INSTALL_UNKNOWN",createdAt:100,
  plan:{ownerID:OWNER,stationID:STATION,productTypeID:215,
   blueprintItemID:77,outputQuantity:10}};
 const live=f.create(),r=live.tick({ownerID:OWNER,stationID:STATION});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.detail,"NPC_INDUSTRY_RECOVERY_OUTCOME_UNKNOWN");
 assert.equal(r.operationID,OP);
 assert.equal(f.writes,0);
});
test("an earlier READY witness is never cached across later native writes",()=>{
 const f=fixture(),live=f.create();
 assert.equal(live.auditBeforeTick({ownerID:OWNER,stationID:STATION}).status,"READY");
 f.journal.entries[OP]={operationID:OP,ownerID:OWNER,stationID:STATION,
  typeID:215,phase:"LIST_UNKNOWN",createdAt:100,
  plan:{ownerID:OWNER,stationID:STATION,productTypeID:215,
   blueprintItemID:77,outputQuantity:10}};
 assert.equal(live.tick({ownerID:OWNER,stationID:STATION}).status,"BLOCKED");
 assert.equal(f.writes,0);
});
test("fresh audit is performed again for every successful native factory cycle",()=>{
 const f=fixture(),live=f.create();
 assert.equal(live.tick({ownerID:OWNER,stationID:STATION}).status,"PREPARED");
 assert.equal(live.tick({ownerID:OWNER,stationID:STATION}).status,"PREPARED");
 assert.equal(f.reads,4);
 assert.equal(f.writes,2);
});
test("recovery wrapper is pure coordinator, has no independent wallet or SQLite writes",()=>{
 const src=fs.readFileSync(new URL("../integration/coopNpcLiveFactoryReadiness.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(src,/\.transact\(|\.installOnce\(|\.deliverOnce\(|\.listOnce\(/);
});
