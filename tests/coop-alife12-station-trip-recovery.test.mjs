import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const code=fs.readFileSync(new URL("../integration/coopNativeStationArrival.cjs",import.meta.url),"utf8");
const injected={exports:{}};
new Function("require","module","exports",code)(id=>{
 if(id==="./coopNativeWarehouse")return{createWarehouse:()=>{throw Error("UNEXPECTED_REAL_WAREHOUSE")}};
 if(id==="./coopAlifeNativeDeliveryEvidence")return{
  verifyFullNativeDelivery:(trip,m)=>({
   status:"NATIVE_FULL_MANIFEST_WITNESSED",manifestID:trip.manifestID,
   cargoIDs:m.cargoIDs,haulerIDs:m.haulerIDs,stacks:m.stacks,quantity:m.quantity,
   nativeMutation:false,iskCredited:false})};
 return require(id);
},injected,injected.exports);
const {createStationArrival,checkReturn}=injected.exports;
const SYSTEM=30000142,FLEET=SYSTEM*32+1,SHIP=980000000002,STATION=60010001,CORP=1000035,CARGO=980200000111,MINER=980000000001,START=100000;
function fixture(t,{ackFail=false,missingAck=false,recoveryBlocked=false}={}){
 const flags=["EVEJS_COOP_NATIVE_HAUL_MANIFEST","EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY",
 "EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE","EVEJS_COOP_NPC_STATION_DELIVERY"];
 const prev=Object.fromEntries(flags.map(x=>[x,process.env[x]]));
 for(const k of flags)process.env[k]="1";
 t.after(()=>{for(const [k,v] of Object.entries(prev)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }});
 const station={stationID:STATION,corporationID:CORP,solarSystemID:SYSTEM};
 const point={kind:"station",itemID:STATION,position:{x:10000,y:0,z:0},radius:500};
 const ship={kind:"ship",itemID:SHIP,ownerID:CORP,nativeNpc:true,transient:false,
  position:{x:0,y:0,z:0},radius:100,mode:"STOP",pendingWarp:null};
 const scene={systemID:SYSTEM,staticEntities:[point],getEntityByID:id=>id===SHIP?ship:null};
 const cargo=new Map([[CARGO,{cargoID:CARGO,entityID:SHIP,coopHaulFleetID:FLEET,
  coopHaulFromMinerID:MINER,typeID:34,quantity:13,moduleID:0,transient:false}]]);
 const manifestKey=SYSTEM+"-"+FLEET+"-"+START;
 let now=START,acks=0,warps=0,prepares=0,deposits=0,verifies=0;
 let writtenAck=false;
 const originalManifest={
  prepare:()=>{prepares++;return {status:"MANIFEST_DURABLY_PREPARED",
   key:manifestKey,cargoIDs:[CARGO]}},
  verify:()=>{verifies++;return {status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",
   key:manifestKey,stationID:STATION,haulerIDs:[SHIP],cargoIDs:[CARGO],
   stacks:1,quantity:13,convoySaved:false,paidReward:false}}
 };
 const journal={
  confirm:()=>{acks++;if(ackFail)return{status:"NEEDS_OPERATOR_REPAIR"};
   writtenAck=true;return{status:"DURABLE_DEPARTURE_CONFIRMED"}},
  recover:()=>missingAck?{status:"NEEDS_OPERATOR_REPAIR",reason:"ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED"}:
    recoveryBlocked?{status:"NEEDS_OPERATOR_REPAIR",reason:"ALIFE12_SOURCE_CARGO_CHANGED"}:
    writtenAck&&cargo.has(CARGO)?{
      status:"RECOVERED_NATIVE_TRIP",trip:{
       systemID:SYSTEM,fleetID:FLEET,stationID:STATION,corporationID:CORP,
       startedAt:START,manifestID:manifestKey,expectedCargoIDs:[CARGO],
       haulers:{[SHIP]:{arrivedAt:0}}},activeCargo:1}:{
      status:"NO_PENDING_TRIP"}
 };
 const store={listNativeCargoForEntity:id=>id===SHIP?[...cargo.values()]:[],
  buildNativeCargoItems:id=>id===SHIP?[...cargo.values()]:[]};
 const warehouse={deposit:({cargoID})=>{deposits++;cargo.delete(cargoID);return{status:"COMMITTED"}}};
 const args={
  getStations:()=>[station],getStation:id=>id===STATION?station:null,
  getCorporation:id=>id===CORP?{corporationID:CORP}:null,
  isNpcCorporation:id=>id===CORP,
  getNativeEntity:id=>id===SHIP?{entityID:SHIP,systemID:SYSTEM,transient:false}:null,
  getScene:()=>scene,store,items:{},flush:()=>({success:true}),
  warpToPoint:()=>{warps++;return{success:true}},root:"/tmp/alife12-integration",
  warehouse,manifest:originalManifest,tripJournal:journal,clock:()=>now,
  probe:{observe:()=>{}}
 };
 const director=()=>createStationArrival(args);
 const newFleet=()=>({systemID:SYSTEM,fleetID:FLEET,startupKey:SYSTEM+":1",haulerEntityIDs:[SHIP],state:"loaded"});
 return{scene,ship,point,cargo,newFleet,director,journal,
  setNow:value=>now=value,
  arrive(){ship.position={...point.position};ship.mode="STOP";ship.pendingWarp=null},
  get warps(){return warps},get acks(){return acks},
  get prepares(){return prepares},get deposits(){return deposits},get verifies(){return verifies}};
}
test("original first route prepares immutable manifest then confirms native warp ACK",t=>{
 const f=fixture(t),fleet=f.newFleet(),director=f.director();
 assert.equal(director.start(f.scene,fleet,START).status,"EN_ROUTE");
 assert.equal(f.prepares,1);assert.equal(f.warps,1);assert.equal(f.acks,1);
 assert.equal(fleet.coopStationArrival.manifestID,SYSTEM+"-"+FLEET+"-"+START);
});
test("cold restart reconstructs original route with zero additional physical warp commands",t=>{
 const f=fixture(t),fleet=f.newFleet(),first=f.director();
 assert.equal(first.start(f.scene,fleet,START).status,"EN_ROUTE");
 const rebootFleet=f.newFleet(),second=f.director();
 const result=second.start(f.scene,rebootFleet,START+1000);
 assert.equal(result.status,"RECOVERED_EN_ROUTE");
 assert.equal(result.warpOrdered,false);
 assert.equal(f.warps,1);
 assert.equal(f.prepares,1);
 assert.equal(rebootFleet.coopStationArrival.haulers[SHIP].arrivedAt,0);
});
test("restored hull must genuinely reach physical station and dwell before warehouse credit",t=>{
 const f=fixture(t),fleet=f.newFleet();
 f.director().start(f.scene,fleet,START);
 const after=f.newFleet(),second=f.director();
 assert.equal(second.start(f.scene,after,START+1000).status,"RECOVERED_EN_ROUTE");
 assert.equal(second.tick(f.scene,after,START+1500).status,"AWAITING_PHYSICAL_ARRIVAL");
 assert.equal(f.deposits,0);
 f.arrive();
 assert.equal(second.tick(f.scene,after,START+2000).status,"ARRIVAL_DWELL_PENDING");
 const output=second.tick(f.scene,after,START+4500);
 assert.equal(output.status,"DELIVERED");
 assert.equal(output.stacks,1);assert.equal(output.quantity,13);
 assert.equal(f.deposits,1);
 assert.equal(f.cargo.size,0);
 assert.equal(f.warps,1);
});
test("haulereturn state with lost in-memory trip calls only verified read-only recovery",t=>{
 const f=fixture(t),fleet=f.newFleet();
 f.director().start(f.scene,fleet,START);
 const recovered=f.newFleet(),second=f.director();
 const result=checkReturn(f.scene,recovered,START+1000,second);
 assert.equal(result.status,"AWAITING_PHYSICAL_ARRIVAL");
 assert.ok(recovered.coopStationArrival);
 assert.equal(f.warps,1);
});
test("lost warp ACK prevents a second warp after restart",t=>{
 const f=fixture(t,{ackFail:true,missingAck:true}),fleet=f.newFleet();
 const first=f.director();
 assert.equal(first.start(f.scene,fleet,START).status,"ALIFE12_WARP_ACK_DURABILITY_UNCERTAIN");
 assert.equal(f.warps,1);
 assert.equal(first.tick(f.scene,fleet,START+6000).status,"ALIFE12_TRIP_JOURNAL_NEEDS_OPERATOR_REPAIR");
 const second=f.director(),reboot=f.newFleet();
 const attempted=second.start(f.scene,reboot,START+1000);
 assert.match(attempted.status,/ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED/);
 assert.equal(f.warps,1);
 assert.equal(f.deposits,0);
});
test("corrupt recovered source cannot cause warp or station credits",t=>{
 const f=fixture(t,{recoveryBlocked:true}),fleet=f.newFleet();
 f.director().start(f.scene,fleet,START);
 const reboot=f.newFleet(),r=f.director().start(f.scene,reboot,START+1000);
 assert.match(r.status,/ALIFE12_SOURCE_CARGO_CHANGED/);
 assert.equal(f.warps,1);
 assert.equal(f.deposits,0);
});
test("a physically absent real station after restart cannot authorize cargo credit",t=>{
 const f=fixture(t),fleet=f.newFleet();
 f.director().start(f.scene,fleet,START);
 f.scene.staticEntities=[];
 const reboot=f.newFleet(),r=f.director().start(f.scene,reboot,START+1000);
 assert.equal(r.status,"ALIFE12_RECOVERED_STATION_OR_DEADLINE_INVALID");
 assert.equal(f.deposits,0);
});
test("expired original route never gets a new deadline or automatic rewarp",t=>{
 const f=fixture(t),fleet=f.newFleet();
 f.director().start(f.scene,fleet,START);
 const reboot=f.newFleet(),r=f.director().start(f.scene,reboot,START+16*60*1000);
 assert.equal(r.status,"ALIFE12_RECOVERED_STATION_OR_DEADLINE_INVALID");
 assert.equal(f.warps,1);
 assert.equal(f.deposits,0);
});
