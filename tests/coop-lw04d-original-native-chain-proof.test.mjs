import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createLivingWorldNativeChainProof}=require("../integration/coopLivingWorldNativeChainProof.cjs");
const OP="npc-manufacture:"+"a".repeat(32),CYCLE="coopMiningCycle:"+"1".repeat(64);
const OWNER=1000035,SYSTEM=30000142,STATION=60010001,CARGO=9800001,ORE=1234;
const ORE_TYPE=34,MINERAL=35,MINERAL_ITEM=1777001,JOB=970000000000000,ITEM=1990000200;
const ORDER=500,FILL=2345001,REFINE="coop-refine:v1:"+ORE+":50";
const HEX="a".repeat(64);
function fixture(){
 const mining={version:1,status:"COMMITTED",shipID:707,rockID:809,
  ownerID:OWNER,systemID:SYSTEM,cargoID:CARGO,oreTypeID:ORE_TYPE,
  quantity:50,beforeCargo:0,nextCargo:50,beforeRock:80,afterRock:30,
  wasted:0,normal:50};
 const haul={version:1,status:"COMMITTED",cargoID:CARGO,systemID:SYSTEM,
  minerID:707,haulerID:708,fleetID:42,quantity:50,typeID:ORE_TYPE,
  sourceOwnerID:OWNER,haulerOwnerID:OWNER,beforeHash:HEX,afterHash:HEX};
 const station={phase:"COMPLETED",cargoID:CARGO,stationID:STATION,
  ownerID:OWNER,systemID:SYSTEM,haulerID:708,fleetID:42,typeID:ORE_TYPE,
  quantity:50,before:10,after:60,completedAt:1000};
 const refinery={version:1,operationID:REFINE,phase:"COMMITTED",
  ownerID:OWNER,stationID:STATION,oreItemID:ORE,oreTypeID:ORE_TYPE,
  originalQuantity:50,sourceCustomInfo:"coop-warehouse:v1:cargo:"+CARGO,
  outputs:[{typeID:MINERAL,quantity:30}],nativeItemIDs:[MINERAL_ITEM],
  completedAt:2000};
 const job={jobID:JOB,coopOperationID:OP,ownerID:OWNER,stationID:STATION,
  facilityID:STATION,solarSystemID:SYSTEM,blueprintID:7701,
  productTypeID:215,activityID:1,status:4,totalCost:12.5,
  materials:{"35":10},
  coopMaterialDebits:[{itemID:MINERAL_ITEM,typeID:MINERAL,ownerID:OWNER,
   stationID:STATION,beforeQuantity:30,consumedQuantity:10,
   afterQuantity:20,sourceCustomInfo:REFINE+":mineral:"+MINERAL}],
  coopDelivery:{operationID:OP,itemID:ITEM,quantity:30}};
 const entry={phase:"SOLD",ownerID:OWNER,stationID:STATION,jobID:JOB,
  orderID:ORDER,itemID:ITEM,quantity:30,typeID:215,revenueCents:30000,
  settlementFillIDs:[FILL],
  settlementProof:"RUST_FINALIZED_GAMESTORE_BUYER_ITEM_AND_CORP_WALLET"};
 const journal={version:1,entries:{[OP]:entry},history:{}};
 const industryDebit={verifiedNative:true,jobID:JOB,ownerID:OWNER,
  transactionID:JOB,amountCents:1250};
 let saleAudits=0;
 const sale={status:"ORIGINAL_FULL_SALE_ATTESTED",operationID:OP,
  orderID:ORDER,ownerID:OWNER,stationID:STATION,
  soldQuantity:30,remainingQuantity:0,revenueCents:30000,
  fillIDs:[FILL],readOnly:true,nativeMutation:false,
  proof:"RUST_FINALIZED_GAMESTORE_BUYER_ITEM_AND_CORP_WALLET"};
 const probe=createLivingWorldNativeChainProof({
  readMiningCommit:()=>structuredClone(mining),
  readHaulReceipt:()=>structuredClone(haul),
  readStationReceipt:()=>structuredClone(station),
  readRefineryReceipt:()=>structuredClone(refinery),
  readOriginalIndustryJob:()=>structuredClone(job),
  readIndustryDebit:()=>structuredClone(industryDebit),
  readDirectorJournal:()=>structuredClone(journal),
  saleAudit:{audit:async()=>{saleAudits++;return structuredClone(sale)}},
  clock:()=>100000
 });
 const scope={operationID:OP,ownerID:OWNER,stationID:STATION,
  systemID:SYSTEM,miningOperationKey:CYCLE,cargoID:CARGO,oreItemID:ORE,
  refineOperationID:REFINE,oreTypeID:ORE_TYPE,mineralTypeID:MINERAL,orderID:ORDER};
 return{mining,haul,station,refinery,job,journal,industryDebit,sale,scope,
  probe,audit:()=>probe.audit(scope),get sales(){return saleAudits}};
}
test("full source model original miner→hauler→warehouse→refinery→BPO→paid Rust chain",async()=>{
 const f=fixture(),p=await f.audit();
 assert.equal(p.status,"SOURCE_CHAIN_ATTESTED");
 assert.equal(p.oreQuantity,50);assert.equal(p.consumedMineralQuantity,10);
 assert.equal(p.manufacturingCostCents,1250);
 assert.equal(p.revenueCents,30000);
 assert.deepEqual(p.originalFillIDs,[FILL]);
 assert.equal(p.nativeMutation,false);assert.equal(p.readOnly,true);
 assert.equal(p.realNativeE2E,false);assert.equal(p.requiresPinnedTwoClientGate,true);
 assert.equal(f.sales,1);
});
test("warehouse corporation different from manufacturing corp blocks before finance audit",async()=>{
 const f=fixture();f.station.ownerID=OWNER+1;
 assert.equal((await f.audit()).reason,
  "LW04D_WAREHOUSE_TO_MANUFACTURER_TITLE_TRANSFER_NOT_PROVEN");
 assert.equal(f.sales,0);
});
test("hauler owner different from manufacturer cannot silently transfer native minerals",async()=>{
 const f=fixture();f.haul.haulerOwnerID=OWNER+1;
 assert.equal((await f.audit()).reason,
  "LW04D_WAREHOUSE_TO_MANUFACTURER_TITLE_TRANSFER_NOT_PROVEN");
 assert.equal(f.sales,0);
});
test("original SQLite mined asteroid pre/post source conservation is mandatory",async()=>{
 const f=fixture();f.mining.afterRock++;
 assert.match((await f.audit()).reason,/ASTEROID_TO_MINER_UNVERIFIED/);
});
test("wrong original haul cargo ID or miner ID rejects title custody",async()=>{
 const f=fixture();f.haul.minerID++;
 assert.match((await f.audit()).reason,/MINER_HAULER_NATIVE_CUSTODY_UNVERIFIED/);
});
test("original station ore grant must account for all cargo units",async()=>{
 const f=fixture();f.station.after--;
 assert.match((await f.audit()).reason,/NATIVE_STATION_ORE_GRANT_UNVERIFIED/);
});
test("uncommitted refinery journal cannot prove original minerals",async()=>{
 const f=fixture();f.refinery.phase="PREPARED";
 assert.match((await f.audit()).reason,/NATIVE_REFINERY_RECEIPT_UNVERIFIED/);
});
test("warehouse refinery ore item must reference same original cargoID",async()=>{
 const f=fixture();f.refinery.sourceCustomInfo="coop-warehouse:v1:cargo:1";
 assert.match((await f.audit()).reason,/NATIVE_REFINERY_RECEIPT_UNVERIFIED/);
});
test("factory material debit must be recorded inside original job, not claimed externally",async()=>{
 const f=fixture();delete f.job.coopMaterialDebits;
 assert.match((await f.audit()).reason,/ORIGINAL_MANUFACTURING_JOB_UNVERIFIED/);
});
test("refined mineral itemID must be actual original factory input",async()=>{
 const f=fixture();f.job.coopMaterialDebits[0].itemID++;
 assert.match((await f.audit()).reason,/REFINED_ITEM_NOT_NATIVE_FACTORY_INPUT/);
});
test("BPO bill cannot differ from original consumed source mineral stack",async()=>{
 const f=fixture();f.job.materials["35"]=20;
 assert.match((await f.audit()).reason,/INDUSTRY_BILL_AND_SOURCE_DEBITS_DIVERGED/);
});
test("duplicate or wrong-owner native material debit blocks before finance",async()=>{
 const f=fixture();f.job.coopMaterialDebits.push({...f.job.coopMaterialDebits[0]});
 assert.match((await f.audit()).reason,/ORIGINAL_MATERIAL_SOURCE_INVALID/);
});
test("industry wallet debit is a genuine original persisted GameStore receipt",async()=>{
 const f=fixture();f.industryDebit.amountCents++;
 assert.match((await f.audit()).reason,/ORIGINAL_MANUFACTURING_ISK_NOT_DEBITED/);
});
test("original Rust sale without source director SOLD metadata cannot pass E2E",async()=>{
 const f=fixture();f.journal.entries[OP].phase="LISTED";
 assert.match((await f.audit()).reason,/DURABLE_PRODUCER_SOLD_NOT_ATTESTED/);
});
test("native Rust sale without exact wallet and fill conservation is blocked",async()=>{
 const f=fixture();f.sale.revenueCents++;
 assert.match((await f.audit()).reason,/ORIGINAL_RUST_SALE_NOT_ATTESTED/);
});
test("native source journal change during async Rust audit fails closed",async()=>{
 const f=fixture();
 const a=()=>structuredClone(f.journal);
 let reads=0;
 const bad=createLivingWorldNativeChainProof({
  readMiningCommit:()=>f.mining,readHaulReceipt:()=>f.haul,
  readStationReceipt:()=>f.station,readRefineryReceipt:()=>f.refinery,
  readOriginalIndustryJob:()=>f.job,readIndustryDebit:()=>f.industryDebit,
  readDirectorJournal:()=>{reads++;if(reads===2)f.journal.entries[OP].priceCents=44;
   return a()},saleAudit:{audit:async()=>f.sale},clock:()=>100000
 });
 assert.match((await bad.audit(f.scope)).reason,/ORIGINAL_SOURCE_CHANGED_DURING_GATE/);
});
test("source-only verifier never becomes a live A-Life writer or financial refund",()=>{
 const code=fs.readFileSync(new URL("../integration/coopLivingWorldNativeChainProof.cjs",import.meta.url),"utf8");
 assert.doesNotMatch(code,/\bsetInterval\s*\(|\bsetTimeout\s*\(/);
 assert.doesNotMatch(code,/\.transact\s*\(|\.installOnce\s*\(|\.claimOnce\s*\(|\.credit\s*\(/);
});
