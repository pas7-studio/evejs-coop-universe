import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSalvageNativeRewards}=require("../integration/coopSalvageNativeRewards.cjs");
const flag=process.env.EVEJS_COOP_SALVAGE_REWARDS;
const rows=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
process.env.EVEJS_COOP_SALVAGE_REWARDS="1";
process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";
const key="30000144-77-1000000",corpKey="corporations\u001f10001";
function fixture(fn){
 let commits=0,beforeTransaction=null;
 let db={corporationRuntime:{[corpKey]:{wallet:{divisions:{
  "1000":{key:1000,balance:50000,journal:[],transactions:[]}}}}},
  characters:{"701":{characterID:701,balance:1000,walletJournal:[]},
   "702":{characterID:702,balance:1000,walletJournal:[]}},
  items:{},
  npcWreckItems:{items:{"9001":{wreckItemID:9001,sourceCargoID:5501,
   wreckID:8001,typeID:34,quantity:5,sourceKind:"cargo"}}}};
 const atomic={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(names,fn)=>{
   // Deterministic adversarial interleaving: another actor may modify the
   // native wreck after the pre-transaction quote was read.
   if(beforeTransaction){const run=beforeTransaction;beforeTransaction=null;run(db)}
   const copy=structuredClone(db);
   const tx={get:(t,k)=>copy[t][k]??null,
    put:(t,k,v)=>copy[t][k]=v,
    scan:t=>Object.entries(copy[t]).map(([key,value])=>({key,value}))};
   const result=fn(tx);db=copy;commits++;return result;
  }};
 const rewards=createSalvageNativeRewards({atomic,
  isNpcCorporation:id=>id===10001,clock:()=>1000000,
  readAcceptedDuo:()=>({status:"VERIFIED_DUO_SALVAGE_ACCEPT",
   manifestKey:key,characters:[701,702]}),
  readWitness:()=>({status:"READY",record:{manifestKey:key,
   stationID:60001,corporationID:10001,wreckID:8001,
   rows:[{cargoID:5501,wreckItemID:9001,typeID:34,quantity:5}]}}),
  readManifest:()=>({status:"READY",record:{key,
   stationID:60001,corporationID:10001}})});
 const deliver=()=>{
  db.npcWreckItems.items={};
  db.items["100000"]={itemID:100000,
   customInfo:"coop-salvage:v1:"+key+":5501:9001",
   ownerID:10001,locationID:60001,flagID:4,
   typeID:34,quantity:5,stacksize:5,singleton:0};
  db.corporationRuntime.coopSalvageMoves={version:1,moves:{
   [key+":5501"]:{v:1,state:"DELIVERED",manifestKey:key,
    cargoID:5501,wreckItemID:9001,wreckID:8001,
    corporationID:10001,stationID:60001,quantity:5,
    nativeItemID:100000,characterID:701,shipID:1701}
  }};
 };
 fn({rewards,deliver,db:()=>structuredClone(db),commits:()=>commits,
  forgeMarker:()=>{db.npcWreckItems.items={};db.items["100000"]={
   itemID:100000,customInfo:"coop-salvage:v1:"+key+":5501:9001",
   ownerID:10001,locationID:60001,flagID:4,
   typeID:34,quantity:5,stacksize:5,singleton:0}},
  moveStock:()=>db.items["100000"].locationID=60002,
  consumeStock:()=>{delete db.items["100000"]},
  stripProof:()=>{delete db.corporationRuntime.coopSalvageEscrows
   .byContract["salvage-"+key].deliveryProof},
  corruptProof:()=>{db.corporationRuntime.coopSalvageEscrows
   .byContract["salvage-"+key].deliveryProof[0].nativeItemID=999999},
  deleteMoveReceipt:()=>{delete db.corporationRuntime.coopSalvageMoves
   .moves[key+":5501"]},
  scheduleBeforeTransaction:fn=>beforeTransaction=fn});
}
test("original NPC corporation actually reserves ISK, exact two players",()=>fixture(f=>{
 assert.equal(f.rewards.reserve(key).status,"SALVAGE_NATIVE_CORP_ESCROW_RESERVED");
 assert.equal(f.db().corporationRuntime[corpKey].wallet.divisions["1000"].balance,49976);
 assert.equal(f.rewards.verify(key).status,"RESERVED");
}));
test("NPC rival wins between quote and escrow transaction: no corporate debit",()=>fixture(f=>{
 const before=f.db().corporationRuntime[corpKey].wallet.divisions["1000"].balance;
 f.scheduleBeforeTransaction(db=>{
  delete db.npcWreckItems.items["9001"];
  db.corporationRuntime.coopSalvageRivalMoves={version:1,moves:{
   "9001":{v:1,state:"NPC_CARGO",wreckItemID:9001}}};
 });
 assert.equal(f.rewards.reserve(key).status,"SALVAGE_RESERVATION_SOURCE_ALREADY_MOVED");
 assert.equal(f.db().corporationRuntime[corpKey].wallet.divisions["1000"].balance,before);
 assert.equal(f.db().corporationRuntime.coopSalvageEscrows,undefined);
}));
test("forged restored wreck row cannot bypass a durable rival pickup receipt",()=>fixture(f=>{
 f.scheduleBeforeTransaction(db=>{
  db.corporationRuntime.coopSalvageRivalMoves={version:1,moves:{
   "9001":{v:1,state:"NPC_CARGO",wreckItemID:9001}}};
 });
 assert.equal(f.rewards.reserve(key).status,"SALVAGE_RESERVATION_SOURCE_ALREADY_MOVED");
 assert.equal(f.db().corporationRuntime[corpKey].wallet.divisions["1000"].balance,50000);
}));
test("missing original sourceKind fails funding even with a matching quote",()=>fixture(f=>{
 f.scheduleBeforeTransaction(db=>{delete db.npcWreckItems.items["9001"].sourceKind});
 assert.equal(f.rewards.reserve(key).status,"SALVAGE_RESERVATION_SOURCE_ALREADY_MOVED");
 assert.equal(f.db().corporationRuntime[corpKey].wallet.divisions["1000"].balance,50000);
}));
test("successful reserve cannot pay before physically recovered goods",()=>fixture(f=>{
 f.rewards.reserve(key);
 assert.equal(f.rewards.settle(key).status,"SALVAGE_SETTLEMENT_NOT_VERIFIED_OR_UNCERTAIN");
 assert.equal(f.db().characters["701"].balance,1000);
 assert.equal(f.db().characters["702"].balance,1000);
}));
test("forged customInfo marker without ACID original pickup/delivery receipt cannot pay",()=>fixture(f=>{
 f.rewards.reserve(key);f.forgeMarker();
 assert.equal(f.rewards.settle(key).status,"SALVAGE_SETTLEMENT_NOT_VERIFIED_OR_UNCERTAIN");
 assert.equal(f.db().characters["701"].balance,1000);
}));
test("real original cargo and native escrow credit both player wallets once",()=>fixture(f=>{
 f.rewards.reserve(key);f.deliver();
 const first=f.rewards.settle(key);
 assert.equal(first.status,"SALVAGE_NATIVE_DUO_PAID");
 assert.deepEqual(first.credits,[{characterID:701,amountISK:12},
  {characterID:702,amountISK:12}]);
 assert.equal(f.db().characters["701"].balance,1012);
 assert.equal(f.db().characters["702"].balance,1012);
 assert.equal(f.db().corporationRuntime[corpKey].wallet.divisions["1000"].balance,49976);
}));
test("repeat settlement after crash cannot credit a second time",()=>fixture(f=>{
 f.rewards.reserve(key);f.deliver();f.rewards.settle(key);
 assert.equal(f.rewards.settle(key).status,"SALVAGE_ALREADY_PAID");
 assert.equal(f.db().characters["701"].balance,1012);
}));
test("native warehouse item moved to wrong station forbids payment",()=>fixture(f=>{
 f.rewards.reserve(key);f.deliver();f.moveStock();
 assert.equal(f.rewards.settle(key).status,"SALVAGE_SETTLEMENT_NOT_VERIFIED_OR_UNCERTAIN");
}));

