import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { adopt, plan, resetForTests } = require("../integration/coopHaulCargoAdoption.cjs");

const NOW = 1_700_000_000_000;

function fakeStore(rows, { entities = [], flushFails = false } = {}) {
  const table = new Map(rows.map((row) => [row.cargoID, { ...row }]));
  const writes = [];
  const events = [];
  return {
    writes,
    events,
    listNativeCargo: () => [...table.values()].map((row) => ({ ...row })),
    listNativeCargoForEntity: (id) => [...table.values()].filter((r) => r.entityID === id),
    upsertNativeCargo: (row) => {
      writes.push({ ...row });
      table.set(row.cargoID, { ...row });
      return { success: true };
    },
    buildNativeCargoItems: (id) => [...table.values()].filter((r) => r.entityID === id)
      .map((r) => ({ itemID: r.cargoID, typeID: r.typeID, quantity: r.quantity, volume: r.volume })),
    getNativeEntity: (id) => entities.find((e) => e.itemID === id) || null,
  };
}

function sceneWith(ships) {
  return {
    systemID: 30000145,
    getEntityByID: (id) => ships.find((s) => s.itemID === id) || null,
  };
}

const hauler = { itemID: 900000000501, ownerID: 5001, kind: "ship" };
const miner = { itemID: 900000000400, ownerID: 5001, kind: "ship" };

function orphan(over = {}) {
  return {
    cargoID: 7001,
    entityID: 900000000111,
    ownerID: 5001,
    typeID: 17464,
    quantity: 9000,
    volume: 0.1,
    moduleID: 0,
    transient: false,
    coopHaulFleetID: 1,
    coopHaulFromMinerID: miner.itemID,
    coopHaulSystemID: 30000145,
    coopHaulLoadedAt: NOW - 60_000,
    ...over,
  };
}

function fleet(over = {}) {
  return {
    fleetID: 1,
    systemID: 30000145,
    state: "mining",
    haulerEntityIDs: [hauler.itemID],
    minerEntityIDs: [miner.itemID],
    ...over,
  };
}

test.beforeEach(() => {
  resetForTests();
  process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION = "1";
});

test("stays disabled unless the adoption flag is on", () => {
  delete process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION;
  const store = fakeStore([orphan()]);
  const result = adopt(sceneWith([hauler, miner]), fleet(), { store, clock: () => NOW });
  assert.equal(result.status, "DISABLED");
  assert.equal(store.writes.length, 0);
});

test("re-points a provably orphaned durable cargo row onto the live hauler", () => {
  const store = fakeStore([orphan()]);
  const target = fleet();
  const result = adopt(sceneWith([hauler, miner]), target, {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: true }) },
  });
  assert.equal(result.status, "ADOPTED");
  assert.equal(result.adopted, 1);
  assert.equal(result.volumeM3, 900);
  const row = store.listNativeCargo()[0];
  assert.equal(row.cargoID, 7001, "the original native cargoID is preserved");
  assert.equal(row.entityID, hauler.itemID);
  assert.equal(row.ownerID, hauler.ownerID);
  assert.equal(row.coopHaulFleetID, 1);
  assert.equal(row.coopHaulSystemID, 30000145);
  assert.equal(row.coopHaulAdoptedAt, NOW);
  assert.equal(row.coopHaulAdoptedFrom, 900000000111);
  assert.equal(target.state, "loaded", "the normal loaded->station->sell pipeline takes over");
  assert.equal(target.lastHauledVolumeM3, 900);
  assert.deepEqual(target.haulerEntityIDs, [hauler.itemID]);
});

test("never adopts cargo whose original hauler still exists in the registry", () => {
  const store = fakeStore([orphan({ entityID: 900000000222 })], {
    entities: [{ itemID: 900000000222 }],
  });
  const result = adopt(sceneWith([hauler]), fleet(), { store, clock: () => NOW });
  assert.equal(result.status, "NO_ORPHAN_CARGO");
  assert.equal(store.writes.length, 0);
});

