import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createJournal}=require("../integration/coopNativeStationTripJournal.cjs");
const {createManifest}=require("../integration/coopNativeHaulManifest.cjs");
const SYSTEM=30000142,FLEET=SYSTEM*32+1,STATION=60010001,CORP=1000035,SHIP=980000000002;
const CARGO=980200000111,CARGO2=980200000112,MINER=980000000001,START=100000;
function fixture(t,{two=false,now=101000}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-alife12-trip-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,"trip-manifests"),{recursive:true});
 fs.mkdirSync(path.join(root,"receipts"),{recursive:true});
 const cargo=new Map([
  [CARGO,{cargoID:CARGO,entityID:SHIP,coopHaulFleetID:FLEET,
   coopHaulFromMinerID:MINER,typeID:34,quantity:13,moduleID:0,transient:false}]
 ]);
 if(two)cargo.set(CARGO2,{cargoID:CARGO2,entityID:SHIP,
  coopHaulFleetID:FLEET,coopHaulFromMinerID:MINER,typeID:35,
  quantity:19,moduleID:0,transient:false});
 const stock=new Map();
 const ship={entityID:SHIP,ownerID:CORP,systemID:SYSTEM,transient:false};
 const store={listNativeCargoForEntity:id=>id===SHIP?[...cargo.values()]:[]};
 const items={findWarehouseItem:({cargoID})=>stock.get(cargoID)||null};
 const getNativeEntity=id=>id===SHIP?ship:null;
 const manifest=createManifest({root,store,items,getNativeEntity,clock:()=>START});
 const m={v:1,key:SYSTEM+"-"+FLEET+"-"+START,systemID:SYSTEM,fleetID:FLEET,
  startedAt:START,stationID:STATION,corporationID:CORP,
  haulerIDs:[SHIP],cargo:[...cargo.values()].map(row=>({
   cargoID:row.cargoID,haulerID:SHIP,typeID:row.typeID,
   quantity:row.quantity,fromMinerID:MINER}))};
 fs.writeFileSync(path.join(root,"trip-manifests",m.key+".json"),JSON.stringify(m));
 let clockNow=now;
 const journal=()=>createJournal({root,manifest,store,items,getNativeEntity,clock:()=>clockNow});
 const args={manifestKey:m.key,systemID:SYSTEM,fleetID:FLEET,stationID:STATION,
  corporationID:CORP,startedAt:START,haulerIDs:[SHIP],
  cargoIDs:m.cargo.map(x=>x.cargoID)};
 const recover=()=>journal().recover({systemID:SYSTEM,fleetID:FLEET,haulerIDs:[SHIP]});
 const confirm=()=>journal().confirm(args);
 function deliver(id){
  const row=cargo.get(id);assert.ok(row);
  cargo.delete(id);
  const itemID=700000+id;
  stock.set(id,{itemID,typeID:row.typeID,quantity:row.quantity,
   ownerID:CORP,locationID:STATION,customInfo:"coop-warehouse:v1:cargo:"+id});
  fs.writeFileSync(path.join(root,"receipts",id+".json"),JSON.stringify({
   version:1,phase:"COMMITTED",cargoID:id,itemID,haulerID:SHIP,
   fleetID:FLEET,systemID:SYSTEM,stationID:STATION,corporationID:CORP,
   typeID:row.typeID,quantity:row.quantity}));
 }
 function sell(id,{quantity=null,marketQuantity=null}={}){
  const row=cargo.get(id);assert.ok(row);
  cargo.delete(id);
  fs.writeFileSync(path.join(root,"receipts",id+".json"),JSON.stringify({
   version:1,phase:"COMMITTED",source:"NPC_MARKET_FILL",cargoID:id,haulerID:SHIP,
   typeID:row.typeID,quantity:quantity===null?row.quantity:quantity,
   systemID:SYSTEM,fleetID:FLEET,stationID:STATION,corporationID:CORP,
   marketQuantity:marketQuantity===null?row.quantity:marketQuantity,
   isk:100,at:123}));
 }
 function sellPart(id,units){
  const row=cargo.get(id);assert.ok(row);assert.ok(units>0&&units<row.quantity);
  row.quantity=row.quantity-units;
  fs.writeFileSync(path.join(root,"receipts",id+".json"),JSON.stringify({
   version:1,phase:"COMMITTED",source:"NPC_MARKET_FILL",sequence:1,cargoID:id,
   haulerID:SHIP,typeID:row.typeID,quantity:units,systemID:SYSTEM,fleetID:FLEET,
   stationID:STATION,corporationID:CORP,marketQuantity:units,isk:100,at:123}));
 }
 return {root,cargo,stock,ship,m,args,journal,recover,confirm,deliver,sell,sellPart,
  setClock:value=>clockNow=value,store,getNativeEntity};
}
test("unacknowledged original manifest blocks any unattended rewarp",t=>{
 const f=fixture(t);
 assert.deepEqual(f.recover().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.recover().reason,"ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED");
 assert.equal(f.cargo.get(CARGO).entityID,SHIP);
});
test("confirmed native warp ACK fsyncs a durable departure witness",t=>{
 const f=fixture(t);
 assert.equal(f.confirm().status,"DURABLE_DEPARTURE_CONFIRMED");
 const raw=JSON.parse(fs.readFileSync(path.join(f.root,"trip-departure-acks",f.m.key+".json"),"utf8"));
 assert.equal(raw.manifestKey,f.m.key);
 assert.equal(raw.fleetID,FLEET);
 assert.equal(raw.cargoIDs[0],CARGO);
 assert.equal(raw.status,"WARP_ACK_CONFIRMED");
});
test("cold restart recovers same cargoID, fleetID and station, and NEVER changes cargo",t=>{
 const f=fixture(t);assert.equal(f.confirm().status,"DURABLE_DEPARTURE_CONFIRMED");
 const before=[...f.cargo.values()].map(x=>structuredClone(x));
 const recovered=f.recover();
 assert.equal(recovered.status,"RECOVERED_NATIVE_TRIP");
 assert.equal(recovered.trip.manifestID,f.m.key);
 assert.equal(recovered.trip.fleetID,FLEET);
 assert.deepEqual(recovered.trip.expectedCargoIDs,[CARGO]);
 assert.deepEqual([...f.cargo.values()],before);
 assert.equal(recovered.trip.haulers[SHIP].arrivedAt,0);
});
test("once warehouse completed original cargo, old manifest is never replayed",t=>{
 const f=fixture(t);f.confirm();f.deliver(CARGO);
 assert.equal(f.recover().status,"NO_PENDING_TRIP");
 assert.equal(f.cargo.size,0);
 assert.equal(f.stock.size,1);
});
test("a partially delivered two-stack manifest resumes the exact remaining original stack",t=>{
 const f=fixture(t,{two:true});f.confirm();f.deliver(CARGO);
 const recovered=f.recover();assert.equal(recovered.status,"RECOVERED_NATIVE_TRIP");
 assert.deepEqual(recovered.trip.expectedCargoIDs,[CARGO,CARGO2]);
 assert.equal(recovered.activeCargo,1);
 assert.equal(f.cargo.get(CARGO2).quantity,19);
});
test("cargo lost without committed warehouse proof is quarantined",t=>{
 const f=fixture(t);f.confirm();f.cargo.delete(CARGO);
 assert.equal(f.recover().reason,"ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF");
});
test("wrong immutable cargo quantity never becomes accepted after restart",t=>{
 const f=fixture(t);f.confirm();f.cargo.get(CARGO).quantity++;
 assert.equal(f.recover().reason,"ALIFE12_SOURCE_CARGO_CHANGED");
});
test("wrong receipt quantity does not become warehouse completion proof",t=>{
 const f=fixture(t,{two:true});f.confirm();f.deliver(CARGO);
 const p=path.join(f.root,"receipts",CARGO+".json");
 const receipt=JSON.parse(fs.readFileSync(p));receipt.quantity++;
 fs.writeFileSync(p,JSON.stringify(receipt));
 assert.equal(f.recover().reason,"ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF");
});
test("tampered fsynced departure ACK refuses to relink an original NPC",t=>{
 const f=fixture(t);f.confirm();
 const p=path.join(f.root,"trip-departure-acks",f.m.key+".json");
 const ack=JSON.parse(fs.readFileSync(p));ack.stationID++;
 fs.writeFileSync(p,JSON.stringify(ack));
 assert.equal(f.recover().reason,"ALIFE12_WARP_ACK_PROVENANCE_INVALID");
});
test("original hauler disappears from native entity store: no recovery",t=>{
 const f=fixture(t);f.confirm();f.ship.transient=true;
 assert.equal(f.recover().reason,"ALIFE12_HAULER_NATIVE_NOT_DURABLE");
});
test("unrecognized native cargo on the same original fleet blocks recovery",t=>{
 const f=fixture(t);f.confirm();
 f.cargo.set(980200000777,{cargoID:980200000777,entityID:SHIP,
  coopHaulFleetID:FLEET,coopHaulFromMinerID:MINER,
  typeID:34,quantity:99,moduleID:0,transient:false});
 assert.equal(f.recover().reason,"ALIFE12_UNDECLARED_HAUL_CARGO");
});
test("source manifest mutation invalidates fsynced ACK, never silently reparents ore",t=>{
 const f=fixture(t);f.confirm();
 const p=path.join(f.root,"trip-manifests",f.m.key+".json");
 const row=JSON.parse(fs.readFileSync(p));row.cargo[0].quantity+=1;
 fs.writeFileSync(p,JSON.stringify(row));
 const got=f.recover();assert.ok(["ALIFE12_SOURCE_CARGO_CHANGED","ALIFE12_WARP_ACK_PROVENANCE_INVALID"].includes(got.reason),JSON.stringify(got).slice(0,160));
});
test("wrong station/corporation cannot be falsely confirmed",t=>{
 const f=fixture(t);f.args.stationID++;
 assert.equal(f.confirm().reason,"ALIFE12_DEPARTURE_MANIFEST_IDENTITY_CONFLICT");
 assert.equal(fs.existsSync(path.join(f.root,"trip-departure-acks",f.m.key+".json")),false);
});
test("second ACK with another timestamp cannot replace immutable warp witness",t=>{
 const f=fixture(t);assert.equal(f.confirm().status,"DURABLE_DEPARTURE_CONFIRMED");
 f.setClock(102000);
 assert.equal(f.confirm().reason,"ALIFE12_ACK_ALREADY_EXISTS_OR_CHANGED");
});
test("two active manifest keys for one fleet are ambiguous, not silently merged",t=>{
 const f=fixture(t);f.confirm();
 const newer=structuredClone(f.m);newer.startedAt=START+1;
 newer.key=SYSTEM+"-"+FLEET+"-"+(START+1);
 fs.writeFileSync(path.join(f.root,"trip-manifests",newer.key+".json"),JSON.stringify(newer));
 const ack=JSON.parse(fs.readFileSync(path.join(f.root,"trip-departure-acks",f.m.key+".json")));
 const {createHash}=require("node:crypto");
 ack.manifestKey=newer.key;ack.startedAt=newer.startedAt;
 ack.manifestHash=createHash("sha256").update(JSON.stringify(newer)).digest("hex");
 fs.writeFileSync(path.join(f.root,"trip-departure-acks",newer.key+".json"),JSON.stringify(ack));
 assert.equal(f.recover().reason,"ALIFE12_TWO_ACTIVE_DURABLE_TRIPS");
});
test("absent original manifest yields no pending route and no new warp",t=>{
 const f=fixture(t);
 fs.unlinkSync(path.join(f.root,"trip-manifests",f.m.key+".json"));
 assert.equal(f.recover().status,"NO_PENDING_TRIP");
});
test("invalid ACK record JSON is fail-closed and cargo remains intact",t=>{
 const f=fixture(t);f.confirm();
 fs.writeFileSync(path.join(f.root,"trip-departure-acks",f.m.key+".json"),"NOT JSON");
 assert.equal(f.recover().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.cargo.get(CARGO).quantity,13);
});

