import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeSalvageTransfer}=require("../integration/coopSalvageNativeTransfer.cjs");
const old=process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER;
const old2=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER="1";
process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";
const args={manifestKey:"30000144-77-1000000",cargoID:5501,wreckItemID:9001,
 expectedWreckID:8001,stationID:60001,corporationID:10001,
 quantity:5,characterID:701,shipID:1701};
function fixture(fn){
 let distance=1000,docked=false,wreckExists=true,txs=0,beforeNextTx=null;
 let db={npcWreckItems:{items:{"9001":{wreckItemID:9001,wreckID:8001,
  sourceKind:"cargo",sourceCargoID:5501,typeID:34,quantity:5,
  singleton:false,itemName:"Ore"}}},
  npcWrecks:{wrecks:{"8001":{wreckID:8001,systemID:30000144,sourceEntityID:901}}},
  identityState:{nextItemID:100000},items:{},corporationRuntime:{}};
 const atomic={transact(names,fn){
  // Simulate a competing successful native writer after the read-only
  // preflight but before this transaction takes the authoritative snapshot.
  if(beforeNextTx){const mutation=beforeNextTx;beforeNextTx=null;mutation(db);}
  const copy=structuredClone(db);
  const tx={
   get:(t,k)=>copy[t][k]??null,
   scan:t=>Object.entries(copy[t]).map(([key,value])=>({key,value})),
   put:(t,k,value)=>copy[t][k]=value
  };
  const result=fn(tx);
  db=copy;txs++;
  return result;
 }};
 const api=createNativeSalvageTransfer({atomic,
  readWitness:()=>({status:"READY",record:{manifestKey:args.manifestKey,
   wreckID:8001,stationID:60001,corporationID:10001,
   rows:[{cargoID:5501,wreckItemID:9001,typeID:34,quantity:5}]}}),
  readManifest:()=>({status:"READY",record:{key:args.manifestKey,
   stationID:60001,corporationID:10001,
   cargo:[{cargoID:5501,typeID:34,quantity:5}]}}),
  readOriginalWreckItem:()=>db.npcWreckItems.items["9001"]||null,
  readMoveJournal:()=>db.corporationRuntime.coopSalvageMoves||null,
  listNativeItems:()=>Object.values(db.items),
  buildInventoryItem:spec=>spec,
  verifyPickupPresence:()=>({status:"LIVE_NATIVE_WRECK_PICKUP_VERIFIED",
   characterID:701,shipID:1701,wreckID:8001,
   systemID:30000144,haulerID:901,distanceMeters:distance}),
  verifyDocking:()=>({status:docked?"LIVE_NATIVE_DOCKED_DELIVERY_VERIFIED":"NOT_DOCKED",
   characterID:701,shipID:1701,stationID:60001})
 });
 fn({api,db:()=>structuredClone(db),setDistance:x=>distance=x,
  dock:()=>docked=true,txs:()=>txs,removeWreck:()=>wreckExists=false,
  beforeTx:fn=>beforeNextTx=fn});
}
test("a player physically within 2.5km of a real wreck picks up ORIGINAL cargo",()=>fixture(f=>{
 assert.equal(f.api.pickup(args).status,"SALVAGE_NATIVE_PLAYER_CARGO");
 assert.equal(f.db().npcWreckItems.items["9001"],undefined);
 const item=Object.values(f.db().items)[0];
 assert.equal(item.ownerID,701);assert.equal(item.locationID,1701);
 assert.equal(item.flagID,5);assert.equal(item.quantity,5);
 assert.equal(f.txs(),1);
}));
test("remote player cannot pickup stock cargo",()=>fixture(f=>{
 f.setDistance(2501);
 assert.equal(f.api.pickup(args).status,"SALVAGE_WRECK_PICKUP_OUT_OF_RANGE");
 assert.equal(f.txs(),0);
}));
test("a pickup cannot directly create station warehouse credit",()=>fixture(f=>{
 assert.equal(f.api.deliver(args).status,"NOT_FOUND");
 assert.equal(f.txs(),0);
}));
test("pickup while in space cannot be delivered to corp station",()=>fixture(f=>{
 f.api.pickup(args);
 assert.equal(f.api.deliver(args).status,"SALVAGE_PLAYER_NOT_PHYSICALLY_DOCKED");
 assert.equal(f.db().items["100000"].ownerID,701);
 assert.equal(f.txs(),1);
}));
test("docked native ship transfers SAME itemID to original NPC corporation",()=>fixture(f=>{
 f.api.pickup(args);f.dock();
 assert.equal(f.api.deliver(args).status,"ATOMIC_NATIVE_ITEM_MOVED");
 assert.equal(f.db().items["100000"].ownerID,10001);
 assert.equal(f.db().items["100000"].locationID,60001);
 assert.equal(f.db().items["100000"].flagID,4);
 assert.equal(f.txs(),2);
}));
test("reconnect/replay cannot mint second cargo or issue repeat warehouse credit",()=>fixture(f=>{
 f.api.pickup(args);f.dock();f.api.deliver(args);
 assert.equal(f.api.pickup(args).status,"ATOMIC_NATIVE_ITEM_MOVED");
 assert.equal(f.api.deliver(args).status,"ATOMIC_NATIVE_ITEM_MOVED");
 assert.equal(Object.keys(f.db().items).length,1);
 assert.equal(f.txs(),2);
}));
test("spoofed wreck identity cannot be picked up",()=>fixture(f=>{
 assert.equal(f.api.pickup({...args,expectedWreckID:8002}).status,
  "SALVAGE_ORIGINAL_PROVENANCE_UNVERIFIED");
 assert.equal(f.txs(),0);
}));
test("feature flag OFF refuses real inventory movement",()=>fixture(f=>{
 process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER="0";
 try{assert.equal(f.api.pickup(args).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER="1"}
 assert.equal(f.txs(),0);
}));
process.on("exit",()=>{
 if(old===undefined)delete process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER;
 else process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER=old;
 if(old2===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=old2;
});

test("delivery denies a pickup receipt reassigned after inspect without changing item custody",()=>fixture(f=>{
 assert.equal(f.api.pickup(args).status,"SALVAGE_NATIVE_PLAYER_CARGO");
 f.dock();
 f.beforeTx(db=>{
  db.corporationRuntime.coopSalvageMoves.moves[args.manifestKey+":"+args.cargoID].characterID=702;
 });
 assert.equal(f.api.deliver(args).status,"SALVAGE_NATIVE_DELIVERY_UNCERTAIN");
 assert.equal(f.db().items["100000"].ownerID,args.characterID);
 assert.equal(f.db().items["100000"].locationID,args.shipID);
 assert.equal(f.db().corporationRuntime.coopSalvageMoves.moves[args.manifestKey+":"+args.cargoID].state,"PLAYER_CARGO");
 assert.equal(f.txs(),1);
}));
test("delivery refuses quantity-matched stack with altered stacksize between preflight and commit",()=>fixture(f=>{
 f.api.pickup(args);f.dock();
 f.beforeTx(db=>{db.items["100000"].stacksize=args.quantity+1;});
 assert.equal(f.api.deliver(args).status,"SALVAGE_NATIVE_DELIVERY_UNCERTAIN");
 assert.equal(f.db().items["100000"].ownerID,args.characterID);
 assert.equal(f.txs(),1);
}));
test("delivery refuses a duplicate original salvage marker inserted after preflight",()=>fixture(f=>{
 f.api.pickup(args);f.dock();
 f.beforeTx(db=>{
  db.items["100001"]={...db.items["100000"],itemID:100001};
 });
 assert.equal(f.api.deliver(args).status,"SALVAGE_NATIVE_DELIVERY_UNCERTAIN");
 assert.equal(f.db().items["100000"].ownerID,args.characterID);
 assert.equal(f.db().corporationRuntime.coopSalvageMoves.moves[args.manifestKey+":"+args.cargoID].state,"PLAYER_CARGO");
 assert.equal(f.txs(),1);
}));