test("never adopts cargo from another system or another fleet slot", () => {
  const store = fakeStore([
    orphan({ cargoID: 7002, coopHaulSystemID: 30000144 }),
    orphan({ cargoID: 7003, coopHaulFleetID: 2 }),
    orphan({ cargoID: 7004, coopHaulSystemID: undefined }),
  ]);
  const planned = plan({
    store,
    scene: sceneWith([hauler]),
    systemID: 30000145,
    fleetID: 1,
    now: NOW,
  });
  assert.equal(planned.status, "NO_ORPHAN_CARGO");
  assert.equal(planned.rows.length, 0);
});

test("adopts exactly once per fleet slot", () => {
  const store = fakeStore([orphan()]);
  const database = { flushTableSync: () => ({ success: true }) };
  const scene = sceneWith([hauler]);
  const first = adopt(scene, fleet(), { store, clock: () => NOW, database });
  assert.equal(first.status, "ADOPTED");
  const second = adopt(scene, fleet({ state: "mining" }), { store, clock: () => NOW + 5000, database });
  assert.equal(second.status, "ALREADY_ATTEMPTED");
  assert.equal(store.writes.length, 1);
});

test("refuses a fleet that is already on a trip", () => {
  const store = fakeStore([orphan()]);
  const result = adopt(sceneWith([hauler]), fleet({ state: "hauling" }), { store, clock: () => NOW });
  assert.equal(result.status, "FLEET_NOT_IDLE");
  assert.equal(store.writes.length, 0);
});

test("never stacks a second batch on a hauler that already carries durable haul cargo", () => {
  const store = fakeStore([
    orphan(),
    orphan({ cargoID: 7099, entityID: hauler.itemID, coopHaulAdoptedAt: NOW - 1000 }),
  ]);
  const result = adopt(sceneWith([hauler]), fleet(), { store, clock: () => NOW });
  assert.equal(result.status, "HAULER_ALREADY_LOADED");
  assert.equal(store.writes.length, 0);
});

test("rolls back and re-flushes the original cargo if first durable flush fails", () => {
  const store = fakeStore([orphan()]);
  let flushes=0;
  const target=fleet();
  const result = adopt(sceneWith([hauler]), target, {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: ++flushes === 2 }) },
  });
  assert.equal(result.status, "CARGO_FLUSH_FAILED");
  assert.equal(result.adopted, 0);
  assert.equal(flushes,2);
  assert.equal(target.state,"mining");
  assert.equal(target.coopHaulNeedsOperatorRepair,undefined);
  assert.equal(store.listNativeCargo()[0].entityID, 900000000111);
});
test("failed durable compensation quarantines the fleet for operator repair",()=>{
 const store=fakeStore([orphan()]);
 const target=fleet();
 const result=adopt(sceneWith([hauler]),target,{
  store,clock:()=>NOW,
  database:{flushTableSync:()=>({success:false})}
 });
 assert.equal(result.status,"ADOPTION_RECOVERY_UNVERIFIED");
 assert.equal(result.adopted,0);
 assert.equal(target.state,"mining");
 assert.equal(target.coopHaulNeedsOperatorRepair,true);
});

test("expired orphans are archived by policy, never credited", () => {
  const store = fakeStore([orphan({ coopHaulLoadedAt: NOW - 4 * 60 * 60 * 1000 })]);
  const result = adopt(sceneWith([hauler]), fleet(), {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: true }) },
  });
  assert.equal(result.status, "NO_ORPHAN_CARGO");
  assert.equal(store.writes.length, 0);
});

test("falls back to the gameStore cargo table when the store cannot enumerate", () => {
  const store = fakeStore([]);
  delete store.listNativeCargo;
  const row = orphan();
  const result = adopt(sceneWith([hauler]), fleet(), {
    store,
    clock: () => NOW,
    database: { flushTableSync: () => ({ success: true }) },
    cargoTable: () => ({ [row.cargoID]: row }),
  });
  assert.equal(result.status, "ADOPTED");
  assert.equal(store.listNativeCargoForEntity(hauler.itemID).length, 1);
});

test("requires exactly one live hauler for the slot", () => {
  const store = fakeStore([orphan()]);
  const result = adopt(sceneWith([hauler]), fleet({ haulerEntityIDs: [hauler.itemID, 123] }), {
    store,
    clock: () => NOW,
  });
  assert.equal(result.status, "HAULER_NOT_UNIQUE");
  assert.equal(store.writes.length, 0);
});


