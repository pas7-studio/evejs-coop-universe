import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patchMiningCargo}=require("../scripts/coop-native-mining-cargo-integrity-patch.cjs");
// Source-shaped upstream fixture: production test in patched original code
// is also exercised by the pinned-source compatibility gate.
const original=[
 'function ensureNpcCargoStoreEntry(entity,cargoItem){',
 ' if(!entity||!cargoItem||toInt(cargoItem.itemID,0)<=0)return;',
 '  nativeNpcStore.upsertNativeCargo({',
 '  cargoID:cargoItem.itemID,entityID:entity.itemID,ownerID:entity.ownerID,',
 '  typeID:cargoItem.typeID,moduleID:0,groupID:cargoItem.groupID,',
 '  categoryID:cargoItem.categoryID,itemName:cargoItem.itemName,',
 '  quantity:cargoItem.quantity,transient:entity.transient===true',
 ' },{transient:entity.transient===true});',
 '}',
 'function appendNpcMiningCargo(entity, typeID, quantity) {',
 ' if(!Array.isArray(entity.nativeCargoItems))entity.nativeCargoItems=[];',
 ' const old=entity.nativeCargoItems.find(x=>x.typeID===typeID&&x.moduleID===0);',
 ' if(old){old.quantity+=quantity;old.stacksize=old.quantity;',
 '  ensureNpcCargoStoreEntry(entity,old);return;}',
 ' const alloc=nativeNpcStore.allocateCargoID({transient:entity.transient===true});',
 ' const itemID=alloc?.success&&alloc.data?alloc.data:-(entity.nativeCargoItems.length+1);',
 ' const typeRecord=resolveItemByTypeID(typeID)||{};',
 ' const row={itemID,ownerID:entity.ownerID,locationID:entity.itemID,',
 '  moduleID:0,typeID,groupID:typeRecord.groupID,categoryID:typeRecord.categoryID,',
 '  itemName:typeRecord.name,quantity,stacksize:quantity,volume:typeRecord.volume};',
 ' entity.nativeCargoItems.push(row);ensureNpcCargoStoreEntry(entity,row);',
 '}'
].join("\n");
function fixture(enabled=true){
 let mode="ok",alloc="ok",nextID=510,reads="ok",writeCount=0,allocCount=0;
 const rows=new Map(),events=[],ship={itemID:501,ownerID:77,
  transient:false,nativeCargoItems:[]};
 const store={
  allocateCargoID(){events.push("allocate");allocCount++;
   if(alloc==="fail")return {success:false};
   if(alloc==="throw")throw Error("allocation unknown");
   return {success:true,data:nextID++}},
  upsertNativeCargo(row){events.push("upsert");writeCount++;
   if(mode==="fail")return {success:false};
   if(mode==="throwBefore")throw Error("unknown");
   rows.set(row.cargoID,{...row});
   if(mode==="throwAfter")throw Error("uncertain after COMMIT");
   return{success:true}},
  listNativeCargoForEntity(id){events.push("read");
   if(reads==="throw")throw Error("read failed");
   if(reads==="empty")return [];
   return [...rows.values()].filter(x=>x.entityID===id)}
 };
 const make=flag=>new Function("nativeNpcStore","resolveItemByTypeID",
 "toInt","toFiniteNumber","process","console",
 patchMiningCargo(original)+";return appendNpcMiningCargo;")(
 store,()=>({groupID:465,categoryID:25,name:"Veldspar",volume:0.1}),
 (v,f=0)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):f,
 (v,f=0)=>Number.isFinite(Number(v))?Number(v):f,
 {env:{EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY:flag?"1":"0"}},
 {warn(){}});
 const append=make(enabled);
 return {append,make,ship,rows,events,store,setWrite:v=>mode=v,setAlloc:v=>alloc=v,
  setRead:v=>reads=v,writes:()=>writeCount,allocs:()=>allocCount};
}
test("patch is reversible/idempotent and rejects tampered half-edits",()=>{
 const once=patchMiningCargo(original);
 assert.notEqual(once,original);
 assert.equal(patchMiningCargo(once),once);
 assert.equal(patchMiningCargo(once,true),original);
 assert.equal(patchMiningCargo(original,true),original);
 assert.throws(()=>patchMiningCargo(once.replace(
  "COOP_ALIFE_MINING_STRICT_CARGO_V1","BROKEN_PATCH")),
  /Unexpected native mining cargo integrity source/);
});
test("default OFF preserves vanilla negative cargo fallback",()=>{
 const f=fixture(false);f.setAlloc("fail");
 f.append(f.ship,34,5);
 assert.equal(f.ship.nativeCargoItems[0].itemID,-1);
 assert.equal(f.rows.size,0);
});
test("strict native first write precedes ship cargo commit, matching owner and ID",()=>{
 const f=fixture();assert.equal(f.append(f.ship,34,7),true);
 assert.deepEqual(f.events,["read","allocate","upsert","read"]);
 assert.equal(f.rows.get(510).quantity,7);
 assert.equal(f.ship.nativeCargoItems[0].itemID,510);
});
test("strict existing stack writes exact delta only after store source verified",()=>{
 const f=fixture();f.append(f.ship,34,7);f.events.length=0;
 assert.equal(f.append(f.ship,34,4),true);
 assert.equal(f.ship.nativeCargoItems[0].quantity,11);
 assert.equal(f.rows.get(510).quantity,11);
 assert.equal(f.rows.size,1);
 assert.deepEqual(f.events,["read","upsert","read"]);
});
test("failed allocation never makes negative/local cargo when strict",()=>{
 const f=fixture();f.setAlloc("fail");
 assert.equal(f.append(f.ship,34,9),false);
 assert.equal(f.ship.nativeCargoItems.length,0);
 assert.equal(f.writes(),0);
});
test("uncertain allocation latches repair and forbids later auto retry",()=>{
 const f=fixture();f.setAlloc("throw");f.append(f.ship,34,1);
 assert.equal(f.ship.coopMiningCargoNeedsOperatorRepair,"NATIVE_MINING_CARGO_ID_ALLOCATE_UNKNOWN");
 f.setAlloc("ok");f.append(f.ship,34,10);
 assert.equal(f.allocs(),1);
 assert.equal(f.rows.size,0);
});
test("rejected upsert leaves ship cargo unchanged and requires operator proof",()=>{
 const f=fixture();f.setWrite("fail");
 assert.equal(f.append(f.ship,34,3),false);
 assert.equal(f.rows.size,0);
 assert.equal(f.ship.nativeCargoItems.length,0);
 assert.equal(f.ship.coopMiningCargoNeedsOperatorRepair,"NATIVE_MINING_CARGO_WRITE_UNCONFIRMED");
 f.setWrite("ok");f.append(f.ship,34,10);
 assert.equal(f.rows.size,0);
});
test("upsert exception after store COMMIT cannot cause a duplicate local write",()=>{
 const f=fixture();f.setWrite("throwAfter");f.append(f.ship,34,5);
 assert.equal(f.rows.get(510).quantity,5);
 assert.equal(f.ship.nativeCargoItems.length,0);
 f.setWrite("ok");f.append(f.ship,34,10);
 assert.equal(f.rows.get(510).quantity,5);
});
test("restart with durable store row and no local stack blocks second cargoID",()=>{
 const f=fixture();
 f.rows.set(311,{cargoID:311,entityID:501,ownerID:77,typeID:34,moduleID:0,quantity:6});
 assert.equal(f.append(f.ship,34,10),false);
 assert.equal(f.allocs(),0);
 assert.equal(f.ship.coopMiningCargoNeedsOperatorRepair,"NATIVE_MINING_CARGO_STORE_ALREADY_HAS_TYPE");
});
test("source mismatch never updates an existing local row",()=>{
 for(const diff of [{ownerID:999},{typeID:35},{quantity:2}]){
  const f=fixture(),row={itemID:511,ownerID:77,locationID:501,
   moduleID:0,typeID:34,quantity:7,stacksize:7};
  f.ship.nativeCargoItems.push(row);
  f.rows.set(511,{cargoID:511,entityID:501,ownerID:77,
   typeID:34,moduleID:0,quantity:7,...diff});
  assert.equal(f.append(f.ship,34,5),false);
  assert.equal(row.quantity,7);assert.equal(f.writes(),0);
 }
});
test("negative pre-existing cargo cannot silently upgrade to native entry",()=>{
 const f=fixture();f.ship.nativeCargoItems.push({itemID:-1,
  ownerID:77,locationID:501,typeID:34,moduleID:0,quantity:2});
 assert.equal(f.append(f.ship,34,1),false);
 assert.equal(f.rows.size,0);
});
test("read failure/failed postwrite readback never credits local hull",()=>{
 const first=fixture();first.setRead("throw");
 assert.equal(first.append(first.ship,34,1),false);
 assert.equal(first.allocs(),0);
 const second=fixture();second.setRead("empty");
 assert.equal(second.append(second.ship,34,3),false);
 assert.equal(second.ship.nativeCargoItems.length,0);
 assert.equal(second.ship.coopMiningCargoNeedsOperatorRepair,
 "NATIVE_MINING_CARGO_READBACK_UNKNOWN");
});
test("oversized quantity does not overflow an existing committed native cargo",()=>{
 const f=fixture(),limit=1000000000;
 f.ship.nativeCargoItems.push({itemID:511,ownerID:77,locationID:501,
  moduleID:0,typeID:34,quantity:limit,stacksize:limit});
 f.rows.set(511,{cargoID:511,entityID:501,ownerID:77,typeID:34,
  moduleID:0,quantity:limit});
 assert.equal(f.append(f.ship,34,1),false);
 assert.equal(f.rows.get(511).quantity,limit);
});

