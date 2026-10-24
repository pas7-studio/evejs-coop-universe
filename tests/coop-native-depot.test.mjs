import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const require=createRequire(import.meta.url);
const {createDepot}=require("../integration/coopNativeDepot.cjs");
const {createEconomy}=require("../integration/coopVirtualEconomy.cjs");

test("real native ore delivered to depot changes system supply exactly once, including after restart",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-native-depot-"));
 try{
  const file=join(dir,"depot.json"),economyFile=join(dir,"virtual-economy.json"),clock=()=>1000000;
  const depot=createDepot({file,clock});
  const cargo={systemID:30000142,fleetID:9,deliveries:[
   {cargoID:777,haulerID:201,typeID:34,quantity:100},
   {cargoID:778,haulerID:201,typeID:35,quantity:60}
  ]};
  assert.deepEqual(depot.record(cargo).status,"RECORDED");
  assert.equal(depot.record(cargo).accepted,0);
  assert.equal(createDepot({file,clock}).snapshot().totals["30000142"],160);
  const economy=createEconomy({file:economyFile,clock});
  assert.equal(economy.syncNativeDeliveries(depot.snapshot().totals).quantity,160);
  assert.equal(economy.snapshot().systems["30000142"].goods,260);
  assert.equal(economy.syncNativeDeliveries(depot.snapshot().totals).quantity,0);
  const restored=createEconomy({file:economyFile,clock});
  assert.equal(restored.syncNativeDeliveries(createDepot({file,clock}).snapshot().totals).quantity,0);
  assert.equal(restored.snapshot().systems["30000142"].goods,260);
  depot.record({systemID:30000142,fleetID:9,deliveries:[{cargoID:779,typeID:34,quantity:20}]});
  assert.equal(restored.syncNativeDeliveries(depot.snapshot().totals).quantity,20);
  assert.equal(restored.snapshot().systems["30000142"].goods,280);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("bad or repeated native cargo IDs cannot invent virtual goods",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-native-depot-"));
 try{
  const depot=createDepot({file:join(dir,"dep.json")});
  assert.equal(depot.record({systemID:0,fleetID:9,deliveries:[]}).status,"INVALID");
  assert.equal(depot.record({systemID:30000142,fleetID:9,deliveries:[
    {cargoID:-1,typeID:34,quantity:2},
    {cargoID:777,typeID:34,quantity:-10},
    {cargoID:778,typeID:34,quantity:1.5}
  ]}).accepted,0);
  assert.deepEqual(depot.snapshot().totals,{});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
