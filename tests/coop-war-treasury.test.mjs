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
function fixture({funds=1000,refundable=true,corporationOK=true,payable=true,
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
   (row?.corporationID===undefined||row?.corporationID===31),
  authorizeRefund:()=>refundable,authorizePayout:()=>payable});
 const wallet=()=>records.get(TABLE+":"+CORP_PREFIX+31).wallet.divisions["1000"];
 const state=()=>records.get(TABLE+":"+KEY);
 return {treasury,records,war,wallet,state,env,corp,deny:()=>corporationOK=false,
  prohibit:()=>refundable=false,denyPayout:()=>payable=false,
  throws:()=>throws=true,get writes(){return writes}};
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
 // The defender is a real war party and may fund its own chest; a faction that
 // is not in this war never can.
 assert.equal(f.treasury.execute(reserve({factionID:33})).reason,
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

// FW-005C: a HELD escrow is released to one named pilot. The wallet was already
// debited at RESERVE time, so a payout moves no new ISK and can never mint.
const payout=(extra={})=>({type:"PAYOUT",eventID:"fw:bounty:w1:c1",
 reservationID:"supply-w1-c1",corporationID:31,proofID:"wreck:9001",pilotID:7,...extra});
function withCampaign(f){
 const stored=f.records.get(TABLE+":coop-faction-war\u001fstate-v1");
 stored.campaigns={c1:{campaignID:"c1",warID:"w1",state:"ASSAULT"}};
 f.records.set(TABLE+":coop-faction-war\u001fstate-v1",stored);
}
test("a real bounty leaves HELD escrow for one named pilot, once",()=>{
 const f=fixture();
 assert.equal(f.treasury.execute(reserve()).status,"APPLIED");
 assert.equal(f.wallet().balance,875);
 withCampaign(f);
 const paid=f.treasury.execute(payout());
 assert.equal(paid.status,"APPLIED",JSON.stringify(paid));
 assert.equal(paid.receipt.amountCents,12500);
 assert.equal(paid.receipt.pilotID,7);
 assert.equal(paid.receipt.escrowJournalID,8000000000000000);
 // No second debit and no refund of the same value.
 assert.equal(f.wallet().balance,875);
 assert.equal(f.wallet().journal.length,1);
 assert.equal(f.state().reservations["supply-w1-c1"].status,"PAID");
 assert.equal(f.state().reservations["supply-w1-c1"].paidToPilotID,7);
 assert.equal(f.treasury.execute(payout()).status,"DUPLICATE");
 assert.equal(f.treasury.execute(reserve({eventID:"fw:reserve:w1:c2",
  reservationID:"supply-w1-c2"})).reason,"WAR_TREASURY_PURPOSE_UNAVAILABLE");
});
test("a payout without a real proof, campaign or authorization never releases value",()=>{
 const f=fixture();
 f.treasury.execute(reserve());
 withCampaign(f);
 assert.equal(f.treasury.execute(payout({proofID:""})).reason,
  "INVALID_TREASURY_PAYOUT");
 assert.equal(f.treasury.execute(payout({pilotID:0})).reason,
  "INVALID_TREASURY_PAYOUT");
 f.denyPayout();
 assert.equal(f.treasury.execute(payout()).reason,
  "WAR_TREASURY_PAYOUT_NOT_AUTHORIZED");
 assert.equal(f.state().reservations["supply-w1-c1"].status,"HELD");
 assert.equal(f.wallet().balance,875);
});
test("a payout for a campaign that does not exist is refused",()=>{
 const f=fixture();
 f.treasury.execute(reserve());
 assert.equal(f.treasury.execute(payout()).reason,"WAR_TREASURY_PURPOSE_UNAVAILABLE");
 assert.equal(f.state().reservations["supply-w1-c1"].status,"HELD");
});
test("a real stock wallet row (keyed, no corporationID field) is accepted",()=>{
 const f=fixture();
 const key=TABLE+":"+CORP_PREFIX+31;
 const row=f.records.get(key);
 delete row.corporationID;
 f.records.set(key,row);
 const result=f.treasury.execute(reserve());
 assert.equal(result.status,"APPLIED",JSON.stringify(result));
 assert.equal(f.wallet().balance,875);
});
test("a corrupted PAID row without its proof is never accepted",()=>{ const f=fixture();
 f.treasury.execute(reserve());
 withCampaign(f);
 f.treasury.execute(payout());
 const stored=f.state();
 delete stored.reservations["supply-w1-c1"].payoutProofID;
 f.records.set(TABLE+":"+KEY,stored);
 assert.throws(()=>f.treasury.snapshot(),/WAR_TREASURY_CORRUPT_PAYOUT/);
});