test("never reassigns original NPC corporate title from an orphan with the same fleet slot",()=>{
 const otherCorp=9999;
 const store=fakeStore([
  orphan({cargoID:7001,ownerID:otherCorp}),
  orphan({cargoID:7002,entityID:900000000112,ownerID:hauler.ownerID})
 ]);
 const original=structuredClone(store.listNativeCargo());
 const target=fleet();
 const result=adopt(sceneWith([hauler,miner]),target,{
  store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"ORIGINAL_CARGO_OWNER_MISMATCH");
 assert.equal(result.adopted,0);
 assert.equal(store.writes.length,0);
 assert.deepEqual(store.listNativeCargo(),original);
 assert.equal(target.state,"mining");
 assert.equal(target.coopHaulAdoptedAt,undefined);
});
test("same-owner orphan batch can be attached only to its original corporate fleet",()=>{
 const store=fakeStore([
  orphan({cargoID:7001}),
  orphan({cargoID:7002,entityID:900000000112})
 ]);
 const result=adopt(sceneWith([hauler,miner]),fleet(),{
  store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"ADOPTED");
 assert.equal(result.adopted,2);
 assert.deepEqual(store.listNativeCargo().map(x=>x.ownerID),[hauler.ownerID,hauler.ownerID]);
 assert.deepEqual(store.listNativeCargo().map(x=>x.entityID),[hauler.itemID,hauler.itemID]);
});


test("partial multi-orphan cargo upsert failure restores all attempted original rows",()=>{
 for(const failure of ["reject","throw","mutate-then-reject"]){
  const store=fakeStore([
   orphan({cargoID:7001}),
   orphan({cargoID:7002,entityID:900000000112})
  ]);
  const originals=structuredClone(store.listNativeCargo());
  const originalWrite=store.upsertNativeCargo;
  let writes=0,flushes=0;
  store.upsertNativeCargo=row=>{
   writes++;
   if(writes===2){
    if(failure==="throw")throw Error("ORIGINAL_STORE_FAILED");
    if(failure==="mutate-then-reject")originalWrite(row);
    return {success:false,errorMsg:"NATIVE_CARGO_WRITE_FAILED"};
   }
   return originalWrite(row);
  };
  const target=fleet(),result=adopt(sceneWith([hauler,miner]),target,{
   store,clock:()=>NOW,
   database:{flushTableSync:()=>{flushes++;return {success:true}}}
  });
  assert.equal(result.status,"ADOPTION_REJECTED",failure);
  assert.equal(result.adopted,0);
  assert.equal(target.state,"mining");
  assert.equal(target.coopHaulNeedsOperatorRepair,undefined);
  assert.equal(flushes,1);
  assert.deepEqual(store.listNativeCargo(),originals);
 }
});
test("failed original cargo rollback never starts a half-loaded transport trip",()=>{
 const store=fakeStore([
  orphan({cargoID:7001}),
  orphan({cargoID:7002,entityID:900000000112})
 ]);
 const write=store.upsertNativeCargo;
 let attempts=0,flushes=0;
 store.upsertNativeCargo=row=>{
  attempts++;
  if(attempts===2||attempts===4)return {success:false,errorMsg:"NATIVE_WRITE_FAIL"};
  return write(row);
 };
 const target=fleet(),result=adopt(sceneWith([hauler]),target,{
  store,clock:()=>NOW,
  database:{flushTableSync:()=>{flushes++;return {success:true}}}
 });
 assert.equal(result.status,"ADOPTION_RECOVERY_UNVERIFIED");
 assert.equal(result.adopted,0);
 assert.equal(target.state,"mining");
 assert.equal(target.coopHaulNeedsOperatorRepair,true);
 assert.equal(target.lastHauledVolumeM3,undefined);
 assert.equal(flushes,1);
});


test("unavailable original hauler registry cannot authorize native cargo adoption",()=>{
 for(const failure of ["missing","throw"]){
  const store=fakeStore([orphan()]);
  if(failure==="missing")delete store.getNativeEntity;
  else store.getNativeEntity=()=>{throw Error("NATIVE_REGISTRY_READ_FAILED")};
  const target=fleet(),before=structuredClone(store.listNativeCargo());
  const result=adopt(sceneWith([hauler,miner]),target,{
   store,clock:()=>NOW,
   database:{flushTableSync:()=>({success:true})}
  });
  assert.equal(result.status,"NATIVE_ENTITY_REGISTRY_UNVERIFIED",failure);
  assert.equal(result.adopted,0);
  assert.deepEqual(store.listNativeCargo(),before);
  assert.equal(store.writes.length,0);
  assert.equal(target.state,"mining");
 }
});
test("one bad registry lookup invalidates the whole mixed orphan candidate batch",()=>{
 const store=fakeStore([
  orphan({cargoID:7001,entityID:900000000111}),
  orphan({cargoID:7002,entityID:900000000112})
 ]);
 store.getNativeEntity=id=>{
  if(id===900000000112)throw Error("NATIVE_REGISTRY_UNAVAILABLE");
  return null;
 };
 const target=fleet();
 const result=adopt(sceneWith([hauler]),target,{
  store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"NATIVE_ENTITY_REGISTRY_UNVERIFIED");
 assert.equal(store.writes.length,0);
 assert.equal(target.state,"mining");
 assert.deepEqual(store.listNativeCargo().map(x=>x.entityID),
  [900000000111,900000000112]);
});
test("original registry confirms ship is gone before same-owner cargo changes haulers",()=>{
 const store=fakeStore([orphan()]);
 const target=fleet();
 const result=adopt(sceneWith([hauler]),target,{
  store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"ADOPTED");
 assert.equal(store.listNativeCargo()[0].entityID,hauler.itemID);
 assert.equal(target.state,"loaded");
});


test("native cargo view failure after durable adoption quarantines both hauler and fleet",()=>{
 for(const fault of ["throw","empty"]){
  resetForTests();
  const store=fakeStore([
   orphan({cargoID:7001}),
   orphan({cargoID:7002,entityID:900000000112})
  ]);
  const build=store.buildNativeCargoItems;
  store.buildNativeCargoItems=id=>{
   if(fault==="throw")throw Error("POST_COMMIT_CARGO_VIEW_LOST");
   if(fault==="empty")return [];
   return build(id);
  };
  let flushes=0;
  const ship={...hauler,nativeCargoItems:undefined},target=fleet();
  const outcome=adopt(sceneWith([ship]),target,{
   store,clock:()=>NOW,
   database:{flushTableSync:()=>{flushes++;return{success:true}}}
  });
  assert.equal(outcome.status,"ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED",fault);
  assert.equal(outcome.adopted,0);
  assert.equal(flushes,1);
  assert.equal(target.state,"mining");
  assert.equal(target.coopHaulNeedsOperatorRepair,
   "ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED");
  assert.equal(ship.coopHaulNeedsOperatorRepair,
   "ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED");
  assert.deepEqual(store.listNativeCargo().map(x=>x.entityID),
   [ship.itemID,ship.itemID],"durable data remains for operator; never mint replacements");
  assert.equal(adopt(sceneWith([ship]),fleet(),{
   store,clock:()=>NOW+5000
  }).status,"ALREADY_ATTEMPTED");
 }
});
test("a silently missing or falsely owned post-flush cargo row blocks loaded fleet",()=>{
 for(const fault of ["missing","foreign-owner"]){
  resetForTests();
  const store=fakeStore([
   orphan({cargoID:7001}),
   orphan({cargoID:7002,entityID:900000000112})
  ]);
  const read=store.listNativeCargoForEntity;
  let calls=0;
  store.listNativeCargoForEntity=id=>{
   const rows=read(id);calls++;
   if(calls===1)return rows; // Native preflight: empty original hauler
   if(fault==="missing")return rows.slice(0,1);
   return rows.map((r,i)=>i===1?{...r,ownerID:9999}:r);
  };
  // Fresh ship view: an earlier scenario may have loaded the shared fixture.
  const ship={...hauler,nativeCargoItems:undefined},target=fleet();
  const result=adopt(sceneWith([ship]),target,{
   store,clock:()=>NOW,
   database:{flushTableSync:()=>({success:true})}
  });
  assert.equal(result.status,"ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED",fault);
  assert.equal(target.state,"mining");
  assert.equal(target.coopHaulNeedsOperatorRepair,
   "ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED");
  assert.equal(ship.nativeCargoItems,undefined);
 }
});
test("complete post-commit readback preserves original cargoIDs and starts exactly one normal trip",()=>{
 const store=fakeStore([
  orphan({cargoID:7001}),
  orphan({cargoID:7002,entityID:900000000112})
 ]);
 const target=fleet(),ship={...hauler};
 const result=adopt(sceneWith([ship]),target,{
  store,clock:()=>NOW,
  database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"ADOPTED");
 assert.equal(result.adopted,2);
 assert.equal(target.state,"loaded");
 assert.equal(target.coopHaulNeedsOperatorRepair,undefined);
 assert.deepEqual(ship.nativeCargoItems.map(x=>x.itemID),[7001,7002]);
 assert.deepEqual(store.listNativeCargo().map(x=>x.ownerID),[hauler.ownerID,hauler.ownerID]);
});

test("native preflight must prove existing hauler inventory before any adoption writes",()=>{
 for(const fault of ["null","throw","wrong-owner","wrong-ship","transient","malformed"]){
  const store=fakeStore([orphan()]);
  store.listNativeCargoForEntity=id=>{
   if(fault==="throw")throw Error("NATIVE_CARGO_READ_UNAVAILABLE");
   if(fault==="null")return null;
   if(fault==="malformed")return [{cargoID:0,entityID:id,ownerID:hauler.ownerID}];
   return [{cargoID:7888,entityID:fault==="wrong-ship"?123:id,
    ownerID:fault==="wrong-owner"?9999:hauler.ownerID,
    transient:fault==="transient",typeID:34,quantity:1}];
  };
  const target=fleet(),before=structuredClone(store.listNativeCargo());
  let flushes=0;
  const result=adopt(sceneWith([hauler,miner]),target,{
   store,clock:()=>NOW,
   database:{flushTableSync:()=>{flushes++;return {success:true}}}
  });
  assert.equal(result.status,"HAULER_CARGO_PREFLIGHT_UNVERIFIED",fault);
  assert.equal(result.adopted,0);
  assert.equal(store.writes.length,0);
  assert.equal(flushes,0);
  assert.equal(target.state,"mining");
  assert.deepEqual(store.listNativeCargo(),before);
 }
});

test("native ship item cache cannot substitute or misstate durable original cargoIDs",()=>{
 for(const fault of ["different-itemID","wrong-type","wrong-quantity","duplicated-itemID"]){
  // Each fault is a fresh first attempt against a fresh store: a custody
  // failure burns the slot, so without this reset only the first fault can
  // ever be observed.
  resetForTests();
  const store=fakeStore([
   orphan({cargoID:7001}),orphan({cargoID:7002,entityID:900000000112})
  ]);
  const builder=store.buildNativeCargoItems;
  store.buildNativeCargoItems=id=>{
   const result=builder(id);
   if(fault==="different-itemID")result[1]={...result[1],itemID:7999};
   if(fault==="wrong-type")result[1]={...result[1],typeID:34};
   if(fault==="wrong-quantity")result[1]={...result[1],quantity:1};
   if(fault==="duplicated-itemID")result[1]={...result[1],itemID:result[0].itemID};
   return result;
  };
  const ship={...hauler,nativeCargoItems:undefined},target=fleet();
  let flushes=0;
  const result=adopt(sceneWith([ship,miner]),target,{
   store,clock:()=>NOW,database:{flushTableSync:()=>{flushes++;return {success:true}}}
  });
  assert.equal(result.status,"ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED",fault);
  assert.equal(flushes,1,"the original cargo batch was committed once");
  assert.equal(result.adopted,0);
  assert.equal(target.state,"mining");
  assert.equal(ship.nativeCargoItems,undefined);
  assert.equal(target.coopHaulNeedsOperatorRepair,
   "ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED");
  assert.equal(ship.coopHaulNeedsOperatorRepair,
   "ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED");
  assert.deepEqual(store.listNativeCargo().map(x=>x.cargoID),[7001,7002]);
  assert.deepEqual(store.listNativeCargo().map(x=>x.entityID),
   [ship.itemID,ship.itemID],"physical custody is held for repair, not rolled back");
 }
});

test("post-commit transient or module-conflicted original cargo cannot start hauling",()=>{
 for(const fault of ["transient","module"]){
  resetForTests();
  const store=fakeStore([orphan()]);
  const read=store.listNativeCargoForEntity;
  let reads=0;
  store.listNativeCargoForEntity=id=>{
   const rows=read(id);
   if(++reads===1)return rows;
   return rows.map(row=>fault==="transient"
    ?{...row,transient:true}:{...row,moduleID:1234});
  };
  const ship={...hauler,nativeCargoItems:undefined},target=fleet();
  const result=adopt(sceneWith([ship]),target,{
   store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
  });
  assert.equal(result.status,"ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED",fault);
  assert.equal(target.state,"mining");
  assert.equal(ship.nativeCargoItems,undefined);
 }
});

test("a repeated original cargoID in native enumeration cannot be double-counted or adopted",()=>{
 const good=orphan({cargoID:7001});
 const fakeDuplicate={...good,entityID:900000000112};
 const store=fakeStore([good]);
 store.listNativeCargo=()=>[{...good},{...fakeDuplicate}];
 let flushes=0;
 const target=fleet();
 const result=adopt(sceneWith([hauler,miner]),target,{
  store,clock:()=>NOW,database:{flushTableSync:()=>{flushes++;return {success:true}}}
 });
 assert.equal(result.status,"NATIVE_CARGO_ID_COLLISION");
 assert.equal(result.adopted,0);
 assert.equal(store.writes.length,0);
 assert.equal(flushes,0);
 assert.equal(target.state,"mining");
 assert.equal(store.listNativeCargoForEntity(good.entityID).length,1);
});
test("a duplicate cargoID outside the target fleet still invalidates its physical source claim",()=>{
 const row=orphan({cargoID:7001});
 const another={...orphan({cargoID:7001,entityID:900000000222}),
  coopHaulSystemID:30000144,coopHaulFleetID:2};
 const store=fakeStore([row]);
 store.listNativeCargo=()=>[row,another];
 const planned=plan({
  store,scene:sceneWith([hauler]),systemID:30000145,
  fleetID:1,now:NOW
 });
 assert.equal(planned.status,"NATIVE_CARGO_ID_COLLISION");
 assert.deepEqual(planned.rows,[]);
 const result=adopt(sceneWith([hauler]),fleet(),{
  store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"NATIVE_CARGO_ID_COLLISION");
 assert.equal(store.writes.length,0);
});

test("pinned GameStore result envelope exposes original durable npcCargo rows",()=>{
 const row=orphan();
 const store=fakeStore([row]);delete store.listNativeCargo;
 let reads=0,flushes=0;
 const db={
  read:(table,path)=>{reads++;assert.equal(table,"npcCargo");assert.equal(path,"/cargo");
   return {success:true,data:{[row.cargoID]:{...row}}};},
  flushTableSync:()=>{flushes++;return {success:true};}
 };
 const target=fleet();
 const result=adopt(sceneWith([hauler,miner]),target,{store,database:db,clock:()=>NOW});
 assert.equal(result.status,"ADOPTED");
 assert.equal(result.adopted,1);
 assert.equal(reads,1);
 assert.equal(flushes,1);
 assert.equal(store.listNativeCargoForEntity(hauler.itemID).length,1);
 assert.equal(target.state,"loaded");
});

test("failed/malformed native GameStore read is not proof orphan cargo vanished",()=>{
 for(const data of [
  {success:false,data:{7001:orphan()}},{success:true,data:null},
  {success:true,data:[]},{success:true,data:"oops"},null
 ]){
  resetForTests();
  const store=fakeStore([orphan()]);delete store.listNativeCargo;
  let flushes=0;
  const db={read:()=>data,flushTableSync:()=>{flushes++;return {success:true}}};
  const target=fleet();
  const result=adopt(sceneWith([hauler]),target,{store,database:db,clock:()=>NOW});
  assert.equal(result.status,"CARGO_UNAVAILABLE",JSON.stringify(data));
  assert.equal(store.writes.length,0);
  assert.equal(flushes,0);
  assert.equal(target.state,"mining");
 }
});
test("authoritatively empty GameStore cargo table remains a genuine no-op",()=>{
 const store=fakeStore([]);delete store.listNativeCargo;
 const target=fleet();
 const result=adopt(sceneWith([hauler]),target,{
  store,database:{read:()=>({success:true,data:{}})},clock:()=>NOW
 });
 assert.equal(result.status,"NO_ORPHAN_CARGO");
 assert.equal(store.writes.length,0);
 assert.equal(target.state,"mining");
});
