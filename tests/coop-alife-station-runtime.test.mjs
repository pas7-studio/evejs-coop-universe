import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRuntimeStationAuthority,parseTargets}=require("../integration/coopAlifeStationAuthorityRuntime.cjs");
const OWNER=1000010,STATION=60000001,SYSTEM=30000142,REGION=10000002,PRODUCT=215,BPO=30001,BPOITEM=99901;
function setup(){
 const data={wallet:100,version:1,marketCalls:[],items:[
 {itemID:BPOITEM,typeID:BPO,ownerID:OWNER,locationID:STATION,flagID:4,singleton:1,quantity:1},
 {itemID:123,typeID:34,ownerID:OWNER,locationID:STATION,flagID:4,quantity:20,stacksize:20}
 ]};
 const deps={
  worldData:{getStationByID:id=>id===STATION?{stationID:id,solarSystemID:SYSTEM,regionID:REGION}:null},
  corporationState:{getCorporationRecord:id=>({corporationID:id,isNPC:true})},
  corporationRuntime:{getCorporationRuntime:id=>({corporationID:id,wallet:{divisions:{"1000":{balance:data.wallet}}}})},
  itemStore:{listOwnedItems:()=>structuredClone(data.items),
   findItemById:id=>structuredClone(data.items.find(i=>i.itemID===id)||null),
   getItemMutationVersion:()=>data.version},
  industryStatic:{getFacilityPayloadByID:id=>({facilityID:id,solarSystemID:SYSTEM,online:true,activities:{1:{}}}),
   getBlueprintDefinitionByProductTypeID:id=>({productTypeID:id,blueprintTypeID:BPO})},
  industryRuntime:{getBlueprintState:()=>({original:true,typeID:BPO,materialEfficiency:0,jobID:0})},
  industryParity:{buildIndustryActivityMaterials:()=>[{typeID:34,quantity:10}]},
  gameStore:{read:(table,path)=>({success:true,data:
   table==="industryJobs"&&path==="/jobs"?{}:
   table==="marketEscrow"&&path==="/"?{}:null})},
  marketClient:{call:async(method,args)=>{data.marketCalls.push({method,args});return{sells:[]}}}
 };
 return {data,deps,create:()=>createRuntimeStationAuthority({products:[{typeID:PRODUCT,targetStock:50}],
  clock:()=>1000000,deps})};
}
test("parseTargets refuses malformed unsafe or oversized user configuration",()=>{
 for(const s of ["","null","{}","[{}]","[{\"typeID\":0,\"targetStock\":30}]"])
  assert.throws(()=>parseTargets(s),/PRODUCTS_INVALID|invalid/i);
 const x=parseTargets('[{"typeID":215,"targetStock":30}]');
 assert.equal(x[0].typeID,215);
});
test("pinned wrapper reads real gameStore jobs and marketEscrow keys and the Rust GetOrders method",async()=>{
 const f=setup(),r=await f.create().read({ownerID:OWNER,stationID:STATION,systemID:SYSTEM});
 assert.equal(r.authoritativeNative,true);
 assert.equal(r.productShortage,50);
 assert.deepEqual(f.data.marketCalls,[{method:"GetOrders",args:{region_id:REGION,type_id:PRODUCT}}]);
});
test("missing native market response fails closed",async()=>{
 const f=setup();f.deps.marketClient.call=async()=>null;
 const r=await f.create().read({ownerID:OWNER,stationID:STATION,systemID:SYSTEM});
 assert.equal(r.authoritativeNative,false);assert.equal(r.reason,"NATIVE_RUST_MARKET_BOOK_UNAVAILABLE");
});
test("a failed authoritative native GameStore row blocks the station",async()=>{
 const f=setup();f.deps.gameStore.read=()=>({success:false,errorMsg:"ENTRY_NOT_FOUND"});
 const r=await f.create().read({ownerID:OWNER,stationID:STATION,systemID:SYSTEM});
 assert.equal(r.authoritativeNative,false);assert.match(r.reason,/NATIVE_ALIFE_READ_FAILED/);
});
test("invalid deps or a missing actual ItemStore mutation clock are never allowed",()=>{
 const f=setup();delete f.deps.itemStore.getItemMutationVersion;
 assert.throws(()=>f.create(),/READER_DEPENDENCIES/);
});
test("read path never sends PlaceOrder, FillOrder, industry install or wallet debit",async()=>{
 const f=setup();const r=await f.create().read({ownerID:OWNER,stationID:STATION,systemID:SYSTEM});
 assert.equal(r.source,"GAMESTORE_ITEMSTORE_SDE_RUST");
 assert.ok(f.data.marketCalls.every(x=>x.method==="GetOrders"));
});
