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
  delete process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION;
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
    cargoTable: () => {
      const current=store.listNativeCargoForEntity(hauler.itemID)[0]||row;
      return { [row.cargoID]: current };
    },
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
   const current=store.listNativeCargoForEntity(hauler.itemID)[0]||row;
   return {success:true,data:{[row.cargoID]:{...current}}};},
  flushTableSync:()=>{flushes++;return {success:true};}
 };
 const target=fleet();
 const result=adopt(sceneWith([hauler,miner]),target,{store,database:db,clock:()=>NOW});
 assert.equal(result.status,"ADOPTED");
 assert.equal(result.adopted,1);
 assert.equal(reads,2,"preflight and post-commit both consult the original table");
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

function secondCrashCargo(over={}) {
 return orphan({coopHaulAdoptedAt:NOW-30_000,
  coopHaulAdoptedFrom:900000000100,...over});
}
function clearCustody(over={}) {
 return {
  warehouseRoot:"/tmp/evejs-warehouse-proof",
  custodyIo:{readdirSync:()=>[]},
  custodyItems:{findWarehouseItem:()=>null},
  custodyDepot:{snapshot:()=>({version:1,receipts:{},pending:{}})},
  ...over
 };
}
function secondCrashAttempt(row=secondCrashCargo(),over={}) {
 const ship={...hauler,nativeCargoItems:undefined};
 const store=fakeStore([row]);
 const target=fleet();
 let flushes=0;
 const result=adopt(sceneWith([ship,miner]),target,{
  store,clock:()=>NOW,probe:{},
  database:{flushTableSync:()=>{flushes++;return {success:true}}},
  ...clearCustody(),...over
 });
 return {result,ship,store,target,flushes};
}
test("second restart cannot re-adopt an existing cargo without separate opt-in",()=>{
 const f=secondCrashAttempt();
 assert.equal(f.result.status,"NO_ORPHAN_CARGO");
 assert.equal(f.store.writes.length,0);
 assert.equal(f.target.state,"mining");
});
test("second restart reattaches the SAME original cargoID when all original settlement authorities attest absence",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const f=secondCrashAttempt();
 assert.equal(f.result.status,"ADOPTED");
 assert.equal(f.flushes,1);
 assert.equal(f.result.adopted,1);
 assert.equal(f.target.state,"loaded");
 assert.equal(f.store.listNativeCargo().length,1);
 const original=f.store.listNativeCargo()[0];
 assert.equal(original.cargoID,7001);
 assert.equal(original.entityID,hauler.itemID);
 assert.equal(original.ownerID,hauler.ownerID);
 assert.equal(original.coopHaulAdoptedFrom,900000000111);
 assert.equal(f.ship.nativeCargoItems[0].itemID,7001);
});
test("prior live/registered hauler always blocks second restart without querying settlement",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const f=secondCrashAttempt(undefined,{
  custodyIo:{readdirSync:()=>{throw Error("SHOULD_NOT_READ")}}
 });
 assert.equal(f.result.status,"RE_ADOPTION_SETTLEMENT_UNVERIFIED");
 // A physically registered previous carrier is stronger than any absence proof.
 resetForTests();
 const row=secondCrashCargo(),store=fakeStore([row],{
  entities:[{itemID:row.entityID}]
 });
 const target=fleet();
 const result=adopt(sceneWith([hauler]),target,{
  store,clock:()=>NOW,probe:{},...clearCustody(),
  database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"NO_ORPHAN_CARGO");
 assert.equal(store.writes.length,0);
});
test("any original warehouse receipt, in-progress temp, ItemStore stock, or depot ledger blocks replay",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const cases=[
  ["committed receipt",{custodyIo:{readdirSync:()=>["7001.json"]}},
   "RE_ADOPTION_WAREHOUSE_RECEIPT_EXISTS"],
  ["pending file",{custodyIo:{readdirSync:()=>["7001.json.tmp-101-2"]}},
   "RE_ADOPTION_WAREHOUSE_RECEIPT_EXISTS"],
  ["original native stock",{custodyItems:{findWarehouseItem:()=>({itemID:55})}},
   "RE_ADOPTION_WAREHOUSE_ITEM_EXISTS"],
  ["depot committed",{custodyDepot:{snapshot:()=>({version:1,receipts:{"7001":{status:"COMMITTED"}},pending:{}})}},
   "RE_ADOPTION_DEPOT_RECEIPT_EXISTS"],
  ["depot pending",{custodyDepot:{snapshot:()=>({version:1,receipts:{},pending:{"7001":{status:"PREPARED"}}})}},
   "RE_ADOPTION_DEPOT_RECEIPT_EXISTS"]
 ];
 for(const [name,over,status] of cases){
  resetForTests();
  const f=secondCrashAttempt(secondCrashCargo(),over);
  assert.equal(f.result.status,status,name);
  assert.equal(f.store.writes.length,0,name);
  assert.equal(f.flushes,0,name);
  assert.equal(f.target.state,"mining",name);
 }
});
test("unreadable original warehouse/depot/ItemStore or corrupt lineage never authorizes second adoption",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const faults=[
  {custodyIo:{readdirSync:()=>{throw Error("EIO")}}},
  {custodyIo:{readdirSync:()=>null}},
  {custodyItems:{findWarehouseItem:()=>{throw Error("EIO")}}},
  {custodyItems:{}},
  {custodyDepot:{snapshot:()=>{throw Error("EIO")}}},
  {custodyDepot:{snapshot:()=>null}},
  {warehouseRoot:"relative/untrusted"}
 ];
 for(const over of faults){
  resetForTests();
  const f=secondCrashAttempt(secondCrashCargo(),over);
  assert.equal(f.result.status,"RE_ADOPTION_SETTLEMENT_UNVERIFIED");
  assert.equal(f.store.writes.length,0);
  assert.equal(f.target.state,"mining");
 }
 resetForTests();
 const invalid=secondCrashAttempt(secondCrashCargo({coopHaulAdoptedFrom:0}));
 assert.equal(invalid.result.status,"RE_ADOPTION_HISTORY_UNVERIFIED");
 assert.equal(invalid.store.writes.length,0);
});
test("one committed warehouse receipt blocks an entire mixed fresh and second-restart batch",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const store=fakeStore([
  orphan({cargoID:7002,entityID:900000000112}),
  secondCrashCargo({cargoID:7001})
 ]);
 let flushes=0;
 const target=fleet(),ship={...hauler,nativeCargoItems:undefined};
 const result=adopt(sceneWith([ship,miner]),target,{
  store,clock:()=>NOW,probe:{},...clearCustody({
   custodyIo:{readdirSync:()=>["7001.json"]}
  }),database:{flushTableSync:()=>{flushes++;return {success:true}}}
 });
 assert.equal(result.status,"RE_ADOPTION_WAREHOUSE_RECEIPT_EXISTS");
 assert.equal(store.writes.length,0);
 assert.equal(flushes,0);
 assert.equal(target.state,"mining");
});
test("a third restart can only recover once with a new warehouse/depot check and preserves the cargoID",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const first=secondCrashAttempt();
 assert.equal(first.result.status,"ADOPTED");
 resetForTests(); // Simulated fresh process; same original durable record.
 const rows=first.store.listNativeCargo();
 const nextShip={...hauler,itemID:hauler.itemID+100,nativeCargoItems:undefined};
 const store=fakeStore(rows);
 const target=fleet({haulerEntityIDs:[nextShip.itemID]});
 let checks=0;
 const opts=clearCustody({
  custodyIo:{readdirSync:()=>{checks++;return []}}
 });
 const result=adopt(sceneWith([nextShip,miner]),target,{
  ...opts,store,clock:()=>NOW+10_000,probe:{},
  database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"ADOPTED");
 assert.equal(checks,1);
 assert.equal(store.listNativeCargo().length,1);
 assert.equal(store.listNativeCargo()[0].cargoID,7001);
 assert.equal(store.listNativeCargo()[0].entityID,nextShip.itemID);
 assert.equal(store.listNativeCargo()[0].coopHaulAdoptedFrom,hauler.itemID);
 assert.equal(target.state,"loaded");
});

