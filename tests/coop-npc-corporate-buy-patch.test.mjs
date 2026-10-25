import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-npc-corporate-buy-patch.cjs");
const {patch:guard,LINE}=require("../scripts/coop-npc-market-buy-safety-patch.cjs");
const ANCHOR='    const tradedQuantity = Math.min(remainingQuantity, availableQuantity);';
const SRC="async function marketProxy(){\n  for (const sellOrder of orders) {\n"+ANCHOR+"\n  }\n}\n";
for(const eol of ["LF","CRLF"]){
 test("native NPC buyer overlay reversible after COOP-034 guard ("+eol+")",()=>{
  const original=eol==="LF"?SRC:SRC.replace(/\n/g,"\r\n");
  const prior=guard(original),nested=patch(prior),restored=patch(nested,{remove:true});
  assert.equal(restored,prior);
  assert.equal(guard(restored,{remove:true}),original);
 });
}
test("client buyer stays default off and whole-stack only",()=>{
 const applied=patch(guard(SRC));
 assert.match(applied,/EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT !== "1"/);
 assert.match(applied,/!chargeBuyerWallet \|\| remainingQuantity < availableQuantity/);
 assert.match(applied,/remainingQuantity < availableQuantity/);
 assert.match(applied,/coopNpcCorporateBuyRuntime/);
 assert.match(applied,/npcPurchase\.grossCents \/ 100/);
});
test("patch refuses unguarded upstream market code",()=>{
 assert.throws(()=>patch(SRC),/MISSING_COOP034_DEPENDENCY/);
});
test("second application does not duplicate the settlement branch",()=>{
 const once=patch(guard(SRC));assert.equal(patch(once),once);
});
test("repeated central install never appends COOP-034 after COOP-035",()=>{
 const original=guard(SRC),native=patch(original);
 assert.equal(guard(native),native);
 const removed=patch(native,{remove:true});
 assert.equal(guard(removed,{remove:true}),SRC);
});
test("mixed old and new NPC buy guards fail closed rather than suppressing buying",()=>{
 const original=patch(guard(SRC));
 const mixed=original.replace(ANCHOR,LINE+"\n"+ANCHOR);
 assert.throws(()=>guard(mixed),/MIXED_COOP034_COOP035/);
});
test("guard rejects all not-PURCHASED results without stock seller fallback",()=>{
 const modified=patch(guard(SRC));
 assert.match(modified,/npcPurchase\?\.status !== "PURCHASED"/);
 assert.match(modified,/throw Error\("NPC_CORPORATE_MARKET_BUY_BLOCKED:/);
 assert.match(modified,/remainingQuantity -= availableQuantity/);
});

test("NPC corporate buy bypasses already-reserved buyer-wallet matching path",()=>{
 const patched=patch(guard(SRC));
 assert.ok(patched.includes("!chargeBuyerWallet || remainingQuantity < availableQuantity"));
 assert.ok(patched.indexOf("!chargeBuyerWallet")<patched.indexOf("coopNpcCorporateBuyRuntime"));
});


const runtimeSource=require("node:fs").readFileSync(
 new URL("../integration/coopNpcCorporateBuyRuntime.cjs",import.meta.url),"utf8");
function runtimeForTest({deployed=false,brokenChild=false}={}){
 let accountId=9001,destroyed=false,embedded;
 const stub={createNpcCorporateSettlement:proof=>({verify:proof.verifyBuyerSession})};
 const stores={
  "../services/market/marketDaemonClient":{marketDaemonClient:{call:()=>({})}},
  "../services/market/marketEscrowState":{getEscrowRecord:()=>null},
  "../services/corporation/corporationState":{getCorporationRecord:()=>null},
  "../services/corporation/corporationRuntimeState":{getCorporationRuntime:()=>null},
  "../services/structure/structureLocation":{getDockedLocationID:()=>60001},
  "../services/inventory/itemStore":{findItemById:()=>null},
  "../services/character/characterState":{getCharacterRecord:()=>({
   accountId,...(embedded===undefined?{}:{characterID:embedded})})},
  "../services/raffles/raffleInventory":{notifyInventoryChangesToCharacter:()=>{}},
  "../gameStore":{coopAtomicNativeRows:{}}
 };
 const loaded=[];
 const m={exports:{}};
 const load=id=>{
  loaded.push(id);
  if(id==="./coopNpcCorporateSettlement"||id==="./coopNpcCorporateSettlement.cjs"){
   if((id.endsWith(".cjs")&&!deployed)||(!id.endsWith(".cjs")&&deployed)){
    if(brokenChild){const error=Error("Cannot find module './broken-corporate-child'");
     error.code="MODULE_NOT_FOUND";throw error;}
    return stub;
   }
   const error=Error("Cannot find module '"+id+"'");error.code="MODULE_NOT_FOUND";
   throw error;
  }
  if(!Object.hasOwn(stores,id))throw Error("UNEXPECTED_IMPORT:"+id);
  return stores[id];
 };
 new Function("module","require","process",runtimeSource)(m,load,{env:{}});
 return {runtime:m.exports,loaded,session:()=>({characterID:701,charid:701,
  userid:9001,socket:{destroyed}}),
  setAccount:v=>{accountId=v},setDestroyed:v=>{destroyed=v},
  setEmbedded:v=>{embedded=v}};
}
test("native COOP-035 buyer accepts keyed character record without embedded ID",()=>{
 const f=runtimeForTest(),s=f.session();
 assert.equal(f.runtime.makeForSession(s).verify(701,60001),true);
 assert.equal(f.runtime.makeForSession(s).verify(701,60002),false);
});
test("native COOP-035 buyer rejects account mismatch, alias conflict, disconnected session and spoofed embedded ID",()=>{
 const f=runtimeForTest(),s=f.session();
 f.setAccount(9002);
 assert.equal(f.runtime.makeForSession(s).verify(701,60001),false);
 f.setAccount(9001);f.setEmbedded(702);
 assert.equal(f.runtime.makeForSession(s).verify(701,60001),false);
 f.setEmbedded(undefined);
 assert.throws(()=>f.runtime.makeForSession({...s,charid:702}),/AUTHENTICATED_SESSION_REQUIRED/);
 f.setDestroyed(true);
 assert.equal(f.runtime.makeForSession(f.session()).verify(701,60001),false);
});
test("COOP-035 source checkout uses .cjs sibling without altering deployed .js lookup",()=>{
 const local=runtimeForTest(),overlay=runtimeForTest({deployed:true});
 assert.equal(typeof local.runtime.makeForSession,"function");
 assert.ok(local.loaded.includes("./coopNpcCorporateSettlement.cjs"));
 assert.equal(overlay.loaded.includes("./coopNpcCorporateSettlement.cjs"),false);
});
test("COOP-035 runtime does not hide a missing transitive native dependency",()=>{
 assert.throws(()=>runtimeForTest({deployed:true,brokenChild:true}),
  /broken-corporate-child/);
});