test("Windows CRLF checkout is patched and restored byte-for-byte",()=>{
 const originalCRLF=original.replace(/\n/g,"\r\n");
 const p=patchMiningCargo(originalCRLF);
 assert.notEqual(p,originalCRLF);
 assert.equal(patchMiningCargo(p),p);
 assert.equal(patchMiningCargo(p,true),originalCRLF);
});
test("incomplete patch with missing native return is refused, never repaired by guess",()=>{
 const full=patchMiningCargo(original);
 const broken=full.replace("  return nativeNpcStore.upsertNativeCargo({",
  "  nativeNpcStore.upsertNativeCargo({");
 assert.throws(()=>patchMiningCargo(broken),/Unexpected native mining cargo integrity source/);
});

test("fresh native miner without an initialized cargo array earns persisted ore once",()=>{
 const f=fixture();delete f.ship.nativeCargoItems;
 assert.equal(f.append(f.ship,34,4),true);
 assert.equal(f.rows.get(510).quantity,4);
 assert.equal(f.ship.nativeCargoItems.length,1);
 assert.equal(f.ship.nativeCargoItems[0].itemID,510);
});
test("failed first cargo write does not even create an empty optimistic hull array",()=>{
 const f=fixture();delete f.ship.nativeCargoItems;
 f.setWrite("fail");
 assert.equal(f.append(f.ship,34,4),false);
 assert.equal(f.ship.nativeCargoItems,undefined);
 assert.equal(f.rows.size,0);
});
