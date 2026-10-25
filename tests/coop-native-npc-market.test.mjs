import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,rmSync,existsSync,readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const require=createRequire(import.meta.url);
const {createNpcMarketTrader}=require("../integration/coopNativeNpcMarket.cjs");
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"evejs-native-npc-market-"));
 let now=1000000,failRPC=false,failInventory=false,failGet=false,moveDuringBook=false,cargoCapacity=200;
 const station={stationID:60015169,solarSystemID:30000142,regionID:10000002,
  position:{x:0,y:0,z:0},radius:1000};
 const ship={itemID:980000000001,kind:"ship",nativeNpc:true,position:{x:500,y:0,z:0}};
 const scene={systemID:30000142,staticEntities:[{kind:"station",itemID:station.stationID,position:station.position,radius:station.radius}],getEntityByID:id=>id===ship.itemID?ship:null};
 const pilotID="coop-pilot-005";
 const controller={entityID:ship.itemID,systemID:scene.systemID,
  currentTargetID:0,lastAggressorID:0,manualOrder:null};
 const registry={snapshot:()=>({links:{[pilotID]:{
  pilotID,entityID:ship.itemID,systemID:30000142}}})};
 let cargo=[{cargoID:980200000005,entityID:ship.itemID,ownerID:100,
  moduleID:0,typeID:34,quantity:8,flagID:5,singleton:false}];
 let nextCargoID=980200000006,failFillOnly=false;
 let remainingBuy=100,remainingSell=100;
 const buyID="9100000000000000123",sellID="9000000000000000444";
 let calls=[];
 const store={
  getNativeEntity:id=>id===ship.itemID?{entityID:id,systemID:30000142,ownerID:100,typeID:603}:null,
  listNativeCargoForEntity:id=>cargo.filter(c=>c.entityID===id).map(c=>({...c})),
  upsertNativeCargo:row=>{
   if(failInventory)return {success:false,errorMsg:"STORE_FAIL"};
   cargo=cargo.filter(c=>c.cargoID!==row.cargoID);cargo.push({...row});return {success:true};
  },
  removeNativeCargo:id=>{if(failInventory)return {success:false};
   cargo=cargo.filter(c=>c.cargoID!==id);return {success:true}},
  buildNativeCargoItems:id=>cargo.filter(c=>c.entityID===id).map(c=>({
   itemID:c.cargoID,locationID:id,typeID:c.typeID,quantity:c.quantity,
   stacksize:c.quantity,ownerID:c.ownerID,moduleID:c.moduleID,flagID:c.flagID
  })),
  allocateCargoID:()=>({success:true,data:nextCargoID++})
 };
 ship.nativeCargoItems=store.buildNativeCargoItems(ship.itemID);
 const call=async(method,args)=>{
  calls.push({method,args});
  if(method==="GetOrders"){if(failGet)throw Error("MARKET_DAEMON_OFFLINE");
   if(moveDuringBook)ship.position.x=100000;
   return {sells:[{source:"seed",order_id:sellID,
   station_id:station.stationID,type_id:35,price:50,vol_remaining:remainingSell}],
   buys:[{source:"seed",order_id:buyID,station_id:station.stationID,type_id:34,
    price:100,vol_remaining:remainingBuy}]};}
  if(method==="FillOrder"){
   if(failRPC)throw Error("RPC_DISCONNECTED");
   if(failFillOnly)return {order_id:args.order_id,filled_quantity:0,
    station_id:station.stationID,type_id:34,price:100,bid:true};
   remainingBuy-=args.fill_quantity;
   return {order_id:args.order_id,filled_quantity:args.fill_quantity,
    station_id:station.stationID,type_id:34,price:100,bid:true};
  }
  if(method==="AdjustSeedStock"){
   if(failRPC)throw Error("RPC_DISCONNECTED");
   remainingSell+=args.delta_quantity;
   return {station_id:station.stationID,type_id:35,quantity:remainingSell,price:50};
  }
  if(method==="RecordTrade")return {success:true};
  throw Error("Unexpected market RPC "+method);
 };
 const trader=()=>createNpcMarketTrader({root,call,store,registry,
  sceneForSystem:system=>system===scene.systemID?scene:null,
  getController:id=>id===ship.itemID?controller:null,
  getStation:id=>id===station.stationID?station:null,
  resolveType:id=>id===603?({typeID:603,capacity:cargoCapacity}):
   ({typeID:id,groupID:18,categoryID:8,name:"Test cargo",volume:0.1}),
  clock:()=>now,cooldownMs:30000,maxQuantity:10,maxPrice:1000});
 const params=(side,typeID)=>({scene,pilotID,entityID:ship.itemID,
  stationID:station.stationID,side,typeID,buyTypes:[35],sellTypes:[34]});
 return {root,scene,ship,controller,registry,store,station,trader,params,
  getCargo:()=>cargo,getCalls:()=>calls,advance:()=>{now+=30001},
  setFailRPC:v=>{failRPC=v},setFailInventory:v=>{failInventory=v},
  setFailFill:v=>{failFillOnly=v},setFailGet:v=>{failGet=v},
  setMoveDuringBook:v=>{moveDuringBook=v},setCapacity:v=>{cargoCapacity=v},
  getRemaining:()=>({buy:remainingBuy,sell:remainingSell}),
  cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test("real NPC seeded BUY order consumes exact native cargo and credits earned ISK once",async()=>{
 const x=fixture();try{
  const t=x.trader(),r=await t.execute(x.params("sell",34));
  assert.equal(r.status,"TRADE_SETTLED");
  assert.equal(r.quantity,8);assert.equal(r.balance,800);
  assert.equal(x.getCargo().length,0);
  assert.equal(x.ship.nativeCargoItems.length,0);
  assert.equal(x.getRemaining().buy,92);
  assert.equal(x.getCalls().filter(c=>c.method==="FillOrder").length,1);
  assert.equal(x.getCalls().find(c=>c.method==="FillOrder").args.order_id,
   "9100000000000000123");
  assert.equal(t.snapshot().pilots["coop-pilot-005"].tradeCount,1);
  assert.equal((await t.execute(x.params("sell",34))).status,"COOLDOWN");
 }finally{x.cleanup()}
});
test("NPC spends only earned ISK buying real seeded station stock into native cargo",async()=>{
 const x=fixture();try{
  const t=x.trader();
  assert.equal((await t.execute(x.params("buy",35))).status,"INSUFFICIENT_EARNED_ISK");
  assert.equal((await t.execute(x.params("sell",34))).status,"TRADE_SETTLED");
  x.advance();
  const result=await t.execute(x.params("buy",35));
  assert.equal(result.status,"TRADE_SETTLED");
  assert.equal(result.quantity,10);assert.equal(result.balance,300);
  assert.equal(x.getRemaining().sell,90);
  assert.equal(x.getCargo()[0].typeID,35);assert.equal(x.getCargo()[0].quantity,10);
  assert.equal(x.ship.nativeCargoItems[0].typeID,35);
  assert.equal(x.ship.nativeCargoItems[0].quantity,10);
  assert.equal(x.trader().snapshot().pilots["coop-pilot-005"].balance,300);
 }finally{x.cleanup()}
});
test("must be actual named native NPC physically at real same-system station",async()=>{
 const x=fixture();try{
  const t=x.trader();
  x.ship.position.x=100000;
  assert.equal((await t.execute(x.params("sell",34))).status,"NOT_AT_NATIVE_STATION");
  x.ship.position.x=500;x.ship.nativeNpc=false;
  assert.equal((await t.execute(x.params("sell",34))).status,"NOT_AT_NATIVE_STATION");
  x.ship.nativeNpc=true;x.ship.session={characterID:7};
  assert.equal((await t.execute(x.params("sell",34))).status,"NOT_AT_NATIVE_STATION");
  assert.equal(x.getCalls().length,0);
 }finally{x.cleanup()}
});
test("invalid allowlist, nonexistent seed bid, and buyer without funds never mutate anything",async()=>{
 const x=fixture();try{
  const t=x.trader();
  const wrong={...x.params("sell",34),sellTypes:[]};
  assert.equal((await t.execute(wrong)).status,"TYPE_NOT_ALLOWLISTED");
  assert.equal((await t.execute(x.params("buy",35))).status,"INSUFFICIENT_EARNED_ISK");
  assert.equal(x.getCargo()[0].quantity,8);
  assert.equal(x.getCalls().filter(c=>c.method==="FillOrder").length,0);
 }finally{x.cleanup()}
});
test("native market guard excludes a real player-owned ship and active fighting NPC",async()=>{
 const x=fixture();try{
  const t=x.trader();
  x.scene.sessions=new Map([[1,{characterID:88,_space:{shipID:x.ship.itemID}}]]);
  assert.equal((await t.execute(x.params("sell",34))).status,"PLAYER_SHIP_EXCLUDED");
  x.scene.sessions.clear();
  x.controller.currentTargetID=999;
  assert.equal((await t.execute(x.params("sell",34))).status,"NATIVE_NPC_BUSY");
  x.controller.currentTargetID=0;x.ship.mode="WARP";
  assert.equal((await t.execute(x.params("sell",34))).status,"NATIVE_NPC_BUSY");
  assert.equal(x.getCalls().length,0);
 }finally{x.cleanup()}
});
test("ambiguous native market RPC failure halts pilot rather than duplicating a sale",async()=>{
 const x=fixture();try{
  const t=x.trader();x.setFailRPC(true);
  assert.equal((await t.execute(x.params("sell",34))).status,"RPC_OUTCOME_UNKNOWN");
  x.setFailRPC(false);
  assert.equal((await t.execute(x.params("sell",34))).status,"UNRESOLVED_MARKET_JOURNAL");
  assert.equal(t.recover().status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(x.getCargo()[0].quantity,8);
  assert.equal(x.getCalls().filter(c=>c.method==="FillOrder").length,1);
 }finally{x.cleanup()}
});
test("successful market RPC with inventory-store error is recovered without second market fill",async()=>{
 const x=fixture();try{
  const t=x.trader();x.setFailInventory(true);
  assert.equal((await t.execute(x.params("sell",34))).status,"NEEDS_MARKET_REPAIR");
  assert.equal(x.getRemaining().buy,92);
  x.setFailInventory(false);
  const newProcess=x.trader();
  assert.equal(newProcess.recover().status,"RECOVERED");
  assert.equal(newProcess.snapshot().pilots["coop-pilot-005"].balance,800);
  assert.equal(x.getCargo().length,0);
  assert.equal(newProcess.recover().status,"CLEAN");
  assert.equal(x.getCalls().filter(c=>c.method==="FillOrder").length,1);
 }finally{x.cleanup()}
});
test("unverified market FillOrder ack does not erase the pending transaction",async()=>{
 const x=fixture();try{
  x.setFailFill(true);
  const t=x.trader();
  assert.equal((await t.execute(x.params("sell",34))).status,"RPC_ACK_NOT_VERIFIABLE");
  assert.equal(t.recover().status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(x.getCargo()[0].quantity,8);
  assert.equal(t.snapshot().pilots["coop-pilot-005"],undefined);
 }finally{x.cleanup()}
});

test("failed read-only market book RPC does not enter repair-required state",async()=>{
 const x=fixture();try{
  x.setFailGet(true);
  const t=x.trader();
  assert.equal((await t.execute(x.params("sell",34))).status,"MARKET_UNAVAILABLE");
  assert.equal(t.recover().status,"CLEAN");
  assert.equal(x.getCargo()[0].quantity,8);
  assert.equal(x.getCalls().filter(c=>c.method==="FillOrder").length,0);
 }finally{x.cleanup()}
});
test("NPC moving away during market query cannot execute trade from stale ship position",async()=>{
 const x=fixture();try{
  x.setMoveDuringBook(true);
  const t=x.trader();
  assert.equal((await t.execute(x.params("sell",34))).status,"MARKET_PREFLIGHT_STALE");
  assert.equal(x.getCalls().filter(c=>c.method==="FillOrder").length,0);
  assert.equal(x.getCargo()[0].quantity,8);
 }finally{x.cleanup()}
});
test("native hull capacity strictly limits new cargo purchased from real seed stock",async()=>{
 const x=fixture();try{
  const t=x.trader();
  assert.equal((await t.execute(x.params("sell",34))).status,"TRADE_SETTLED");
  x.advance();x.setCapacity(0.2);
  const r=await t.execute(x.params("buy",35));
  assert.equal(r.status,"TRADE_SETTLED");
  assert.equal(r.quantity,2);assert.equal(r.balance,700);
  assert.equal(x.getCargo()[0].quantity,2);
  assert.equal(x.getRemaining().sell,98);
 }finally{x.cleanup()}
});
test("native market buyer price mismatch fails closed rather than crediting wrong ISK",async()=>{
 const x=fixture();try{
  const t=x.trader();
  // A deliberately incomplete/outdated RPC acknowledgement must not
  // credit ISK or consume cargo after seller-side market execution.
  x.setFailFill(true);
  assert.equal((await t.execute(x.params("sell",34))).status,"RPC_ACK_NOT_VERIFIABLE");
  assert.equal(x.getCargo()[0].quantity,8);
  assert.equal(t.recover().status,"NEEDS_OPERATOR_REPAIR");
 }finally{x.cleanup()}
});
test("unknown NPC cargo hull capacity stops purchases without altering seed stock",async()=>{
 const x=fixture();try{
  const t=x.trader();
  assert.equal((await t.execute(x.params("sell",34))).status,"TRADE_SETTLED");
  x.advance();x.setCapacity(null);
  assert.equal((await t.execute(x.params("buy",35))).status,
   "NATIVE_CARGO_CAPACITY_UNKNOWN");
  assert.equal(x.getRemaining().sell,100);
 }finally{x.cleanup()}
});

test("real seeded purchase keeps durable exact native cargo witness for offline rearm",async()=>{
 const x=fixture();try{
  const t=x.trader();
  assert.equal((await t.execute(x.params("sell",34))).status,"TRADE_SETTLED");
  x.advance();
  const bought=await t.execute(x.params("buy",35));
  assert.equal(bought.status,"TRADE_SETTLED");
  assert.equal(bought.buyReceipt.cargoID,bought.cargoID);
  const receipt=JSON.parse(readFileSync(join(x.root,"purchases",
   String(bought.cargoID)+".json"),"utf8"));
  assert.equal(receipt.phase,"SETTLED");
  assert.equal(receipt.source,"EVEJS_SEED_MARKET");
  assert.equal(receipt.pilotID,"coop-pilot-005");
  assert.equal(receipt.typeID,35);
  assert.equal(receipt.quantity,bought.quantity);
  assert.equal(receipt.marketOrderID,"9000000000000000444");
  assert.equal(x.getCalls().filter(c=>c.method==="AdjustSeedStock").length,1);
 }finally{x.cleanup()}
});
test("crash writing purchase receipt after real market ACK resumes without new market RPC",async()=>{
 const x=fixture();const nativeFS=require("node:fs");
 const rename=nativeFS.renameSync;
 try{
  const t=x.trader();
  assert.equal((await t.execute(x.params("sell",34))).status,"TRADE_SETTLED");
  x.advance();
  let interrupted=false;
  nativeFS.renameSync=(from,to)=>{
   if(!interrupted&&String(to).includes("purchases")){
    interrupted=true;throw Error("POWER_LOSS_AFTER_ACK");
   }
   return rename(from,to);
  };
  const first=await t.execute(x.params("buy",35));
  nativeFS.renameSync=rename;
  assert.equal(first.status,"NEEDS_MARKET_REPAIR");
  assert.equal(x.getRemaining().sell,90);
  const resumed=x.trader().recover();
  assert.equal(resumed.status,"RECOVERED");
  assert.equal(x.getCalls().filter(c=>c.method==="AdjustSeedStock").length,1);
  assert.equal(x.getCargo().filter(c=>c.typeID===35).length,1);
  const cargo=x.getCargo().find(c=>c.typeID===35);
  const receipt=JSON.parse(readFileSync(join(x.root,"purchases",
   String(cargo.cargoID)+".json"),"utf8"));
  assert.equal(receipt.source,"EVEJS_SEED_MARKET");
  assert.equal(x.trader().recover().status,"CLEAN");
 }finally{nativeFS.renameSync=rename;x.cleanup()}
});