test("second restart requires explicitly configured authoritative warehouse root",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const previous=process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ROOT;
 delete process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ROOT;
 try{
  const f=secondCrashAttempt(secondCrashCargo(),{warehouseRoot:undefined});
  assert.equal(f.result.status,"RE_ADOPTION_SETTLEMENT_UNVERIFIED");
  assert.equal(f.store.writes.length,0);
  assert.equal(f.flushes,0);
  assert.equal(f.target.state,"mining");
 }finally{
  if(previous===undefined)delete process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ROOT;
  else process.env.EVEJS_COOP_NATIVE_WAREHOUSE_ROOT=previous;
 }
});

test("damaged persisted adoption history never falls back to first-time custody",()=>{
 for(const enabled of [false,true]){
  for(const [label,changes] of [
   ["zero timestamp",{coopHaulAdoptedAt:0}],
   ["negative timestamp",{coopHaulAdoptedAt:-100}],
   ["invalid timestamp",{coopHaulAdoptedAt:"not-a-date"}],
   ["null timestamp",{coopHaulAdoptedAt:null}],
   ["missing timestamp",{coopHaulAdoptedAt:undefined}],
   ["future timestamp",{coopHaulAdoptedAt:NOW+10_000}],
   ["no source",{coopHaulAdoptedFrom:0}],
   ["bad source",{coopHaulAdoptedFrom:"unknown"}],
   ["same ship as predecessor",{coopHaulAdoptedFrom:900000000111}],
   ["no predecessor",{coopHaulAdoptedFrom:undefined}],
  ]){
   resetForTests();
   if(enabled)process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
   else delete process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION;
   const row=secondCrashCargo(changes),store=fakeStore([row]);
   const original=structuredClone(store.listNativeCargo());
   let reads=0,flushes=0;
   const target=fleet();
   const result=adopt(sceneWith([hauler,miner]),target,{
    store,clock:()=>NOW,
    database:{flushTableSync:()=>{flushes++;return {success:true}}},
    ...clearCustody({custodyIo:{readdirSync:()=>{reads++;return []}}})
   });
   assert.equal(result.status,"RE_ADOPTION_HISTORY_UNVERIFIED",label+" enabled="+enabled);
   assert.equal(store.writes.length,0,label);
   assert.equal(reads,0,"corrupt source must be refused before receipt lookup");
   assert.equal(flushes,0,label);
   assert.equal(target.state,"mining");
   assert.deepEqual(store.listNativeCargo(),original);
  }
 }
});

