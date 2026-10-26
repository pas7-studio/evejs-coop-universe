import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createWarehouse,marker}=require('../integration/coopNativeWarehouse.cjs');
function fixture(options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-warehouse-'));
 const cargo=new Map([[8001,{cargoID:8001,entityID:9001,typeID:1230,quantity:250,moduleID:0,coopHaulFleetID:77,coopHaulFromMinerID:800}]]);
 const owned=new Map();let issued=0,failRemove=false,failCargoFlush=false,failItemsFlush=false,failGrant=false,acceptArrival=true,durableCargo=true;
 const store={listNativeCargoForEntity:id=>[...cargo.values()].filter(c=>c.entityID===id),
  removeNativeCargo(id){if(failRemove)return {success:false};return {success:cargo.delete(id)};}};
 const items={findWarehouseItem({ownerID,stationID,cargoID}){const item=owned.get(cargoID);return item&&item.ownerID===ownerID&&item.locationID===stationID?item:null;},
  grantUniqueNpcDepotItem({ownerID,stationID,typeID,quantity,cargoID}){
   if(failGrant)return {success:false};
   const existing=owned.get(cargoID);
   if(existing)return {success:existing.ownerID===ownerID&&existing.locationID===stationID};
   owned.set(cargoID,{itemID:++issued,ownerID,locationID:stationID,typeID,quantity,customInfo:marker(cargoID)});
   return {success:true,data:{itemID:issued}};
  }};
 const config={root,store,items,flush:table=>({success:table==='npcCargo'?!failCargoFlush:!failItemsFlush}),
 getStation:id=>id===6001?{stationID:6001,solarSystemID:30000144}:null,
 getCorporation:id=>id===1000035?{corporationID:id,isNPC:true}:null,
 isNpcCorporation:id=>id===1000035,verifyArrival:()=>acceptArrival,verifyDurableCargo:()=>durableCargo,clock:()=>1234};
 const make=()=>createWarehouse(config);
 const arg={cargoID:8001,haulerID:9001,fleetID:77,systemID:30000144,stationID:6001,corporationID:1000035};
 const cleanup=()=>fs.rmSync(root,{recursive:true,force:true});
 return {root,cargo,owned,config,make,arg,cleanup,set:opts=>{if('failRemove'in opts)failRemove=opts.failRemove;if('failCargoFlush'in opts)failCargoFlush=opts.failCargoFlush;if('failItemsFlush'in opts)failItemsFlush=opts.failItemsFlush;if('failGrant'in opts)failGrant=opts.failGrant;if('acceptArrival'in opts)acceptArrival=opts.acceptArrival;if('durableCargo'in opts)durableCargo=opts.durableCargo;},get issued(){return issued}};
}
function withF(fn){const f=fixture();try{fn(f);}finally{f.cleanup();}}
test('real cargo -> exactly one native tagged stack and receipt after flush',()=>withF(f=>{
 const w=f.make(),r=w.deposit(f.arg);
 assert.equal(r.status,'COMMITTED');assert.equal(f.cargo.size,0);assert.equal(f.owned.size,1);
 assert.equal(f.owned.get(8001).customInfo,marker(8001));
 assert.equal(w.audit().status,'OK');assert.equal(w.audit().committed,1);
 assert.equal(w.deposit(f.arg).status,'ALREADY_COMMITTED');assert.equal(f.issued,1);
}));
test('no station arrival -> do not even create receipt',()=>withF(f=>{
 f.set({acceptArrival:false});assert.equal(f.make().deposit(f.arg).status,'ARRIVAL_NOT_VERIFIED');
 assert.equal(f.cargo.size,1);assert.equal(f.owned.size,0);
 assert.equal(f.make().audit().status,'EMPTY');
}));
test('station or corporation not real -> no cargo debit',()=>withF(f=>{
 assert.equal(f.make().deposit({...f.arg,stationID:6199}).status,'OWNER_OR_STATION_MISSING');
 assert.equal(f.make().deposit({...f.arg,corporationID:1000999}).status,'OWNER_OR_STATION_MISSING');assert.equal(f.cargo.size,1);
}));
test('cannot deposit foreign fleet, reused cargo ID or module',()=>withF(f=>{
 assert.equal(f.make().deposit({...f.arg,fleetID:78}).status,'CARGO_NOT_PROVEN');
 assert.equal(f.cargo.size,1);
}));
test('failed debit never credits cargo',()=>withF(f=>{
 f.set({failRemove:true});const w=f.make();assert.equal(w.deposit(f.arg).status,'SOURCE_DEBIT_UNCERTAIN');
 assert.equal(f.owned.size,0);assert.equal(f.cargo.size,1);
 assert.equal(w.resume(8001,{authorize:true}).status,'PREPARED_SOURCE_PRESENT');
}));
test('failed npcCargo flush never credits cargo, blocks blind retry',()=>withF(f=>{
 f.set({failCargoFlush:true});const w=f.make();assert.equal(w.deposit(f.arg).status,'SOURCE_FLUSH_UNCERTAIN');
 assert.equal(f.owned.size,0);assert.equal(w.deposit(f.arg).status,'PENDING_RECONCILIATION');
 assert.equal(f.make().resume(8001,{authorize:true}).status,'PREPARED_SOURCE_UNKNOWN');
}));
test('failed native item creation allows authorized recovery after durable source debit',()=>withF(f=>{
 f.set({failGrant:true});const w=f.make();assert.equal(w.deposit(f.arg).status,'TARGET_WRITE_UNCERTAIN');
 assert.equal(f.cargo.size,0);assert.equal(f.owned.size,0);
 assert.equal(w.resume(8001).status,'REPAIR_AUTHORIZATION_REQUIRED');
 f.set({failGrant:false});assert.equal(f.make().resume(8001,{authorize:true}).status,'COMMITTED');
 assert.equal(f.owned.size,1);assert.equal(f.issued,1);
}));
test('unknown item SQLite flush reuses same tagged output; never creates second item',()=>withF(f=>{
 f.set({failItemsFlush:true});const w=f.make();assert.equal(w.deposit(f.arg).status,'TARGET_FLUSH_UNCERTAIN');
 assert.equal(f.issued,1);assert.equal(f.owned.size,1);
 f.set({failItemsFlush:false});assert.equal(f.make().resume(8001,{authorize:true}).status,'COMMITTED');
 assert.equal(f.issued,1);assert.equal(f.owned.size,1);
}));
test('duplicate cargoID with altered owner blocked by journal',()=>withF(f=>{
 const w=f.make();assert.equal(w.deposit(f.arg).status,'COMMITTED');
 assert.equal(w.deposit({...f.arg,haulerID:9999}).status,'RECEIPT_IDENTITY_CONFLICT');
 assert.equal(f.issued,1);
}));
test('tampered target prevents already committed and audit reports discrepancy',()=>withF(f=>{
 const w=f.make();assert.equal(w.deposit(f.arg).status,'COMMITTED');
 f.owned.get(8001).quantity+=100;
 assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(w.audit().status,'NEEDS_RECONCILIATION');
}));
test('read-only audit does not heal uncertain source debit',()=>withF(f=>{
 f.set({failCargoFlush:true});const w=f.make();w.deposit(f.arg);
 const before=fs.readFileSync(path.join(f.root,'receipts','8001.json'),'utf8');
 assert.equal(w.audit().status,'NEEDS_RECONCILIATION');
 assert.equal(fs.readFileSync(path.join(f.root,'receipts','8001.json'),'utf8'),before);
 assert.equal(f.owned.size,0);
}));
test('corrupted journal never silently resets warehouse',()=>withF(f=>{
 const w=f.make();w.deposit(f.arg);
 fs.writeFileSync(path.join(f.root,'receipts','8001.json'),'{malformed');
 assert.equal(f.make().deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');assert.equal(f.owned.size,1);
}));
test('source changes quantity after PREPARED is never an available second deposit',()=>withF(f=>{
 const w=f.make();f.set({failRemove:true});w.deposit(f.arg);f.cargo.get(8001).quantity=1000;
 f.set({failRemove:false});assert.equal(w.deposit(f.arg).status,'PENDING_RECONCILIATION');
 assert.equal(f.owned.size,0);
}));

test('transient hauler cargo cannot turn into a durable native inventory item',()=>withF(f=>{
 f.set({durableCargo:false});const w=f.make();
 assert.equal(w.deposit(f.arg).status,'CARGO_NOT_DURABLE');
 assert.equal(w.audit().status,'EMPTY');assert.equal(f.cargo.size,1);assert.equal(f.owned.size,0);
}));

test('P0: authorized DEBIT recovery cannot credit ore if native cargo source read is missing',()=>withF(f=>{
 f.set({failGrant:true});
 const warehouse=f.make();
 assert.equal(warehouse.deposit(f.arg).status,'TARGET_WRITE_UNCERTAIN');
 assert.equal(f.issued,0);
 f.set({failGrant:false});
 const original=f.config.store.listNativeCargoForEntity;
 const file=path.join(f.root,'receipts','8001.json');
 for(const unreadable of [null,undefined,false,{},'not-an-array']){
  f.config.store.listNativeCargoForEntity=()=>unreadable;
  assert.equal(f.make().resume(8001,{authorize:true}).status,'NEEDS_OPERATOR_REPAIR');
  assert.equal(f.issued,0,'unknown source cannot create real ItemStore ore');
  assert.equal(f.owned.size,0);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).phase,'SOURCE_DEBIT_PROVEN');
 }
 f.config.store.listNativeCargoForEntity=original;
 assert.equal(f.make().resume(8001,{authorize:true}).status,'COMMITTED');
 assert.equal(f.issued,1,'recovered only after authoritative native absence proof');
 assert.equal(f.make().resume(8001,{authorize:true}).status,'ALREADY_COMMITTED');
 assert.equal(f.issued,1);
}));

