import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {reconcileUnknown}=require('../integration/coopNpcEconomyUnknownRecovery.cjs');
const OP='npc-manufacture:'+'a'.repeat(32),OWNER=1000010,STATION=60000001,TYPE=215,BPO=91,JOBID=970000000000000,ITEMID=1990000200;
function setup(phase='INSTALL_UNKNOWN'){
 const plan={ownerID:OWNER,stationID:STATION,productTypeID:TYPE,blueprintItemID:BPO,outputQuantity:100,runs:1};
 const quote={verifiedNative:true,totalCost:10,ownerID:OWNER,facilityID:STATION,blueprintID:BPO,productTypeID:TYPE};
 const entry={operationID:OP,phase,ownerID:OWNER,stationID:STATION,typeID:TYPE,plan,quote,jobID:JOBID,installCostCents:1000};
 const job={jobID:JOBID,coopOperationID:OP,ownerID:OWNER,stationID:STATION,facilityID:STATION,activityID:1,blueprintID:BPO,productTypeID:TYPE,runs:1,outputLocationID:STATION,outputFlagID:4,totalCost:10,coopQuoteSignature:JSON.stringify(quote),status:phase==='INSTALL_UNKNOWN'?1:4,coopDelivery:{operationID:OP,itemID:ITEMID,typeID:TYPE,quantity:100}};
 const item={itemID:ITEMID,typeID:TYPE,ownerID:OWNER,locationID:STATION,flagID:4,quantity:100,stacksize:100,singleton:0,customInfo:'coop-industry:v1:'+JOBID};
 let reads=0;
 const native={getJob:()=>{reads++;return job},getIndustryDebit:()=>({verifiedNative:true,jobID:JOBID,ownerID:OWNER,amountCents:1000,transactionID:JOBID}),getItem:()=>{reads++;return item},
  installOnce:()=>{throw Error('REPLAYED_INSTALL')},deliverOnce:()=>{throw Error('REPLAYED_DELIVERY')}};
 return {entry,job,item,native,get reads(){return reads}};
}
test('lost install ACK reconciles exact durable job and cash debit without replay',()=>{
 const f=setup();const r=reconcileUnknown(f);
 assert.deepEqual(r,{ok:true,status:'RECOVERED_INSTALLED',patch:{phase:'INSTALLED',jobID:JOBID,installCostCents:1000}});
 assert.equal(f.reads,1);
});
test('PAUSED and READY jobs can be recovered without advancing their timers',()=>{
 for(const status of [2,3]){const f=setup();f.job.status=status;const r=reconcileUnknown(f);
 assert.equal(r.status,'RECOVERED_INSTALLED');assert.equal(f.job.status,status);}
});
test('unknown install without persisted job must NEVER repeat a paid native install',()=>{
 const f=setup();f.native.getJob=()=>null;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_JOB_NOT_ATTESTED');
});
test('lost wallet debit or mismatched cents cannot recover an install',()=>{
 const f=setup();f.native.getIndustryDebit=()=>null;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_INDUSTRY_DEBIT_NOT_ATTESTED');
 f.native.getIndustryDebit=()=>({verifiedNative:true,jobID:JOBID,ownerID:OWNER,amountCents:999,transactionID:JOBID});
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_INDUSTRY_DEBIT_NOT_ATTESTED');
});
test('corrupt quote or job identity cannot recover paid manufacturing',()=>{
 const f=setup();f.job.coopQuoteSignature='fake';
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_INSTALL_QUOTE_OR_STATUS_INVALID');
 f.job.coopQuoteSignature=JSON.stringify(f.entry.quote);f.job.ownerID=OWNER+1;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_JOB_NOT_ATTESTED');
});
test('COMPLETED=100 without native output proof never transitions to installed',()=>{
 const f=setup();f.job.status=100;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_INSTALL_QUOTE_OR_STATUS_INVALID');
});
test('lost delivery ACK recovers only original persisted physical output item',()=>{
 const f=setup('DELIVERY_UNKNOWN');const r=reconcileUnknown(f);
 assert.deepEqual(r,{ok:true,status:'RECOVERED_DELIVERED',patch:{phase:'DELIVERED',itemID:ITEMID,quantity:100}});
 assert.equal(f.reads,2);
});
test('reconnect or market movement before recovery does not fabricate hangar stock',()=>{
 const f=setup('DELIVERY_UNKNOWN');f.item.locationID=9200000011;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_DELIVERY_ITEM_NOT_ATTESTED');
});
test('ghost output, wrong owner, wrong quantity and duplicate custody fail closed',()=>{
 const f=setup('DELIVERY_UNKNOWN');
 for(const [k,value] of [['ownerID',OWNER+1],['quantity',101],['stacksize',99],['customInfo','phantom'],['itemID',999],['flagID',5]]){
  const old=f.item[k];f.item[k]=value;
  assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_DELIVERY_ITEM_NOT_ATTESTED',k);
  f.item[k]=old;
 }
 f.native.getItem=()=>null;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_DELIVERY_ITEM_NOT_ATTESTED');
});
test('receipt quantity, type and original operation must agree with native job',()=>{
 const f=setup('DELIVERY_UNKNOWN');f.job.coopDelivery.quantity=200;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_DELIVERY_RECEIPT_INVALID');
 f.job.coopDelivery.quantity=100;f.job.coopDelivery.operationID='npc-manufacture:'+'b'.repeat(32);
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_DELIVERY_RECEIPT_INVALID');
});
test('unknown market listing is NOT recoverable by manufacturing journal',()=>{
 const f=setup();f.entry.phase='LIST_UNKNOWN';
 assert.equal(reconcileUnknown(f).reason,'UNKNOWN_ECONOMY_PHASE_NOT_RECONCILABLE');
});
test('unavailable persistent store cannot be mistaken for a completed transaction',()=>{
 const f=setup();f.native.getJob=()=>{throw Error('SQLITE_IO_ERROR')};
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_READ_UNAVAILABLE');
});

test('lost delivery ACK still requires original paid wallet debit',()=>{
 const f=setup('DELIVERY_UNKNOWN');
 f.native.getIndustryDebit=()=>null;
 assert.equal(reconcileUnknown(f).reason,'NATIVE_RECOVERY_INDUSTRY_DEBIT_NOT_ATTESTED');
});