// A trip that outlived its deadline used to strand the fleet in "loaded" forever:
// recovery paused on every tick and nothing could move. The expiry is now a durable
// fact of its own, so a closed route stops being offered and the ore can be re-planned.
test("an acked trip can be expired durably and is then no longer pending",t=>{
 const f=fixture(t);
 assert.equal(f.confirm().status,"DURABLE_DEPARTURE_CONFIRMED");
 assert.equal(f.recover().status,"RECOVERED_NATIVE_TRIP");
 const expired=f.journal().expire({manifestKey:f.m.key,systemID:SYSTEM,fleetID:FLEET,now:500000});
 assert.equal(expired.status,"ROUTE_EXPIRED");
 assert.equal(f.recover().status,"NO_PENDING_TRIP","the closed route is never offered again");
 const again=f.journal().expire({manifestKey:f.m.key,systemID:SYSTEM,fleetID:FLEET,now:500000});
 assert.equal(again.status,"ALREADY_EXPIRED","expiry is idempotent");
 // Nothing was delivered or credited by closing a route.
 assert.equal(f.cargo.has(CARGO),true);
 assert.equal(f.stock.size,0);
});

test("a trip with no departure acknowledgement cannot be expired",t=>{
 const f=fixture(t);
 const refused=f.journal().expire({manifestKey:f.m.key,systemID:SYSTEM,fleetID:FLEET,now:500000});
 assert.equal(refused.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(refused.reason,"ALIFE12_EXPIRY_WITHOUT_DEPARTURE");
});

test("the expiry record keeps the original trip identity and cannot be rewritten",t=>{
 const f=fixture(t);
 f.confirm();
 assert.equal(f.journal().expire({manifestKey:f.m.key,systemID:SYSTEM,fleetID:FLEET,now:500000}).status,"ROUTE_EXPIRED");
 const file=path.join(f.root,"trip-departure-acks",f.m.key+".expired.json");
 const record=JSON.parse(fs.readFileSync(file,"utf8"));
 assert.equal(record.status,"ROUTE_EXPIRED");
 assert.equal(record.systemID,SYSTEM);
 assert.equal(record.fleetID,FLEET);
 assert.equal(record.stationID,STATION);
 assert.equal(record.corporationID,CORP);
 assert.equal(record.startedAt,START);
 assert.equal(record.expiredAt,500000);
 const changed=f.journal().expire({manifestKey:f.m.key,systemID:SYSTEM,fleetID:FLEET,now:600000});
 assert.equal(changed.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(changed.reason,"ALIFE12_EXPIRY_ALREADY_RECORDED_DIFFERENTLY");
});

// A real market fill removes the hull row but never creates a station item, so the
// warehouse proof cannot see it. The sale receipt is the proof, and it must agree
// with the manifest row exactly: no partial inference.
test("a sold row is proven by its own market fill receipt",t=>{
 const f=fixture(t);
 assert.equal(f.confirm().status,"DURABLE_DEPARTURE_CONFIRMED");
 f.sell(CARGO);
 assert.equal(f.recover().status,"NO_PENDING_TRIP","the whole trip is accounted");
});
test("a sale receipt whose quantity disagrees with the manifest never proves it",t=>{
 const f=fixture(t);
 f.confirm();
 f.sell(CARGO,{quantity:12,marketQuantity:12});
 const r=f.recover();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(r.reason,"ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF");
});
test("a warehouse receipt and a sale receipt cannot both claim the same row",t=>{
 const f=fixture(t);
 f.confirm();
 f.sell(CARGO);
 // A second, warehouse-style receipt for the same cargoID must not change the
 // verdict: the recover still sees exactly one accounted row and no active cargo.
 assert.equal(f.recover().status,"NO_PENDING_TRIP");
});

// The market fills what its order supports, so a hull row is usually PARTLY sold. The
// receipt then proves exactly which units left, and the remainder stays declared aboard.
test("a partly sold row keeps the trip alive with its remainder",t=>{
 const f=fixture(t);
 f.confirm();
 f.sellPart(CARGO,5);
 const r=f.recover();
 assert.equal(r.status,"RECOVERED_NATIVE_TRIP");
 assert.equal(f.cargo.get(CARGO).quantity,8,"the remainder never leaves the hull");
});
test("a partial receipt that does not match the missing units proves nothing",t=>{
 const f=fixture(t);
 f.confirm();
 f.sellPart(CARGO,5);
 // Rewrite the receipt so it claims a different amount than the hull actually lost.
 const file=path.join(f.root,"receipts",CARGO+".json");
 const r=JSON.parse(fs.readFileSync(file,"utf8"));
 r.quantity=3;r.marketQuantity=3;
 fs.writeFileSync(file,JSON.stringify(r));
 const got=f.recover();
 assert.equal(got.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(got.reason,"ALIFE12_SOURCE_CARGO_CHANGED");
});
