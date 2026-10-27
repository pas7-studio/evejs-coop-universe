import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);
const {planLevy,createWarChestFunding,TABLE,CORP_PREFIX}=
 require("../integration/coopWarChestFunding.cjs");

const flags=()=>({EVEJS_COOP_FACTION_WAR:"1",
 EVEJS_COOP_WAR_TREASURY:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"});
const pilots=[
 {pilotID:"coop-pilot-001",systemID:30000145,factionID:500014},
 {pilotID:"coop-pilot-002",systemID:30000144,factionID:500014},
 {pilotID:"coop-pilot-050",systemID:30000142,factionID:500011},
];
const ledger=()=>({version:1,pilots:{
 "coop-pilot-001":{balance:172100,lastTradeAt:1,tradeCount:4},
 "coop-pilot-002":{balance:0,lastTradeAt:1,tradeCount:1},
 "coop-pilot-050":{balance:0,lastTradeAt:1,tradeCount:1}}});

test("a levy takes only a real earned balance of the faction's own pilots",()=>{
 const plan=planLevy({factionID:500014,pilots,ledger:ledger(),needCents:5000000});
 assert.equal(plan.status,"FUNDED");
 assert.equal(plan.totalCents,5000000);
 assert.deepEqual(plan.sources.map(s=>s.pilotID),["coop-pilot-001"]);
 // An empty balance and a foreign pilot can never fund the chest.
 assert.equal(planLevy({factionID:500011,pilots,ledger:ledger(),needCents:100}).status,
  "REFUSED");
 assert.equal(planLevy({factionID:500011,pilots,ledger:ledger(),needCents:100}).reason,
  "NO_REAL_FACTION_INCOME");
 assert.equal(planLevy({factionID:500014,pilots,ledger:ledger(),needCents:17210001}).reason,
  "INSUFFICIENT_REAL_INCOME");
});

test("the chest moves real earned ISK into the native wallet, never more",()=>{
 const f=fixture();
 const result=f.chest.fund(fund());
 assert.equal(result.status,"APPLIED",JSON.stringify(result));
 assert.equal(f.wallet().balance,50000);
 assert.equal(f.wallet().journal.length,1);
 assert.equal(f.wallet().journal[0].amount,50000);
 assert.equal(f.wallet().journal[0].ownerID1,1000129);
 assert.equal(f.earned("coop-pilot-001"),122100);
 assert.equal(f.journal().entries[Object.keys(f.journal().entries)[0]].phase,"COMMITTED");
});

test("a repeated levy event is exactly once, and a foreign faction cannot fund",()=>{
 const f=fixture();
 assert.equal(f.chest.fund(fund()).status,"APPLIED");
 assert.equal(f.chest.fund(fund()).status,"DUPLICATE");
 assert.equal(f.wallet().balance,50000);
 assert.equal(f.earned("coop-pilot-001"),122100);
 const wrong=f.chest.fund(fund({factionID:500020,eventID:"bounty:c1:500020"}));
 assert.equal(wrong.status,"BLOCKED");
 assert.equal(wrong.reason,"WAR_CHEST_NOT_A_WAR_PARTY");
});

test("a source that cannot pay blocks the whole credit instead of minting",()=>{
 const f=fixture();
 f.earned("coop-pilot-001");
 f.drain("coop-pilot-001");
 const result=f.chest.fund(fund());
 assert.equal(result.status,"BLOCKED");
 assert.match(result.reason,/WAR_CHEST_SOURCE_UNPAID/);
 assert.equal(f.wallet().balance,0);
 assert.equal(f.wallet().journal.length,0);
});

test("a wallet row that is not a real NPC faction corporation is refused",()=>{
 const f=fixture();
 f.denyCorporation();
 const result=f.chest.fund(fund());
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.reason,"NATIVE_CORPORATION_WALLET_UNVERIFIED");
 assert.equal(f.earned("coop-pilot-001"),172100);
});

test("a crash after the debit is finished by recover, never by a new plan",()=>{
 const f=fixture();
 f.failCredit();
 assert.equal(f.chest.fund(fund()).status,"BLOCKED");
 assert.equal(f.earned("coop-pilot-001"),122100);
 assert.equal(f.wallet().balance,0);
 f.allowCredit();
 const recovered=f.chest.recover();
 assert.equal(recovered.status,"RECOVERED");
 assert.equal(f.wallet().balance,50000);
 // A second recovery must not credit twice.
 assert.equal(f.chest.recover().status,"CLEAN");
 assert.equal(f.wallet().balance,50000);
});

test("a bounty credit is real ISK back to the pilot and exactly once",()=>{
 const f=fixture();
 const paid=f.chest.creditPilot({pilotID:"coop-pilot-050",cents:2500000,
  eventID:"war-bounty:c1:wreck:1",reason:"war bounty"});
 assert.equal(paid.status,"APPLIED");
 assert.equal(f.earned("coop-pilot-050"),25000);
 assert.equal(f.chest.creditPilot({pilotID:"coop-pilot-050",cents:2500000,
  eventID:"war-bounty:c1:wreck:1"}).status,"DUPLICATE");
 assert.equal(f.earned("coop-pilot-050"),25000);
});

test("the feature is off unless the war treasury flags are on",()=>{
 const f=fixture({env:{}});
 assert.equal(f.chest.fund(fund()).status,"DISABLED");
 assert.equal(f.wallet().balance,0);
 assert.equal(f.earned("coop-pilot-001"),172100);
});

function fund(extra={}){
 return {factionID:500014,corporationID:1000129,warID:"war:500011-500014",
  campaignID:"war:500011-500014:campaign:30000143",needCents:5000000,
  pilots,ledger:ledger(),eventID:"bounty:war:500011-500014:campaign:30000143:500014",
  ...extra};
}

function fixture({env=flags()}={}){
 const records=new Map();
 const balances=new Map([["coop-pilot-001",172100],["coop-pilot-002",0],
  ["coop-pilot-050",0]]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"war-chest-"));
 const journalFile=path.join(dir,"journal.json");
 const seen=new Map();
 let corporationOK=true,failCredit=false,transactCalls=0,failAfter=-1;
 records.set(TABLE+":"+CORP_PREFIX+1000129,{corporationID:1000129,
  wallet:{divisions:{"1000":{key:1000,balance:0,journal:[],transactions:[]}}}});
 const war={wars:{"war:500011-500014":{warID:"war:500011-500014",state:"ACTIVE",
  attackerFactionID:500011,defenderFactionID:500014}},campaigns:{}};
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,[TABLE]);
  transactCalls++;
  if(failCredit&&failAfter>=0&&transactCalls>failAfter)
   throw Error("NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN");
  const draft=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(t,k)=>draft.get(t+":"+k)||null,
   put:(t,k,v)=>{draft.set(t+":"+k,structuredClone(v))}};
  const outcome=fn(tx);
  records.clear();for(const [k,v] of draft)records.set(k,v);
  return outcome;
 }}};
 const chest=createWarChestFunding({gameStore,env,journalFile,
  readWarState:()=>war,
  clock:()=>100000,
  adjustEarned:({pilotID,cents:delta,eventID})=>{
   const applied=seen.get(eventID);
   if(applied)return {status:"DUPLICATE",receipt:applied};
   const before=balances.get(pilotID)||0;
   const afterCents=Math.round(before*100)+delta;
   if(afterCents<0)return {status:"INSUFFICIENT_EARNED_ISK"};
   const after=afterCents/100;
   balances.set(pilotID,after);
   const receipt={pilotID,cents:delta,before,after,at:100000};
   seen.set(eventID,receipt);
   return {status:"APPLIED",receipt};
  },
  verifyCorporation:()=>corporationOK});
 const wallet=()=>records.get(TABLE+":"+CORP_PREFIX+1000129).wallet.divisions["1000"];
 return {chest,wallet,war,
  journal:()=>JSON.parse(fs.readFileSync(journalFile,"utf8")),
  earned:id=>balances.get(id),
  drain:id=>balances.set(id,0),
  denyCorporation:()=>{corporationOK=false},
  failCredit:()=>{failCredit=true;failAfter=transactCalls+1},
  allowCredit:()=>{failCredit=false;failAfter=-1},
  get threw(){return threw}};
}
