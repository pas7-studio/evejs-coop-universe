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
 const cargo=new Map([[8001,{cargoID:8001,entityID:9001,ownerID:1000035,typeID:1230,quantity:250,moduleID:0,coopHaulFleetID:77,coopHaulFromMinerID:800}]]);
 const owned=new Map();let issued=0,failRemove=false,failCargoFlush=false,failItemsFlush=false,failGrant=false,acceptArrival=true,durableCargo=true;
 const store={listNativeCargoForEntity:id=>[...cargo.values()].filter(c=>c.entityID===id),
  listNativeCargo:()=>[...cargo.values()],
  removeNativeCargo(id){if(failRemove)return {success:false};return {success:cargo.delete(id)};}};
 // The patched native ItemStore exposes global cargo-tag lookup and
 // original physical hangar identity, including stacksize/singleton/flagID.
 const items={ITEM_FLAGS:{HANGAR:4},
  findWarehouseItem({cargoID}){return owned.get(cargoID)||null;},
  grantUniqueNpcDepotItem({ownerID,stationID,typeID,quantity,cargoID}){
   if(failGrant)return {success:false};
   const existing=owned.get(cargoID);
   if(existing)return {success:existing.ownerID===ownerID&&existing.locationID===stationID};
   owned.set(cargoID,{itemID:++issued,ownerID,locationID:stationID,
    flagID:items.ITEM_FLAGS.HANGAR,singleton:0,stacksize:quantity,
    typeID,quantity,customInfo:marker(cargoID)});
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


test('P0: native ore title must equal receiving NPC corporate warehouse owner',()=>withF(f=>{
 const w=f.make(),source=f.cargo.get(8001),originalOwner=source.ownerID;
 const file=path.join(f.root,'receipts','8001.json');
 for(const foreignOwner of [8888,0,null,undefined,'unverified']){
  source.ownerID=foreignOwner;
  assert.equal(w.deposit(f.arg).status,'ORIGINAL_CARGO_OWNER_MISMATCH');
  assert.equal(f.cargo.size,1,'original cargo must not be debited');
  assert.equal(f.owned.size,0,'no physical stock may be minted');
  assert.equal(f.issued,0);
  assert.equal(fs.existsSync(file),false,'no PREPARED receipt for foreign original title');
 }
 source.ownerID=originalOwner;
 assert.equal(w.deposit(f.arg).status,'COMMITTED');
 assert.equal(f.cargo.size,0);
 assert.equal(f.owned.size,1);
 assert.equal(f.issued,1);
}));

test('P0: completed physical ore receipt invalid if tagged item is not in true station hangar',()=>withF(f=>{
 const w=f.make();
 assert.equal(w.deposit(f.arg).status,'COMMITTED');
 const original={...f.owned.get(8001)};
 for(const [name,patch] of [
  ['moved to another inventory slot',{flagID:5}],
  ['singleton turned into a unique item',{singleton:1}],
  ['split stack quantity no longer matches',{stacksize:249}],
  ['stacksize exceeds credited quantity',{stacksize:251}],
  ['missing hangar identity',{flagID:undefined}]
 ]){
  f.owned.set(8001,{...original,...patch});
  assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR',name);
  assert.equal(w.resume(8001,{authorize:true}).status,'NEEDS_OPERATOR_REPAIR',name);
  assert.equal(w.audit().status,'NEEDS_RECONCILIATION',name);
  assert.equal(f.issued,1,'never create another original tagged stack');
 }
 f.owned.set(8001,original);
 assert.equal(w.deposit(f.arg).status,'ALREADY_COMMITTED');
 assert.equal(w.audit().status,'OK');
 assert.equal(f.issued,1);
}));

test('P0: warehouse item with source tag owned by another corporation is a conflict',()=>withF(f=>{
 f.owned.set(8001,{itemID:777,ownerID:7777,locationID:6002,
  flagID:4,singleton:0,stacksize:250,typeID:1230,quantity:250,customInfo:marker(8001)});
 const w=f.make();
 assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.cargo.size,1);
 assert.equal(f.issued,0);
 assert.equal(w.audit().status,'EMPTY');
}));

test('P0: a successful item grant cannot claim completed credit without native hangar metadata',()=>withF(f=>{
 const grant=f.config.items.grantUniqueNpcDepotItem;
 f.config.items.grantUniqueNpcDepotItem=args=>{
  const result=grant(args);
  if(result.success)f.owned.get(8001).flagID=9;
  return result;
 };
 const w=f.make(),result=w.deposit(f.arg);
 assert.equal(result.status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.owned.size,1,'unknown item write must not be retried blindly');
 assert.equal(f.issued,1);
 assert.equal(w.audit().status,'NEEDS_RECONCILIATION');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'receipts','8001.json'),'utf8')).phase,
  'SOURCE_DEBIT_PROVEN');
}));