test('P0: committed warehouse status and audit refuse unavailable native source custody',()=>withF(f=>{
 const warehouse=f.make();
 assert.equal(warehouse.deposit(f.arg).status,'COMMITTED');
 const original=f.config.store.listNativeCargoForEntity;
 f.config.store.listNativeCargoForEntity=()=>null;
 assert.equal(f.make().resume(8001,{authorize:true}).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.make().deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.make().audit().status,'NEEDS_RECONCILIATION');
 assert.equal(f.issued,1,'no duplicate native station stack');
 f.config.store.listNativeCargoForEntity=original;
 assert.equal(f.make().audit().status,'OK');
}));

test('P0: duplicate or wrong-ship original native cargo never receives source debit',()=>withF(f=>{
 const warehouse=f.make();
 const original=f.config.store.listNativeCargoForEntity;
 for(const scenario of ['duplicated','wrong-ship']){
  f.config.store.listNativeCargoForEntity=id=>{
   const rows=original(id);
   return scenario==='duplicated'?[...rows,...rows]:rows.map(row=>({...row,entityID:id+1}));
  };
  const outcome=warehouse.deposit(f.arg);
  assert.equal(outcome.status,'NEEDS_OPERATOR_REPAIR',scenario);
  assert.equal(f.issued,0);
  assert.equal(f.cargo.size,1);
  assert.equal(warehouse.audit().status,'EMPTY');
 }
 f.config.store.listNativeCargoForEntity=original;
 assert.equal(warehouse.deposit(f.arg).status,'COMMITTED');
 assert.equal(f.issued,1);
}));
