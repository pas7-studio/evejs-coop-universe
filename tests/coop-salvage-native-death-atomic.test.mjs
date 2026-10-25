import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeDeathMove}=require("../integration/coopSalvageDeathAtomic.cjs");
const original=process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH;
const oldAtomic=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH="1";
process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";
const source={cargoID:5501,entityID:901,typeID:34,quantity:5};
const prepared={wreckItemID:9001,wreckID:8001,typeID:34,quantity:5,
 sourceCargoID:5501,sourceKind:"cargo",transient:false};
const args={wreckRecord:{wreckID:8001,sourceEntityID:901,systemID:30000144,
 transient:false},originalCargo:[{itemID:5501,typeID:34,quantity:5}],
 preparedWreckItems:[prepared]};
function fixture(fn){
 let tables={
  npcCargo:{cargo:{"5501":{...source}}},
  npcWreckItems:{items:{}}
 };
 let commits=0;
 const atomic={transact(names,callback){
  assert.deepEqual(names,["npcCargo","npcWreckItems"]);
  const working=structuredClone(tables);
  const tx={
   get:(t,k)=>structuredClone(working[t][k]||null),
   put:(t,k,v)=>{working[t][k]=structuredClone(v)}
  };
  const result=callback(tx);
  tables=working;commits++;
  return result;
 }};
 const move=createNativeDeathMove({atomic,
  getNativeCargo:()=>Object.values(tables.npcCargo.cargo),
  getNativeWreckItems:()=>Object.values(tables.npcWreckItems.items)});
 fn({move,tables:()=>structuredClone(tables),commits:()=>commits,
  addWrongCargo:()=>tables.npcCargo.cargo["5501"].typeID=36,
  addWreck:()=>tables.npcWreckItems.items["7777"]={
   wreckItemID:7777,wreckID:8001,sourceCargoID:5501}});
}
test("genuine NPC original cargo debited + source-proven wreck credited in ONE transaction",()=>fixture(f=>{
 assert.equal(f.move.move(args).status,"SALVAGE_NATIVE_CARGO_TO_WRECK_COMMITTED");
 assert.equal(Object.keys(f.tables().npcCargo.cargo).length,0);
 assert.equal(f.tables().npcWreckItems.items["9001"].sourceCargoID,5501);
 assert.equal(f.commits(),1);
}));
test("repeat destruction cannot double-materialize original wreck cargo",()=>fixture(f=>{
 f.move.move(args);
 assert.match(f.move.move(args).status,/SALVAGE_DEATH_NATIVE_ATOMIC_UNCERTAIN/);
 assert.equal(Object.keys(f.tables().npcWreckItems.items).length,1);
 assert.equal(f.commits(),1);
}));
test("a changed type or quantity aborts before both table writes",()=>fixture(f=>{
 f.addWrongCargo();
 assert.match(f.move.move(args).status,/SALVAGE_DEATH_NATIVE_ATOMIC_UNCERTAIN/);
 assert.equal(f.tables().npcCargo.cargo["5501"].typeID,36);
 assert.equal(Object.keys(f.tables().npcWreckItems.items).length,0);
 assert.equal(f.commits(),0);
}));
test("pre-existing native wreck with same source refuses duplicate cargo",()=>fixture(f=>{
 f.addWreck();
 assert.match(f.move.move(args).status,/SALVAGE_DEATH_NATIVE_ATOMIC_UNCERTAIN/);
 assert.equal(f.commits(),0);
}));
test("transient NPC wreck cannot mint durable source cargo",()=>fixture(f=>{
 assert.equal(f.move.move({...args,wreckRecord:{...args.wreckRecord,transient:true}})
  .status,"SALVAGE_DEATH_INVALID_OR_TRANSIENT");
 assert.equal(f.commits(),0);
}));
test("native death feature OFF never mutates stock",()=>fixture(f=>{
 process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH="0";
 try{assert.equal(f.move.move(args).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH="1"}
 assert.equal(f.commits(),0);
}));
process.on("exit",()=>{
 if(original===undefined)delete process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH;
 else process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH=original;
 if(oldAtomic===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=oldAtomic;
});