test('P0: existing genuine cargo-tagged station item blocks source debit before PREPARED',()=>withF(f=>{
 f.owned.set(8001,{itemID:777,ownerID:1000035,locationID:6001,
  flagID:4,singleton:0,stacksize:250,typeID:1230,quantity:250,customInfo:marker(8001)});
 const w=f.make(),receipt=path.join(f.root,'receipts','8001.json');
 assert.equal(w.deposit(f.arg).status,'WAREHOUSE_SOURCE_TARGET_COLLISION');
 assert.equal(f.cargo.size,1,'source ore remains physically on original NPC ship');
 assert.equal(f.owned.size,1,'existing native warehouse item is unchanged');
 assert.equal(f.issued,0,'no new grant');
 assert.equal(fs.existsSync(receipt),false,'do not write PREPARED for colliding cargoID');
 assert.equal(w.audit().status,'EMPTY');
}));

test('P0: missing hangar flag authority prevents a false completed receipt',()=>withF(f=>{
 const w=f.make(),stock=f.owned;
 assert.equal(w.deposit(f.arg).status,'COMMITTED');
 const flags=f.config.items.ITEM_FLAGS;
 delete f.config.items.ITEM_FLAGS;
 assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(w.audit().status,'NEEDS_RECONCILIATION');
 assert.equal(stock.size,1,'preserve original physical stock without guessing');
 f.config.items.ITEM_FLAGS=flags;
 assert.equal(w.deposit(f.arg).status,'ALREADY_COMMITTED');
}));