test("malformed history in one row blocks adoption of an entire fresh/old batch",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const store=fakeStore([
  orphan({cargoID:7002,entityID:900000000112}),
  secondCrashCargo({cargoID:7001,coopHaulAdoptedAt:"invalid"})
 ]);
 const original=structuredClone(store.listNativeCargo()),target=fleet();
 const result=adopt(sceneWith([hauler,miner]),target,{
  store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})},
  ...clearCustody()
 });
 assert.equal(result.status,"RE_ADOPTION_HISTORY_UNVERIFIED");
 assert.equal(store.writes.length,0);
 assert.deepEqual(store.listNativeCargo(),original);
 assert.equal(target.state,"mining");
});

test("missing or non-finite clock cannot certify physical cargo custody",()=>{
 for(const currentTime of [NaN,Infinity,-Infinity,0,-100,"invalid"]){
  resetForTests();
  const store=fakeStore([orphan()]);
  const target=fleet();
  const result=adopt(sceneWith([hauler]),target,{
   store,clock:()=>currentTime,database:{flushTableSync:()=>({success:true})}
  });
  assert.equal(result.status,"INVALID_CLOCK",String(currentTime));
  assert.equal(store.writes.length,0);
  assert.equal(target.state,"mining");
 }
 const store=fakeStore([orphan()]);
 assert.equal(plan({store,scene:sceneWith([hauler]),systemID:30000145,
  fleetID:1,now:NaN}).status,"INVALID_AUTHORITIES");
});

test("fresh orphan cargo with NO historical markers is still adoptable",()=>{
 process.env.EVEJS_COOP_HAUL_CARGO_RE_ADOPTION="1";
 const store=fakeStore([orphan()]),target=fleet();
 const result=adopt(sceneWith([hauler,miner]),target,{
  store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
 });
 assert.equal(result.status,"ADOPTED");
 assert.equal(store.listNativeCargo()[0].cargoID,7001);
 assert.equal(target.state,"loaded");
});

test("post-commit global duplicate original cargoID must never start a loaded NPC trip",()=>{
 for(const mode of ["old-and-new","stale-original","missing","throw","null"]){
  resetForTests();
  const store=fakeStore([orphan()]);
  const listing=store.listNativeCargo;
  let listingCount=0,flushes=0;
  store.listNativeCargo=()=>{
   listingCount++;
   if(listingCount===1)return listing();
   if(mode==="throw")throw Error("GLOBAL_INVENTORY_UNAVAILABLE");
   if(mode==="null")return null;
   if(mode==="missing")return [];
   if(mode==="stale-original")return [orphan()];
   return [orphan(),...listing()];
  };
  const target=fleet(),ship={...hauler,nativeCargoItems:undefined};
  const result=adopt(sceneWith([ship,miner]),target,{
   store,clock:()=>NOW,
   database:{flushTableSync:()=>{flushes++;return {success:true}}}
  });
  assert.equal(result.status,"ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED",mode);
  assert.equal(result.adopted,0);
  assert.equal(flushes,1,"the original transfer happened once");
  assert.equal(store.writes.length,1);
  assert.equal(target.state,"mining");
  assert.equal(ship.nativeCargoItems,undefined);
  assert.equal(target.coopHaulNeedsOperatorRepair,
   "ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED");
  assert.equal(ship.coopHaulNeedsOperatorRepair,
   "ADOPTION_POST_COMMIT_CUSTODY_UNVERIFIED");
 }
});
test("globally unique original cargoID post-commit permits one physical NPC haul",()=>{
 const store=fakeStore([orphan()]);
 const target=fleet(),ship={...hauler,nativeCargoItems:undefined};
 let flushes=0,globalReads=0;
 const listing=store.listNativeCargo;
 store.listNativeCargo=()=>{globalReads++;return listing()};
 const result=adopt(sceneWith([ship]),target,{
  store,clock:()=>NOW,
  database:{flushTableSync:()=>{flushes++;return {success:true}}}
 });
 assert.equal(result.status,"ADOPTED");
 assert.equal(globalReads,2,"preflight and post-commit both verify all native cargoIDs");
 assert.equal(flushes,1);
 assert.equal(store.listNativeCargo().length,1);
 assert.equal(target.state,"loaded");
 assert.equal(ship.nativeCargoItems[0].itemID,7001);
});

