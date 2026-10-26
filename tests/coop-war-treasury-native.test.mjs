import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeWarTreasury}=require("../integration/coopWarTreasuryNative.cjs");
const {TABLE,CORP_PREFIX}=require("../integration/coopWarTreasury.cjs");
const warKey="coop-faction-war\u001fstate-v1";
function fixture({npc=true,faction=11}={}){
 const rows=new Map([
  [CORP_PREFIX+31,{corporationID:31,wallet:{divisions:{
   "1000":{balance:1000,journal:[],transactions:[]}}}}],
  [warKey,{version:1,wars:{w1:{warID:"w1",state:"ACTIVE",attackerFactionID:11}},
   campaigns:{}}]
 ]);
 const gameStore={coopAtomicNativeRows:{transact:(_,fn)=>{
  const clone=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(_,key)=>clone.get(key)||null,put:(_,key,v)=>clone.set(key,v)};
  const out=fn(tx);rows.clear();for(const [k,v] of clone)rows.set(k,v);return out;
 }}};
 const service=createNativeWarTreasury({gameStore,
  env:{EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_WAR_TREASURY:"1",
   EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"},
  clock:()=>10000,
  corporationState:{getCorporationRecord:id=>id===31?{corporationID:31,isNPC:npc}:null},
  factionState:{getFactionRecord:id=>id===11?{factionID:11,militiaCorporationID:12}:null,
   getFactionIDForCorporation:id=>id===31?faction:null}});
 const cmd={type:"RESERVE",eventID:"budget:001",reservationID:"supply-001",
  corporationID:31,factionID:11,warID:"w1",campaignID:"c1",
  amountCents:15000,minRemainingCents:50000};
 return {service,cmd,rows,corp:()=>rows.get(CORP_PREFIX+31)};
}
test("real NPC corp SDE verifies wallet escrow",()=>{
 const f=fixture();assert.equal(f.service.execute(f.cmd).status,"APPLIED");
 assert.equal(f.corp().wallet.divisions["1000"].balance,850);
});
test("player corporations must never fund autonomous faction wars",()=>{
 const f=fixture({npc:false});
 assert.equal(f.service.execute(f.cmd).reason,"NATIVE_CORPORATION_WALLET_UNVERIFIED");
 assert.equal(f.corp().wallet.divisions["1000"].balance,1000);
});
test("NPC corp mapped to a different native faction cannot fund battle",()=>{
 const f=fixture({faction:22});
 assert.equal(f.service.execute(f.cmd).reason,"NATIVE_CORPORATION_WALLET_UNVERIFIED");
});
test("no release authority by default, even on ended war",()=>{
 const f=fixture();f.service.execute(f.cmd);
 f.rows.get(warKey).wars.w1.state="ENDED";
 const refund={type:"REFUND",eventID:"refund:001",
  reservationID:"supply-001",corporationID:31,proofID:"claimed-native-proof"};
 assert.equal(f.service.execute(refund).reason,"WAR_TREASURY_REFUND_NOT_AUTHORIZED");
 assert.equal(f.corp().wallet.divisions["1000"].balance,850);
});
