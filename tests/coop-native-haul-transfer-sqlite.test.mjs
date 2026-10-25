import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createAtomicHaulMover,receiptKey}=require("../integration/coopNativeHaulTransferAtomic.cjs");
const systemID=30000142,slot=1,fleetID=systemID*32+slot;
const minerID=980000000001,haulerID=980000000002,cargoID=980200000003;
const keys=["EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC","EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE","EVEJS_COOP_NATIVE_HAUL_CARGO",
 "EVEJS_COOP_NPC_STATION_DELIVERY"];
function setup(t){
 const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 keys.forEach(k=>process.env[k]="1");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-alife10-haul-"));
 const filename=path.join(dir,"disposable-gamestore.sqlite");
 let db=new DatabaseSync(filename);
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE "npcCargo" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
 const ore={cargoID,entityID:minerID,ownerID:1000035,typeID:34,quantity:13,
  moduleID:0,transient:false,itemName:"Tritanium"};
 const put=(key,value)=>db.prepare('INSERT INTO "npcCargo" (key,json) VALUES(?,?)').run(key,JSON.stringify(value));
 const get=key=>{const row=db.prepare('SELECT json FROM "npcCargo" WHERE key=?').get(key);
  return row?JSON.parse(row.json):null;};
 put("cargo",{[String(cargoID)]:ore});
 t.after(()=>{if(db)db.close();fs.rmSync(dir,{recursive:true,force:true});
  for(const [k,v] of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const miner={kind:"ship",itemID:minerID,ownerID:1000035,nativeNpc:true,
  transient:false,position:{x:0,y:0,z:0},
  nativeCargoItems:[{itemID:cargoID,typeID:34,volume:0.1,quantity:13}]};
 const hauler={kind:"ship",itemID:haulerID,ownerID:1000035,nativeNpc:true,
  transient:false,position:{x:2000,y:0,z:0},nativeCargoItems:[]};
 const scene={systemID,getEntityByID:id=>id===minerID?miner:id===haulerID?hauler:null};
 const fleet={systemID,fleetID,startupKey:systemID+":"+slot,
  minerEntityIDs:[minerID],haulerEntityIDs:[haulerID]};
 const mk=(id,role)=>({entityID:id,systemID,ownerID:1000035,
  nativeNpc:true,transient:false,operatorKind:"coop-mining-"+systemID+"-"+slot+"-"+role});
 const store={
  getNativeEntity:id=>id===minerID?mk(minerID,"miner"):id===haulerID?mk(haulerID,"hauler"):null,
  getNativeController:id=>id===minerID?mk(minerID,"miner"):id===haulerID?mk(haulerID,"hauler"):null,
  listNativeCargoForEntity:id=>Object.values(get("cargo")||{}).filter(row=>row.entityID===id),
  buildNativeCargoItems:id=>store.listNativeCargoForEntity(id).map(row=>({
   itemID:row.cargoID,typeID:row.typeID,locationID:row.entityID,ownerID:row.ownerID,
   quantity:row.quantity,stacksize:row.quantity}))
 };
 const adapter=createSqliteAdapter(()=>db).claimTransactor();
 const mover=createAtomicHaulMover({gameStore:{coopAtomicNativeRows:adapter},nativeStore:store,
  resolveType:typeID=>({typeID,volume:0.1}),clock:()=>654321});
 const move=()=>mover.transfer({scene,fleet,miner,hauler,cargoID});
 return{db:()=>db,read:get,move,miner,hauler,filename,
  close:()=>{db.close();db=null;},
  reopen:()=>{db=new DatabaseSync(filename);},
 };
}
test("real SQLite FULL WAL transaction persists original cargoID and matching receipt across reopen",t=>{
 const f=setup(t),before=f.read("cargo");
 assert.equal(Object.keys(before).length,1);
 const result=f.move();assert.equal(result.status,"COMMITTED");
 assert.equal(f.db().prepare("PRAGMA synchronous").get().synchronous,2);
 f.close();f.reopen();
 const cargo=f.read("cargo"),receipt=f.read(receiptKey(cargoID));
 assert.equal(Object.keys(cargo).length,1);
 assert.equal(cargo[String(cargoID)].entityID,haulerID);
 assert.equal(cargo[String(cargoID)].coopHaulFleetID,fleetID);
 assert.equal(receipt.cargoID,cargoID);
 assert.equal(receipt.status,"COMMITTED");
 assert.equal(receipt.afterHash,result.receipt.afterHash);
 assert.equal(f.miner.nativeCargoItems.length,0);
 assert.equal(f.hauler.nativeCargoItems[0].itemID,cargoID);
});
test("SQL trigger fault after cargo UPSERT rolls back both the move and receipt",t=>{
 const f=setup(t);
 f.db().exec("CREATE TRIGGER deny_haul BEFORE INSERT ON npcCargo WHEN NEW.key LIKE 'coopNativeHaulTransfer:%' BEGIN SELECT RAISE(ABORT,'simulated ledger rejection'); END");
 const result=f.move();assert.equal(result.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.read("cargo")[String(cargoID)].entityID,minerID);
 assert.equal(f.read(receiptKey(cargoID)),null);
 f.close();f.reopen();
 assert.equal(f.read("cargo")[String(cargoID)].entityID,minerID);
 assert.equal(f.read(receiptKey(cargoID)),null);
});
test("reopened committed transfer cannot debit a missing miner cargo a second time",t=>{
 const f=setup(t);assert.equal(f.move().status,"COMMITTED");
 f.close();f.reopen();
 const result=f.move();
 assert.equal(result.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(f.read("cargo")[String(cargoID)].entityID,haulerID);
 assert.equal(Object.keys(f.read("cargo")).length,1);
 assert.equal(f.read(receiptKey(cargoID)).status,"COMMITTED");
});


test("a distant original miner and hauler cannot teleport the same durable cargoID",t=>{
 const f=setup(t);f.hauler.position.x=10000000;
 const before=f.read("cargo");
 const result=f.move();
 assert.equal(result.status,"BLOCKED_PHYSICAL_RANGE");
 assert.equal(f.read(receiptKey(cargoID)),null);
 assert.deepEqual(f.read("cargo"),before);
 assert.equal(f.miner.coopMiningCargoNeedsOperatorRepair,undefined);
 f.hauler.position.x=2000;
 assert.equal(f.move().status,"COMMITTED");
});
test("native hauler in warp cannot receive an atomic ore transfer",t=>{
 const f=setup(t);f.hauler.pendingWarp=true;
 assert.equal(f.move().status,"BLOCKED_PHYSICAL_RANGE");
 assert.equal(f.read("cargo")[String(cargoID)].entityID,minerID);
 assert.equal(f.read(receiptKey(cargoID)),null);
 delete f.hauler.pendingWarp;
 assert.equal(f.move().status,"COMMITTED");
});
test("invalid native coordinates cannot authorize original cargo custody transfer",t=>{
 const f=setup(t);f.hauler.position.x=Infinity;
 assert.equal(f.move().status,"BLOCKED_PHYSICAL_RANGE");
 assert.equal(f.read("cargo")[String(cargoID)].entityID,minerID);
 assert.equal(f.read(receiptKey(cargoID)),null);
});
test("native hull surface distance is respected without rejecting in-range haulers",t=>{
 const f=setup(t);f.hauler.position.x=2600;
 f.miner.radius=50;f.hauler.radius=100;
 assert.equal(f.move().status,"COMMITTED");
});