test("silent native compensation ACK cannot hide cargo stranded on replacement hauler",()=>{
 for(const mode of ["silent-ack","wrong-owner","wrong-quantity","stale-adoption-marker"]){
  resetForTests();
  const source=[orphan({cargoID:7001}),orphan({cargoID:7002,entityID:900000000112})];
  const store=fakeStore(source);
  const upsert=store.upsertNativeCargo;
  let writes=0,flushes=0;
  store.upsertNativeCargo=row=>{
   writes++;
   // First source upsert succeeds; second is written but rejected.
   if(writes===2){upsert(row);return {success:false,errorMsg:"ADOPTION_SECOND_ROW_REJECTED"}}
   // Compensation of the second row acknowledges but leaves wrong state.
   if(writes===3){
    if(mode==="silent-ack")return {success:true};
    const corrupt={...row};
    if(mode==="wrong-owner")corrupt.ownerID=9999;
    if(mode==="wrong-quantity")corrupt.quantity+=1;
    if(mode==="stale-adoption-marker")corrupt.coopHaulAdoptedAt=NOW;
    upsert(corrupt);
    return {success:true};
   }
   return upsert(row);
  };
  const target=fleet(),ship={...hauler,nativeCargoItems:undefined};
  const out=adopt(sceneWith([ship,miner]),target,{
   store,clock:()=>NOW,database:{flushTableSync:()=>{flushes++;return {success:true}}}
  });
  assert.equal(out.status,"ADOPTION_RECOVERY_UNVERIFIED",mode);
  assert.equal(flushes,1,mode);
  assert.equal(out.adopted,0);
  assert.equal(target.state,"mining");
  assert.equal(target.coopHaulNeedsOperatorRepair,true);
  assert.equal(ship.coopHaulNeedsOperatorRepair,"ADOPTION_RECOVERY_UNVERIFIED");
  assert.equal(ship.nativeCargoItems,undefined);
  assert.equal(adopt(sceneWith([ship]),fleet(),{store,clock:()=>NOW+1}).status,
   "ALREADY_ATTEMPTED");
 }
});

test("rollback must fail closed if global original readback is missing or throws",()=>{
 for(const mode of ["null","throw","target-read-error"]){
  resetForTests();
  const store=fakeStore([orphan()]);
  const upsert=store.upsertNativeCargo;
  let writes=0,reads=0;
  store.upsertNativeCargo=row=>{
   if(++writes===1)return {success:false};
   return upsert(row);
  };
  const list=store.listNativeCargo;
  store.listNativeCargo=()=>{
   if(++reads>=2){
    if(mode==="null")return null;
    if(mode==="throw")throw Error("READBACK_UNAVAILABLE");
   }
   return list();
  };
  if(mode==="target-read-error"){
   const perEntity=store.listNativeCargoForEntity;
   let targetReads=0;
   store.listNativeCargoForEntity=id=>{
    if(id===hauler.itemID&&++targetReads>1)throw Error("READBACK_UNAVAILABLE");
    return perEntity(id);
   };
  }
  const ship={...hauler},target=fleet();
  const result=adopt(sceneWith([ship]),target,{
   store,clock:()=>NOW,database:{flushTableSync:()=>({success:true})}
  });
  assert.equal(result.status,"ADOPTION_RECOVERY_UNVERIFIED",mode);
  assert.equal(store.writes.length,1,"only original compensation was written");
  assert.equal(target.coopHaulNeedsOperatorRepair,true);
  assert.equal(ship.coopHaulNeedsOperatorRepair,"ADOPTION_RECOVERY_UNVERIFIED");
 }
});
