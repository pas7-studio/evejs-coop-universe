import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOutcomes}=require("../integration/coopConvoyOutcomeProof.cjs");
const FILE="/tmp/coop-native-convoy-outcome-test.jsonl";
function fixture(){
 const data=new Map(),fds=new Map();let next=0,failWrite=false,incidents=[
  {key:"30000144:900:901",systemID:30000144,pirateID:900,targetID:901,
   targetRole:"hauler",status:"PIRATE_WRECK_CONFIRMED",duoFleetID:7}];
 const io={
  readFileSync:p=>{if(!data.has(p)){const e=Error("ENOENT");e.code="ENOENT";throw e}return data.get(p)},
  mkdirSync(){},
  openSync:(p,mode)=>{if(mode==="wx"&&data.has(p))throw Error("EEXIST");
   if(failWrite)throw Error("EIO");
   if(mode==="wx")data.set(p,"");
   fds.set(++next,p);return next;},
  writeSync:(fd,b)=>{if(failWrite)throw Error("EIO");const p=fds.get(fd);
   data.set(p,(data.get(p)||"")+b.toString());return b.length},
  fsyncSync:()=>{if(failWrite)throw Error("EIO")},
  closeSync:fd=>fds.delete(fd),
  unlinkSync:p=>data.delete(p)
 };
 const record={version:1,phase:"COMMITTED",cargoID:501,haulerID:901,fleetID:300,
  systemID:30000144,stationID:60000111,corporationID:981,typeID:34,quantity:55,itemID:70001};
 const stock={itemID:70001,typeID:34,ownerID:981,locationID:60000111,
  quantity:55,customInfo:"coop-warehouse:v1:cargo:501"};
 const loss={status:"PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED",
  attribution:"REAL_NATIVE_MINING_FLEET_MEMBERSHIP_AND_WRECK_STORE",
  victimRole:"hauler",victimEntityID:901,wreckID:80001,systemID:30000144};
 const create=()=>createOutcomes({file:FILE,io,clock:()=>123456,
  incidents:()=>({status:"READY",incidents})});
 return {data,io,create,record,stock,loss,incidents,fail:()=>{failWrite=true}};
}
test("native warehouse COMMITTED exact source debit/target stock records one real cargo stack",()=>{
 const f=fixture(),o=f.create();
 const result=o.warehouse({record:f.record,stock:f.stock,sourceAbsent:true});
 assert.equal(result.status,"NATIVE_CONVOY_OUTCOME_RECORDED");
 const snapshot=o.snapshot();
 assert.equal(snapshot.status,"READY");
 assert.equal(snapshot.outcomes[0].status,"NATIVE_STATION_STOCK_PARTIALLY_VERIFIED");
 assert.equal(snapshot.outcomes[0].convoySaved,false);
 assert.equal(snapshot.outcomes[0].paidReward,false);
 assert.equal(snapshot.outcomes[0].verifiedWarehouseStacks[0].cargoID,501);
});
test("repeated delivery does not duplicate cargo or restart with a duplicated stack",()=>{
 const f=fixture(),o=f.create();
 o.warehouse({record:f.record,stock:f.stock,sourceAbsent:true});
 assert.equal(o.warehouse({record:f.record,stock:f.stock,sourceAbsent:true}).status,"NATIVE_STOCK_ALREADY_RECORDED");
 assert.equal(f.create().warehouse({record:f.record,stock:f.stock,sourceAbsent:true}).status,"NATIVE_STOCK_ALREADY_RECORDED");
 assert.equal(f.data.get(FILE).trim().split("\n").length,1);
});
test("warehouse source still exists, wrong owner/item/flag/quantity cannot count as delivery",()=>{
 for(const edit of [
  f=>{f.stock.ownerID=982},f=>{f.stock.itemID=999},
  f=>{f.stock.customInfo="not tagged"},f=>{f.stock.quantity=0},
  f=>{f.record.phase="PREPARED"},f=>{f.stock.locationID=60000112}
 ]){
  const f=fixture();edit(f);
  assert.equal(f.create().warehouse({record:f.record,stock:f.stock,sourceAbsent:true}).status,"WAREHOUSE_NATIVE_STOCK_NOT_PROVEN");
  assert.equal(f.data.has(FILE),false);
 }
 const f=fixture();assert.equal(f.create().warehouse({record:f.record,stock:f.stock,sourceAbsent:false}).status,
  "WAREHOUSE_NATIVE_STOCK_NOT_PROVEN");
});
test("actual physical native stock fleet wreck may record hauler loss exactly once",()=>{
 const f=fixture(),o=f.create();
 assert.equal(o.loss({proof:f.loss}).status,"NATIVE_CONVOY_OUTCOME_RECORDED");
 assert.equal(o.loss({proof:f.loss}).status,"NATIVE_LOSS_ALREADY_RECORDED");
 const snapshot=f.create().snapshot().outcomes[0];
 assert.equal(snapshot.haulerNativeWreckID,80001);
 assert.equal(snapshot.status,"HAULER_NATIVE_LOSS_VERIFIED");
 assert.equal(snapshot.convoySaved,false);
});
test("wreck of a miner, virtual loss or wrong native wreck identity is never an attacked hauler loss",()=>{
 for(const mutate of [
  f=>{f.loss.victimRole="miner"},f=>{f.loss.status="FAKE_WRECK"},
  f=>{f.loss.attribution="SIMULATED"},f=>{f.loss.victimEntityID=444},
  f=>{f.loss.systemID=30000142}
 ]){
  const f=fixture();mutate(f);
  const res=f.create().loss({proof:f.loss});
  assert.notEqual(res.status,"NATIVE_CONVOY_OUTCOME_RECORDED");
  assert.equal(f.data.has(FILE),false);
 }
});
test("one cargo stack delivered before hauler wreck means partial delivery THEN loss, never full rescue",()=>{
 const f=fixture(),o=f.create();o.warehouse({record:f.record,stock:f.stock,sourceAbsent:true});
 o.loss({proof:f.loss});
 const snapshot=f.create().snapshot().outcomes[0];
 assert.equal(snapshot.status,"PARTIAL_STOCK_DELIVERED_THEN_HAULER_LOST");
 assert.equal(snapshot.verifiedWarehouseStacks.length,1);
 assert.equal(snapshot.haulerNativeWreckID,80001);
 assert.equal(snapshot.convoySaved,false);
 assert.equal(o.warehouse({record:{...f.record,cargoID:502,itemID:70002},
  stock:{...f.stock,itemID:70002,customInfo:"coop-warehouse:v1:cargo:502"},
  sourceAbsent:true}).status,"HAULER_ALREADY_DESTROYED");
});
test("incidents at warp approach only or without exact hauler target do not infer sale/delivery",()=>{
 const f=fixture();f.incidents[0].status="APPROACH";
 assert.equal(f.create().warehouse({record:f.record,stock:f.stock,sourceAbsent:true}).status,
  "NO_ATTACKED_NATIVE_HAULER");
 f.incidents[0].status="UNDER_ATTACK";f.incidents[0].targetRole="miner";
 assert.equal(f.create().loss({proof:f.loss}).status,"NO_ATTACKED_NATIVE_HAULER");
});
test("multiple native pirate raids attacking same hauler are ambiguous; no invented attribution",()=>{
 const f=fixture();f.incidents.push({...f.incidents[0],key:"30000144:902:901",pirateID:902});
 assert.equal(f.create().warehouse({record:f.record,stock:f.stock,sourceAbsent:true}).status,
  "AMBIGUOUS_NATIVE_CONVOY_RAIDS");
 assert.equal(f.data.has(FILE),false);
});
test("corrupt or torn native outcome journal fails closed even if native warehouse is already committed",()=>{
 for(const bad of ['{"v":1','wrong-json\n']){
  const f=fixture();f.data.set(FILE,bad);
  assert.equal(f.create().warehouse({record:f.record,stock:f.stock,sourceAbsent:true}).status,
   "OUTCOME_JOURNAL_CORRUPT");
 }
});
test("write or fsync uncertainty leaves exclusive lock; retry never invents committed success",()=>{
 const f=fixture(),o=f.create();f.fail();
 assert.equal(o.loss({proof:f.loss}).status,"OUTCOME_WRITER_LOCKED_NEEDS_REPAIR");
 assert.equal(f.data.has(FILE),false);
});
test("unknown/pre-existing writer lock blocks concurrent native outcome writers",()=>{
 const f=fixture();f.data.set(FILE+".lock","");
 assert.equal(f.create().loss({proof:f.loss}).status,"OUTCOME_WRITER_LOCKED_NEEDS_REPAIR");
 assert.equal(f.data.has(FILE),false);
});
test("loss and delivery are only journal events, no native cargo, market or ISK API calls",()=>{
 const f=fixture(),o=f.create();o.warehouse({record:f.record,stock:f.stock,sourceAbsent:true});
 o.loss({proof:f.loss});
 assert.deepEqual([...f.data.keys()].sort(),[FILE]);
 assert.deepEqual(f.data.get(FILE).trim().split("\n").map(s=>JSON.parse(s).state),
  ["WAREHOUSE_STOCK_VERIFIED","HAULER_WRECK_VERIFIED"]);
});