test('P0: warehouse DEBIT repair cannot create stock with missing fleet or system receipt authority',()=> {
 for(const [name,change] of [
  ['missing fleet',r=>{delete r.fleetID}],
  ['zero fleet',r=>{r.fleetID=0}],
  ['negative fleet',r=>{r.fleetID=-1}],
  ['missing system',r=>{delete r.systemID}],
  ['zero system',r=>{r.systemID=0}],
  ['invalid system',r=>{r.systemID='not-a-system'}]
 ]){
  withF(f=>{
   f.set({failGrant:true});
   assert.equal(f.make().deposit(f.arg).status,'TARGET_WRITE_UNCERTAIN');
   assert.equal(f.cargo.size,0,'original physical cargo already debited');
   assert.equal(f.issued,0);
   const file=path.join(f.root,'receipts','8001.json');
   const record=JSON.parse(fs.readFileSync(file,'utf8'));
   assert.equal(record.phase,'SOURCE_DEBIT_PROVEN');
   change(record);
   const corrupt=JSON.stringify(record);
   fs.writeFileSync(file,corrupt);
   f.set({failGrant:false});
   assert.equal(f.make().resume(8001,{authorize:true}).status,'NEEDS_OPERATOR_REPAIR',name);
   assert.equal(f.make().deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR',name);
   assert.equal(f.make().audit().status,'NEEDS_RECONCILIATION',name);
   assert.equal(f.owned.size,0,'no new stock from a corrupt original journal');
   assert.equal(f.issued,0,name);
   assert.equal(fs.readFileSync(file,'utf8'),corrupt,'no automatic journal rewrite');
  });
 }
});

test('P0: a COMMITTED receipt without original fleet/system must fail audit',()=>withF(f=>{
 assert.equal(f.make().deposit(f.arg).status,'COMMITTED');
 const file=path.join(f.root,'receipts','8001.json'),record=JSON.parse(fs.readFileSync(file,'utf8'));
 delete record.fleetID;
 fs.writeFileSync(file,JSON.stringify(record));
 assert.equal(f.make().deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.make().resume(8001,{authorize:true}).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.make().audit().status,'NEEDS_RECONCILIATION');
 assert.equal(f.issued,1,'never mint a second ItemStore stack');
}));

test('P0: valid original fleet/system DEBIT can still be recovered exactly once',()=>withF(f=>{
 f.set({failGrant:true});
 assert.equal(f.make().deposit(f.arg).status,'TARGET_WRITE_UNCERTAIN');
 const record=JSON.parse(fs.readFileSync(path.join(f.root,'receipts','8001.json'),'utf8'));
 assert.equal(record.fleetID,77);
 assert.equal(record.systemID,30000144);
 f.set({failGrant:false});
 assert.equal(f.make().resume(8001,{authorize:true}).status,'COMMITTED');
 assert.equal(f.make().resume(8001,{authorize:true}).status,'ALREADY_COMMITTED');
 assert.equal(f.issued,1);
 assert.equal(f.make().audit().status,'OK');
}));


test('P0: global original cargo on another ship blocks DEBIT recovery and real item grant',()=>withF(f=>{
 f.set({failGrant:true});
 assert.equal(f.make().deposit(f.arg).status,'TARGET_WRITE_UNCERTAIN');
 assert.equal(f.cargo.size,0);
 const file=path.join(f.root,'receipts','8001.json');
 const originalReceipt=fs.readFileSync(file,'utf8');
 const foreign={cargoID:8001,entityID:9909,ownerID:1000035,quantity:250,typeID:1230,
  moduleID:0,coopHaulFleetID:77,coopHaulSystemID:30000144,coopHaulFromMinerID:800,
  transient:false};
 f.cargo.set(8001,foreign);
 f.set({failGrant:false});
 assert.equal(f.make().resume(8001,{authorize:true}).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.make().audit().status,'NEEDS_RECONCILIATION');
 assert.equal(f.issued,0,'globally surviving original may never receive duplicate station stock');
 assert.equal(f.owned.size,0);
 assert.equal(fs.readFileSync(file,'utf8'),originalReceipt);
 f.cargo.delete(8001);
 assert.equal(f.make().resume(8001,{authorize:true}).status,'COMMITTED');
 assert.equal(f.issued,1);
 assert.equal(f.make().audit().status,'OK');
}));

test('P0: extra original cargoID in global native store blocks initial warehouse debit',()=>withF(f=>{
 const original=f.config.store.listNativeCargo;
 f.config.store.listNativeCargo=()=>[...original(),{
  ...f.cargo.get(8001),entityID:9999
 }];
 const w=f.make();
 assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.cargo.size,1,'original hauler cargo may not be debited');
 assert.equal(f.owned.size,0);
 assert.equal(f.issued,0);
 assert.equal(fs.existsSync(path.join(f.root,'receipts','8001.json')),false);
 f.config.store.listNativeCargo=original;
 assert.equal(w.deposit(f.arg).status,'COMMITTED');
 assert.equal(f.issued,1);
}));

test('P0: missing or corrupted global native cargo view cannot attest original source',()=>withF(f=>{
 const original=f.config.store.listNativeCargo,originalLocal=f.config.store.listNativeCargoForEntity;
 const w=f.make(),file=path.join(f.root,'receipts','8001.json');
 for(const corrupted of [null,undefined,{},false,'not an array']){
  f.config.store.listNativeCargo=()=>corrupted;
  assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
  assert.equal(f.issued,0);
  assert.equal(f.cargo.size,1);
  assert.equal(fs.existsSync(file),false);
 }
 f.config.store.listNativeCargo=()=>[];
 assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR','global/local missing row disagreement');
 assert.equal(f.cargo.size,1);
 f.config.store.listNativeCargo=()=>[{
  ...f.cargo.get(8001),quantity:9999
 }];
 assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR','global/local original quantity disagreement');
 assert.equal(f.issued,0);
 f.config.store.listNativeCargo=original;
 f.config.store.listNativeCargoForEntity=originalLocal;
 assert.equal(w.deposit(f.arg).status,'COMMITTED');
 assert.equal(f.issued,1);
}));