test("settled rescue keeps wallet-backed reputation after lawful NPC consumption",()=>fixture(f=>{
 f.rewards.reserve(key);f.deliver();
 assert.equal(f.rewards.settle(key).status,"SALVAGE_NATIVE_DUO_PAID");
 const sealed=f.db().corporationRuntime.coopSalvageEscrows
  .byContract["salvage-"+key].deliveryProof;
 assert.equal(sealed.length,1);
 assert.equal(sealed[0].nativeItemID,100000);
 f.consumeStock();
 const history=f.rewards.history(701);
 assert.equal(history.status,"READY");
 assert.equal(history.history[0].outcome,"SETTLED");
 assert.equal(history.history[0].earnedISK,12);
 assert.equal(history.reputation.score,12);
 assert.equal(f.rewards.settle(key).status,"SALVAGE_ALREADY_PAID");
 assert.equal(f.db().characters["701"].balance,1012);
 assert.equal(f.db().characters["702"].balance,1012);
}));
test("legacy paid rescue without sealed proof never invents history after stock leaves",()=>fixture(f=>{
 f.rewards.reserve(key);f.deliver();f.rewards.settle(key);
 f.stripProof();f.consumeStock();
 assert.equal(f.rewards.history(701).status,"SALVAGE_HISTORY_STOCK_NOT_VERIFIED");
}));
test("corrupted settlement-time cargo seal is never treated as earned reputation",()=>fixture(f=>{
 f.rewards.reserve(key);f.deliver();f.rewards.settle(key);
 f.corruptProof();
 assert.equal(f.rewards.history(701).status,"SALVAGE_HISTORY_DELIVERY_RECEIPT_CONFLICT");
}));
test("missing GameStore delivery receipt fails sealed historical reputation",()=>fixture(f=>{
 f.rewards.reserve(key);f.deliver();f.rewards.settle(key);
 f.consumeStock();f.deleteMoveReceipt();
 assert.equal(f.rewards.history(701).status,"SALVAGE_HISTORY_DELIVERY_RECEIPT_CONFLICT");
}));
test("native salvage rewards default OFF",()=>fixture(f=>{
 process.env.EVEJS_COOP_SALVAGE_REWARDS="0";
 try{assert.equal(f.rewards.reserve(key).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_SALVAGE_REWARDS="1"}
}));
process.on("exit",()=>{
 if(flag===undefined)delete process.env.EVEJS_COOP_SALVAGE_REWARDS;
 else process.env.EVEJS_COOP_SALVAGE_REWARDS=flag;
 if(rows===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=rows;
});
