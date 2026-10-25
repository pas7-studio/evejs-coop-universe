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
 let commits=0;
 let db={corporationRuntime:{[corpKey]:{wallet:{divisions:{
  "1000":{key:1000,balance:50000,journal:[],transactions:[]}}}}},
  characters:{"701":{characterID:701,balance:1000,walletJournal:[]},
   "702":{characterID:702,balance:1000,walletJournal:[]}},
  items:{},
  npcWreckItems:{items:{"9001":{wreckItemID:9001,sourceCargoID:5501,
   wreckID:8001,typeID:34,quantity:5}}}};
 const atomic={mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>false,
  transact:(names,fn)=>{
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
  moveStock:()=>db.items["100000"].locationID=60002});
}
test("original NPC corporation actually reserves ISK, exact two players",()=>fixture(f=>{
 assert.equal(f.rewards.reserve(key).status,"SALVAGE_NATIVE_CORP_ESCROW_RESERVED");
 assert.equal(f.db().corporationRuntime[corpKey].wallet.divisions["1000"].balance,49976);
 assert.equal(f.rewards.verify(key).status,"RESERVED");
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
