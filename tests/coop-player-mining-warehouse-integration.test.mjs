import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {createWarehouse}=require('../integration/coopNativeWarehouse.cjs');
const CID=4107,ITEM=9021,CORP=9002,PLAYER=9500,STATION=60000101,
 SYSTEM=30000144,FLEET=960004609,HAULER=9201;
function fixture(t,{titleWitness=null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-mining-title-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'receipts'));
 const source={version:1,phase:'COMMITTED',cargoID:CID,itemID:ITEM,
  typeID:34,quantity:25,haulerID:HAULER,fleetID:FLEET,systemID:SYSTEM,
  stationID:STATION,corporationID:CORP,at:1000,updatedAt:2000};
 fs.writeFileSync(path.join(root,'receipts',CID+'.json'),JSON.stringify(source));
 let item={itemID:ITEM,ownerID:PLAYER,locationID:9901,flagID:115,
  singleton:0,typeID:34,quantity:25,stacksize:25,
  customInfo:'coop-warehouse:v1:cargo:'+CID},cargo=[];
 const warehouse=createWarehouse({
  root,store:{listNativeCargoForEntity:()=>cargo,removeNativeCargo:()=>({success:true})},
  items:{findWarehouseItem:()=>item,grantUniqueNpcDepotItem:()=>({success:false})},
  flush:()=>({success:true}),getStation:()=>({stationID:STATION,solarSystemID:SYSTEM}),
  getCorporation:()=>({corporationID:CORP}),
  isNpcCorporation:()=>true,verifyArrival:()=>true,verifyDurableCargo:()=>true,
  verifyTransferredTitle:titleWitness,
  clock:()=>3000
 });
 return {warehouse,source,setCargo:v=>cargo=v,setItem:v=>item=v,root};
}
test('verified committed original item title is accepted in warehouse audit, never recounted as loss',t=>{
 const x=fixture(t,{titleWitness:r=>r.itemID===ITEM&&r.cargoID===CID});
 const report=x.warehouse.audit();
 assert.equal(report.status,'OK');
 assert.equal(report.committed,1);
 assert.equal(report.transferred,1);
 assert.equal(report.problems.length,0);
});
test('verified title is read-only from repeated warehouse deposit and resume',t=>{
 const x=fixture(t,{titleWitness:()=>true});
 const requested={cargoID:CID,haulerID:HAULER,fleetID:FLEET,
  systemID:SYSTEM,stationID:STATION,corporationID:CORP,arrivedAtMs:1000};
 assert.equal(x.warehouse.deposit(requested).status,'TITLE_TRANSFERRED');
 assert.equal(x.warehouse.resume(CID,{authorize:true}).status,'TITLE_TRANSFERRED');
 assert.equal(x.warehouse.getReceipt(CID).itemID,ITEM);
});
test('without attested title, original warehouse retains strict mismatch failure',t=>{
 const x=fixture(t);
 const result=x.warehouse.audit();
 assert.equal(result.status,'NEEDS_RECONCILIATION');
 assert.equal(result.committed,0);
 assert.equal(result.problems.length,1);
});
test('title witness cannot clear loss when old hauler still contains original cargo',t=>{
 const x=fixture(t,{titleWitness:()=>true});
 x.setCargo([{cargoID:CID,entityID:HAULER,quantity:25,typeID:34}]);
 assert.equal(x.warehouse.audit().status,'NEEDS_RECONCILIATION');
});
test('warehouse receipt reader returns a clone; caller cannot rewrite source evidence',t=>{
 const x=fixture(t,{titleWitness:()=>true});
 const row=x.warehouse.getReceipt(CID);
 row.quantity=1;
 assert.equal(x.warehouse.getReceipt(CID).quantity,25);
});