test('P0: warehouse cannot initialize without global native cargo uniqueness authority',()=>withF(f=>{
 delete f.config.store.listNativeCargo;
 assert.throws(()=>f.make(),/WAREHOUSE_DEPENDENCIES_REQUIRED/);
 assert.equal(f.cargo.size,1);
 assert.equal(f.issued,0);
}));


test('P0: second warehouse instance cannot overwrite a COMMITTED original receipt during PREPARED persist',()=>withF(f=>{
 const dir=path.join(f.root,'receipts'),lock=path.join(dir,'8001.lock');
 let triggered=false,nested=null,second=null;
 // Reenter at the exact old vulnerable boundary: outer deposit already
 // checked target identity and is about to persist its PREPARED receipt.
 f.config.fsApi={...fs,mkdirSync(location,options){
  fs.mkdirSync(location,options);
  if(!triggered&&location===dir&&fs.existsSync(lock)){
   triggered=true;
   nested=second.deposit(f.arg);
  }
 }};
 const first=f.make();second=f.make();
 assert.equal(first.deposit(f.arg).status,'COMMITTED');
 assert.equal(triggered,true);
 assert.equal(nested.status,'WAREHOUSE_CUSTODY_LOCKED');
 assert.equal(f.cargo.size,0,'source original debited once');
 assert.equal(f.issued,1,'only one native ItemStore stack');
 const journal=JSON.parse(fs.readFileSync(path.join(dir,'8001.json'),'utf8'));
 assert.equal(journal.phase,'COMMITTED','stale PREPARED cannot overwrite COMMITTED');
 assert.equal(first.audit().status,'OK');
 assert.equal(fs.existsSync(lock),false,'lock released after verified completion');
 assert.equal(second.deposit(f.arg).status,'ALREADY_COMMITTED');
 assert.equal(f.issued,1);
}));

test('P0: abandoned cross-process warehouse lock blocks debit and authorized item recovery',()=>withF(f=>{
 const dir=path.join(f.root,'receipts'),lock=path.join(dir,'8001.lock');
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(lock,'abandoned-pid');
 const first=f.make(),second=f.make();
 assert.equal(first.deposit(f.arg).status,'WAREHOUSE_CUSTODY_LOCKED');
 assert.equal(second.resume(8001,{authorize:true}).status,'WAREHOUSE_CUSTODY_LOCKED');
 assert.equal(first.audit().status,'NEEDS_RECONCILIATION');
 assert.equal(f.cargo.size,1);
 assert.equal(f.owned.size,0);
 assert.equal(f.issued,0);
 assert.equal(fs.existsSync(path.join(dir,'8001.json')),false);
 assert.equal(fs.readFileSync(lock,'utf8'),'abandoned-pid');
 fs.unlinkSync(lock); // simulated operator decision, not automated by server
 assert.equal(second.deposit(f.arg).status,'COMMITTED');
 assert.equal(f.issued,1);
 assert.equal(second.audit().status,'OK');
}));

test('P0: failed removal of warehouse lock cannot report COMMITTED as a trusted success',()=>withF(f=>{
 const original=fs.unlinkSync,dir=path.join(f.root,'receipts');
 f.config.fsApi={...fs,unlinkSync(file){
  if(file===path.join(dir,'8001.lock'))throw Object.assign(Error('EIO'),{code:'EIO'});
  return original(file);
 }};
 const w=f.make();
 assert.equal(w.deposit(f.arg).status,'NEEDS_OPERATOR_REPAIR');
 assert.equal(f.issued,1,'physical ItemStore stock already exists and is not retried');
 assert.equal(w.audit().status,'NEEDS_RECONCILIATION');
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,'8001.json'),'utf8'));
 assert.equal(receipt.phase,'COMMITTED');
 assert.equal(fs.existsSync(path.join(dir,'8001.lock')),true);
 assert.equal(w.deposit(f.arg).status,'WAREHOUSE_CUSTODY_LOCKED');
}));
