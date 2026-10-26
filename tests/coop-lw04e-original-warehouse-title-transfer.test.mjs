import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOriginalWarehouseTitleTransfer,TABLES}=require("../integration/coopNpcOriginalWarehouseTitleTransfer.cjs");
const SEP="\u001f",SOURCE=1000001,FACTORY=1000035;
const CARGO=777,ITEM=1990000707,STATION=60010001,TYPE=34,QTY=50;
const OP="coop-warehouse-title:v1:"+CARGO+":"+FACTORY;
const FLAGS={EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NATIVE_WAREHOUSE_TITLE_TRANSFER_PROOF:"1",
 EVEJS_COOP_NATIVE_NPC_CORP_TRANSFER_PAYMENT_PROOF:"1"};
function fixture({env=FLAGS,throwAfterCommit=false}={}){
 const tables={items:new Map(),corporationRuntime:new Map()};
 const clone=v=>structuredClone(v);
 const put=(t,k,v)=>tables[t].set(String(k),clone(v));
 const get=(t,k)=>clone(tables[t].get(String(k))??null);
 const ore={itemID:ITEM,ownerID:SOURCE,locationID:STATION,flagID:4,
  typeID:TYPE,quantity:QTY,stacksize:QTY,singleton:0,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 put("items",ITEM,ore);
 const corp=(id,balance)=>({corporationID:id,wallet:{
  divisions:{"1000":{balance,transactions:[],journal:[]}}}});
 put("corporationRuntime","corporations"+SEP+SOURCE,corp(SOURCE,100));
 put("corporationRuntime","corporations"+SEP+FACTORY,corp(FACTORY,40));
 const grant={phase:"COMPLETED",cargoID:CARGO,ownerID:SOURCE,
  stationID:STATION,typeID:TYPE,quantity:QTY,oreItemID:ITEM,before:0,after:50,
  sourceCustomInfo:"coop-warehouse:v1:cargo:"+CARGO,completedAt:1000};
 let priceCents=1250,authorized=true,poisoned=false,commits=0,attempts=0;
 const authority={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>poisoned,
  transact:(included,fn)=>{
   assert.deepEqual(included,TABLES);attempts++;
   if(poisoned)throw Error("ORIGINAL_GAMESTORE_POISONED");
   const before=Object.fromEntries(included.map(k=>[k,new Map([...tables[k]].map(([a,v])=>[a,clone(v)]))]));
   const tx={
    get:(t,k)=>{if(!included.includes(t))throw Error("BAD_TABLE");const v=before[t].get(String(k));return v==null?null:clone(v)},
    put:(t,k,v)=>{if(!included.includes(t))throw Error("BAD_TABLE");before[t].set(String(k),clone(v))},
    del:(t,k)=>before[t].delete(String(k)),
    scan:t=>[...before[t]].map(([key,value])=>({key,value:clone(value)}))
   };
   const result=fn(tx);
   if(result&&typeof result.then==="function")throw Error("ASYNC_NATIVE_TRANSACTION_REJECTED");
   for(const t of included)tables[t]=before[t];
   commits++;
   if(throwAfterCommit)throw Error("SQLITE_COMMIT_ACK_LOST");
   return result;
  }};
 const gameStore={coopAtomicNativeRows:authority};
 const itemStore={findItemById:id=>get("items",id)};
 const inputs={cargoID:CARGO,oreItemID:ITEM,sourceOwnerID:SOURCE,
  buyerOwnerID:FACTORY,stationID:STATION,typeID:TYPE,quantity:QTY,
  maxPriceCents:1250,operatorGrant:"operator-authorized"};
 const create=()=>createOriginalWarehouseTitleTransfer({gameStore,itemStore,
  verifySourceGrant:()=>clone(grant),
  verifyNpcOwner:id=>id===SOURCE||id===FACTORY,
  verifyStation:({stationID})=>stationID===STATION,
  authorizeTransfer:({operatorGrant})=>authorized&&operatorGrant==="operator-authorized",
  quoteTransfer:()=>({verifiedNative:true,operationID:OP,ownerID:SOURCE,
   buyerOwnerID:FACTORY,stationID:STATION,itemID:ITEM,
   typeID:TYPE,quantity:QTY,priceCents}),
  clock:()=>100000,env});
 const balance=id=>get("corporationRuntime","corporations"+SEP+id).wallet.divisions["1000"].balance;
 const ledger=id=>get("corporationRuntime","corporations"+SEP+id).wallet.divisions["1000"];
 return {create,gameStore,grant,inputs,put,get,ore,balance,ledger,
  setPrice:n=>{priceCents=n},deny:()=>{authorized=false},
  poison:()=>{poisoned=true},
  get commits(){return commits},get attempts(){return attempts}};
}
test("real GameStore scope atomically moves original ore item and balances two corp wallets",()=>{
 const f=fixture(),result=f.create().transferOnce(f.inputs);
 assert.equal(result.status,"TITLE_TRANSFERRED");
 assert.equal(f.get("items",ITEM).ownerID,FACTORY);
 assert.equal(f.get("items",ITEM).itemID,ITEM);
 assert.equal(f.get("items",ITEM).quantity,QTY);
 assert.equal(f.balance(SOURCE),112.5);
 assert.equal(f.balance(FACTORY),27.5);
 assert.equal(f.ledger(SOURCE).transactions[0].transactionID,OP);
 assert.equal(f.ledger(FACTORY).transactions[0].transactionID,OP);
 assert.equal(f.get("corporationRuntime","coopWarehouseTitleTransfer"+SEP+CARGO).priceCents,1250);
 assert.equal(f.commits,1);
});
test("original source-only ore quantity cannot be duplicated by a second native call",()=>{
 const f=fixture(),first=f.create().transferOnce(f.inputs);
 const snapshot=structuredClone({item:f.get("items",ITEM),
  seller:f.ledger(SOURCE),buyer:f.ledger(FACTORY)});
 const second=f.create().transferOnce(f.inputs);
 assert.equal(first.status,"TITLE_TRANSFERRED");
 assert.equal(second.status,"ALREADY_TRANSFERRED");
 assert.deepEqual({item:f.get("items",ITEM),
  seller:f.ledger(SOURCE),buyer:f.ledger(FACTORY)},snapshot);
});
test("restart replay after ore was refined cannot mint an original item or re-debit wallets",()=>{
 const f=fixture();assert.equal(f.create().transferOnce(f.inputs).status,"TITLE_TRANSFERRED");
 f.gameStore.coopAtomicNativeRows.transact(TABLES,tx=>{tx.del("items",String(ITEM));return null});
 const before=f.balance(FACTORY);
 const again=f.create().transferOnce(f.inputs);
 assert.equal(again.status,"ALREADY_TRANSFERRED");
 assert.equal(f.get("items",ITEM),null);
 assert.equal(f.balance(FACTORY),before);
});
test("original warehouse company cannot give other NPC its ore for free",()=>{
 const f=fixture();f.setPrice(0);
 assert.equal(f.create().transferOnce(f.inputs).reason,"LW04E_ORIGINAL_CORPORATE_PRICE_UNVERIFIED");
 assert.equal(f.balance(SOURCE),100);
 assert.equal(f.balance(FACTORY),40);
 assert.equal(f.commits,0);
});
test("buyer corporation with insufficient real ISK refuses transfer atomically",()=>{
 const f=fixture();f.setPrice(5000);
 const a=f.create().transferOnce({...f.inputs,maxPriceCents:5000});
 assert.match(a.reason,/NATIVE_BUYER_INSUFFICIENT_ISK/);
 assert.equal(f.get("items",ITEM).ownerID,SOURCE);
 assert.equal(f.ledger(FACTORY).transactions.length,0);
 assert.equal(f.commits,0);
});
test("invalid warehouse cargo receipt denies before GameStore writer",()=>{
 const f=fixture();f.grant.ownerID=FACTORY;
 assert.equal(f.create().transferOnce(f.inputs).reason,"LW04E_NATIVE_STATION_GRANT_NOT_ATTESTED");
 assert.equal(f.attempts,0);
});
test("merged warehouse stack without unique cargo marker never transfers another source",()=>{
 const f=fixture();f.put("items",ITEM,{...f.ore,customInfo:"other-ore-source"});
 const a=f.create().transferOnce(f.inputs);
 assert.match(a.reason,/ORIGINAL_ITEM_CUSTODY_CHANGED/);
 assert.equal(f.get("items",ITEM).ownerID,SOURCE);
});
test("duplicate original cargo provenance in different native itemIDs blocks transfer",()=>{
 const f=fixture();f.put("items",ITEM+1,{...f.ore,itemID:ITEM+1});
 assert.match(f.create().transferOnce(f.inputs).reason,/CARGO_PROVENANCE_NOT_UNIQUE/);
 assert.equal(f.balance(SOURCE),100);
});
test("wrong NPC recipient corporation or anonymous operator never invokes original GameStore",()=>{
 const f=fixture();f.deny();
 assert.equal(f.create().transferOnce(f.inputs).reason,"LW04E_UNAUTHORIZED_OR_NON_NPC_TRANSFER");
 assert.equal(f.attempts,0);
});
test("wrong source/buyer/title transfer identity and quantity fail without original write",()=>{
 const f=fixture();
 for(const bad of [{sourceOwnerID:FACTORY},{buyerOwnerID:SOURCE},{quantity:51},
  {oreItemID:ITEM+99},{cargoID:-1}]){
  const out=f.create().transferOnce({...f.inputs,...bad});
  assert.equal(out.status,"BLOCKED");
 }
 assert.equal(f.commits,0);
});
test("feature flags are all OFF by default and conflicting schedulers are denied",()=>{
 for(const flag of Object.keys(FLAGS)){
  const f=fixture({env:{...FLAGS,[flag]:"0"}});
  assert.equal(f.create().transferOnce(f.inputs).reason,"LW04E_ORIGINAL_TRANSFER_DISABLED");
  assert.equal(f.attempts,0);
 }
 for(const flag of ["EVEJS_COOP_ALIFE_ECONOMY_ACT",
  "EVEJS_COOP_NATIVE_NPC_MARKET","EVEJS_COOP_NATIVE_NPC_ECONOMY_SCHEDULER"]){
  const f=fixture({env:{...FLAGS,[flag]:"1"}});
  assert.equal(f.create().transferOnce(f.inputs).reason,"LW04E_ORIGINAL_TRANSFER_DISABLED");
 }
});
test("original SQLite poisoned-cache flag refuses credit and custody",()=>{
 const f=fixture();f.poison();
 assert.equal(f.create().transferOnce(f.inputs).reason,"LW04E_ORIGINAL_GAMESTORE_POISONED");
 assert.equal(f.commits,0);
});
test("ambiguous COMMIT ACK loss requires operator repair, no automatic second payout",()=>{
 const f=fixture({throwAfterCommit:true}),actor=f.create();
 const out=actor.transferOnce(f.inputs);
 assert.match(out.reason,/NATIVE_CUSTODY_OR_COMMIT_UNCERTAIN/);
 assert.equal(f.get("items",ITEM).ownerID,FACTORY);
 assert.equal(actor.transferOnce(f.inputs).reason,"LW04E_OPERATOR_REPAIR_REQUIRED");
 assert.deepEqual(actor.requiresOperatorReconciliation(),[CARGO]);
 assert.equal(f.ledger(SOURCE).transactions.length,1);
});
test("previous transfer receipt corruption cannot authorize replay",()=>{
 const f=fixture();assert.equal(f.create().transferOnce(f.inputs).status,"TITLE_TRANSFERRED");
 const key="coopWarehouseTitleTransfer"+SEP+CARGO;
 f.put("corporationRuntime",key,{...f.get("corporationRuntime",key),priceCents:1});
 assert.match(f.create().transferOnce(f.inputs).reason,/PREVIOUS_TRANSFER_CONFLICT/);
 assert.equal(f.ledger(SOURCE).transactions.length,1);
});
test("mutated original corporate transfer journal cannot prove repeat charge already paid",()=>{
 const f=fixture();f.create().transferOnce(f.inputs);
 const corp=f.get("corporationRuntime","corporations"+SEP+SOURCE);
 corp.wallet.divisions["1000"].transactions[0].amount=199;
 f.put("corporationRuntime","corporations"+SEP+SOURCE,corp);
 assert.match(f.create().transferOnce(f.inputs).reason,/PRIOR_WALLET_RECEIPTS_CHANGED/);
});
test("whole-stack transfer preserves raw original marker for real COOP-031 refinery",()=>{
 const f=fixture(),result=f.create().transferOnce(f.inputs);
 assert.equal(result.status,"TITLE_TRANSFERRED");
 const row=f.get("items",ITEM);
 assert.equal(row.customInfo,"coop-warehouse:v1:cargo:"+CARGO);
 assert.equal(row.ownerID,FACTORY);
});
