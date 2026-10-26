import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarTreasury,TABLE,KEY,CORP_PREFIX,cents}=
 require("../integration/coopWarTreasury.cjs");
const flags=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_WAR_TREASURY:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"});
const reserve=(extra={})=>({type:"RESERVE",eventID:"fw:reserve:w1:c1",
 reservationID:"supply-w1-c1",corporationID:31,
 factionID:11,warID:"w1",campaignID:"c1",
 amountCents:12500,minRemainingCents:75000,...extra});
const refund=(extra={})=>({type:"REFUND",eventID:"fw:refund:w1:c1",
 reservationID:"supply-w1-c1",corporationID:31,
 proofID:"operator-reviewed-unspent",...extra});
function fixture({funds=1000,refundable=true,corporationOK=true,
  env=flags()}={}){
 const records=new Map();
 const corp={corporationID:31,wallet:{divisions:{
  "1000":{balance:funds,journal:[],transactions:[],marketTransactions:[]}}}};
 const war={version:1,wars:{w1:{warID:"w1",state:"ACTIVE",
  attackerFactionID:11,defenderFactionID:22}},campaigns:{}};
 records.set(TABLE+":"+CORP_PREFIX+31,structuredClone(corp));
 records.set(TABLE+":coop-faction-war\u001fstate-v1",structuredClone(war));
 let writes=0,throws=false;
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,[TABLE]);
  if(throws)throw Error("NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN");
  const draft=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(t,k)=>draft.get(t+":"+k)||null,
   put:(t,k,v)=>{draft.set(t+":"+k,structuredClone(v));writes++}};
  const outcome=fn(tx);
  records.clear();for(const [k,v] of draft)records.set(k,v);
  return outcome;
 }}};
 const treasury=createWarTreasury({gameStore,env,clock:()=>100000,
  verifyCorporation:({corporationID,factionID},row)=>
   corporationOK&&corporationID===31&&factionID===11&&
   row?.corporationID===31,
  authorizeRefund:()=>refundable});
 const wallet=()=>records.get(TABLE+":"+CORP_PREFIX+31).wallet.divisions["1000"];
 const state=()=>records.get(TABLE+":"+KEY);
 return {treasury,records,war,wallet,state,env,corp,deny:()=>corporationOK=false,
  prohibit:()=>refundable=false,throws:()=>throws=true,get writes(){return writes}};
}
test("real native corporation ISK leaves spendable wallet exactly once",()=>{
 const f=fixture();
 const r=f.treasury.execute(reserve());
 assert.equal(r.status,"APPLIED");
 assert.equal(f.wallet().balance,875);
 assert.equal(f.state().reservations["supply-w1-c1"].status,"HELD");
 assert.equal(f.wallet().journal.length,1);
 assert.equal(f.wallet().transactions[0].amount,-125);
 assert.equal(f.treasury.execute(reserve()).status,"DUPLICATE");
 assert.equal(f.wallet().balance,875);
 assert.equal(f.wallet().journal.length,1);
 assert.equal(f.state().nextJournalID,8000000000000001);
});
test("atomic escrow refund returns exactly the reserved cents, never duplicates",()=>{
 const f=fixture();f.treasury.execute(reserve());
 // Ending the war is the immutable prerequisite for releasing funds.
 f.records.get(TABLE+":coop-faction-war\u001fstate-v1").wars.w1.state="ENDED";
 assert.equal(f.treasury.execute(refund()).status,"APPLIED");
 assert.equal(f.wallet().balance,1000);
 assert.equal(f.state().reservations["supply-w1-c1"].status,"REFUNDED");
 assert.equal(f.treasury.execute(refund()).status,"DUPLICATE");
 assert.equal(f.wallet().journal.length,2);
 assert.equal(f.wallet().transactions[1].amount,125);
});
test("active war blocks refunds even when caller requests them",()=>{
 const f=fixture();f.treasury.execute(reserve());
 assert.equal(f.treasury.execute(refund()).reason,"WAR_TREASURY_STILL_IN_USE");
 assert.equal(f.wallet().balance,875);
});
test("low available funds, minimum reserve and noncent balance deny reservations",()=>{
 const f=fixture();
 assert.equal(f.treasury.execute(reserve({amountCents:95000})).reason,
  "WAR_TREASURY_FUNDS_UNAVAILABLE");
 assert.equal(f.wallet().balance,1000);
 const g=fixture({funds:100.001});
 assert.equal(g.treasury.execute(reserve()).reason,
  "NATIVE_CORPORATION_WALLET_UNVERIFIED");
});
test("wrong faction, ended war, owner proof and repeated reservation never debit",()=>{
 const f=fixture();
 assert.equal(f.treasury.execute(reserve({factionID:22})).reason,
  "WAR_TREASURY_FACTION_MISMATCH");
 f.war.wars.w1.state="ENDED";
 f.records.set(TABLE+":coop-faction-war\u001fstate-v1",f.war);
 assert.equal(f.treasury.execute(reserve()).reason,
  "WAR_TREASURY_PURPOSE_UNAVAILABLE");
 f.war.wars.w1.state="ACTIVE";f.records.set(TABLE+":coop-faction-war\u001fstate-v1",f.war);
 f.deny();
 assert.equal(f.treasury.execute(reserve()).reason,
  "NATIVE_CORPORATION_WALLET_UNVERIFIED");
 assert.equal(f.wallet().balance,1000);
});
test("failed native SQLite transaction never returns false funded receipt",()=>{
 const f=fixture();f.throws();
 assert.throws(()=>f.treasury.execute(reserve()),/NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN/);
 assert.equal(f.wallet().balance,1000);
 assert.equal(f.state(),undefined);
});
test("event replay with altered command fails and refund needs native approval",()=>{
 const f=fixture();f.treasury.execute(reserve());
 assert.equal(f.treasury.execute(reserve({amountCents:15000})).reason,
  "WAR_TREASURY_EVENT_CONFLICT");
 f.records.get(TABLE+":coop-faction-war\u001fstate-v1").wars.w1.state="ENDED";
 f.prohibit();
 assert.equal(f.treasury.execute(refund()).reason,
  "WAR_TREASURY_REFUND_NOT_AUTHORIZED");
 assert.equal(f.wallet().balance,875);
});
test("feature flag defaults OFF, corrupted stored ledger never yields authorization",()=>{
 const f=fixture();f.env.EVEJS_COOP_WAR_TREASURY="0";
 assert.equal(f.treasury.execute(reserve()).status,"DISABLED");
 f.env.EVEJS_COOP_WAR_TREASURY="1";
 f.records.set(TABLE+":"+KEY,{version:99,reservations:{},processed:{}});
 assert.throws(()=>f.treasury.snapshot(),/WAR_TREASURY_INVALID/);
 assert.equal(f.wallet().balance,1000);
});
test("native currency preserves cents and rejects imaginary fractional ISK",()=>{
 assert.equal(cents(1.01),101);
 assert.equal(cents(0),0);
 assert.equal(cents(5.999),null);
 assert.equal(cents(NaN),null);
});
