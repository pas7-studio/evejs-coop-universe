import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createPlayerMiningOreTitle,RECEIPT}=require('../integration/coopPlayerMiningOreTitle.cjs');
const SEP='\u001f',CID=711,CORP=9981,NPC=9911,SYSTEM=30000144,FLEET=960004609,
 SHIFT='coop-mining-shift:'+'a'.repeat(32),ITEM=789012,STATION=60000001,OFFICE=800012,
 OP=`coop-mining-ore-title:v1:${SHIFT}:${CID}`;
function fixture(){
 const rows=new Map(),source={corporationID:NPC,isNPC:true,wallet:{divisions:{'1000':{balance:30,journal:[],transactions:[]}}}},
 buyer={corporationID:CORP,isNPC:false,wallet:{divisions:{'1000':{balance:500,journal:[],transactions:[]}}}};
 rows.set('corporationRuntime'+SEP+'corporations'+SEP+NPC,source);
 rows.set('corporationRuntime'+SEP+'corporations'+SEP+CORP,buyer);
 const item={itemID:ITEM,ownerID:NPC,locationID:STATION,flagID:4,singleton:0,
  typeID:34,quantity:75,stacksize:75,customInfo:`coop-warehouse:v1:cargo:${CID}`};
 rows.set('items'+SEP+ITEM,item);
 rows.set('corporationRuntime'+SEP+'coopPlayerMiningShift'+SEP+SHIFT,{version:1,status:'FUNDED',operationID:SHIFT,
  corporationID:CORP,employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET,createdAt:1000,haulerIDs:[1003]});
 rows.set('corporationRuntime'+SEP+'coopPlayerMiningFleet'+SEP+SYSTEM+':'+FLEET,{version:1,operationID:SHIFT,
 corporationID:CORP,employerCorpID:NPC});
 const proof={version:1,phase:'COMMITTED',cargoID:CID,itemID:ITEM,typeID:34,
  quantity:75,systemID:SYSTEM,fleetID:FLEET,corporationID:NPC,stationID:STATION,haulerID:1003,at:1500,updatedAt:179000};
 let allowed=true,office=true,validProof=true,validQuote=true,flag=true,poisoned=false,throwAfter=-1,
 writes=0,now=1793030000000;
 const native={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poisoned,
 transact(tables,fn){assert.deepEqual(tables,['items','corporationRuntime']);const copy=structuredClone([...rows]);let n=0;
   try{return fn({get(t,key){return rows.get(t+SEP+key)??null;},
    scan(t){return [...rows].filter(([key])=>key.startsWith(t+SEP)).map(([key,value])=>({key:key.slice(t.length+1),value}));},
    put(t,key,val){rows.set(t+SEP+key,structuredClone(val));writes++;if(++n===throwAfter)throw Error('POWER_LOSS_BEFORE_COMMIT');}});}
   catch(e){rows.clear();for(const [k,v]of copy)rows.set(k,v);throw e;}
 }}};
 const service=createPlayerMiningOreTitle({gameStore:native,
 access:{isMember:()=>allowed,canIndustry:()=>allowed,canWallet:()=>allowed,canView:()=>allowed},
 verifyOffice:()=>office,verifyNpcCorporation:(id,record)=>id===NPC&&(!record||record.isNPC===true),
 getWarehouseReceipt:()=>validProof?structuredClone(proof):null,
 quoteOre:()=>validQuote?{verifiedNative:true,operationID:OP,cargoID:CID,itemID:ITEM,
  sourceCorpID:NPC,buyerCorpID:CORP,stationID:STATION,typeID:34,quantity:75,priceCents:12345}:null,
 enabled:()=>flag,clock:()=>now});
 const request=(extra={})=>service.transfer({session:{characterID:777},shiftID:SHIFT,cargoID:CID,itemID:ITEM,
  typeID:34,quantity:75,systemID:SYSTEM,fleetID:FLEET,sourceCorpID:NPC,buyerCorpID:CORP,
  stationID:STATION,officeFolderID:OFFICE,division:115,maxPriceCents:12345,...extra});
 const wallet=id=>rows.get('corporationRuntime'+SEP+'corporations'+SEP+id).wallet.divisions['1000'];
 return {service,request,rows,proof,item,wallet,writes:()=>writes,
  allow:v=>allowed=v,office:v=>office=v,validProof:v=>validProof=v,validQuote:v=>validQuote=v,
  enable:v=>flag=v,poison:v=>poisoned=v,failAt:v=>throwAfter=v};
}
test('default disabled does not mutate original item or any ISK',()=>{
 const x=fixture();x.enable(false);assert.equal(x.request().reason,'MINING_ORE_TRANSFER_DISABLED');
 assert.equal(x.writes(),0);
});
test('one original item moves from native NPC warehouse to player office and credits exact price',()=>{
 const x=fixture(),res=x.request();assert.equal(res.status,'TITLE_TRANSFERRED');
 assert.equal(x.writes(),4);assert.equal(res.originalItemID,ITEM);
 const item=x.rows.get('items'+SEP+ITEM);
 assert.equal(item.itemID,ITEM);assert.equal(item.ownerID,CORP);
 assert.equal(item.locationID,OFFICE);assert.equal(item.flagID,115);
 assert.equal(item.customInfo,`coop-warehouse:v1:cargo:${CID}`);
 assert.equal(x.wallet(NPC).balance,153.45);assert.equal(x.wallet(CORP).balance,376.55);
 assert.equal(x.writes(),4);
 assert.equal(x.rows.get('corporationRuntime'+SEP+RECEIPT(CID)).itemID,ITEM);
});
test('replay is idempotent even when original item has moved on for refining',()=>{
 const x=fixture();assert.equal(x.request().status,'TITLE_TRANSFERRED');
 const before=x.writes();x.rows.delete('items'+SEP+ITEM);
 assert.equal(x.request().status,'ALREADY_TRANSFERRED');assert.equal(x.writes(),before);
 assert.equal(x.wallet(NPC).balance,153.45);assert.equal(x.wallet(CORP).balance,376.55);
});
test('same cargo cannot be purchased with a different shift or different office',()=>{
 const x=fixture();assert.equal(x.request().status,'TITLE_TRANSFERRED');
 assert.match(x.request({officeFolderID:OFFICE+1}).reason,/RECEIPT_CONFLICT/);
 assert.equal(x.wallet(NPC).balance,153.45);
});
test('unfunded or incorrect fleet cannot authorize title',()=>{
 for(const mutate of [x=>x.rows.delete('corporationRuntime'+SEP+'coopPlayerMiningShift'+SEP+SHIFT),
  x=>x.rows.get('corporationRuntime'+SEP+'coopPlayerMiningShift'+SEP+SHIFT).haulerIDs=[9999],
  x=>x.rows.get('corporationRuntime'+SEP+'coopPlayerMiningFleet'+SEP+SYSTEM+':'+FLEET).corporationID=2000]){
  const x=fixture();mutate(x);assert.match(x.request().reason,/FUNDED_FLEET_RECEIPT_MISMATCH/);
  assert.equal(x.writes(),0);
 }
});
test('unknown or forged warehouse delivery never buys ore',()=>{
 const x=fixture();x.validProof(false);assert.equal(x.request().reason,'MINING_ORE_ORIGINAL_DELIVERY_NOT_ATTESTED');
 assert.equal(x.writes(),0);
});
test('permissions and office visibility are native, revoked authority blocks mutation',()=>{
 for(const field of ['allow','office']){
  const x=fixture();x[field](false);assert.equal(x.request().status,'BLOCKED');assert.equal(x.writes(),0);
 }
});
test('pricing is server authoritative, cannot exceed player max price',()=>{
 const x=fixture();assert.equal(x.request({maxPriceCents:12000}).reason,'MINING_ORE_NATIVE_PRICE_NOT_ATTESTED');
 x.validQuote(false);assert.equal(x.request().reason,'MINING_ORE_NATIVE_PRICE_NOT_ATTESTED');
});
test('item mutated, split, remote or untagged blocks and never prints ISK',()=>{
 for(const mutate of [x=>x.item.quantity=74,x=>x.item.ownerID=0,x=>x.item.locationID=STATION+3,
  x=>x.item.customInfo='fake',x=>x.item.stacksize=74]){
  const x=fixture();mutate(x);assert.match(x.request().reason,/ORIGINAL_ITEM_CUSTODY_MISMATCH/);
  assert.equal(x.writes(),0);assert.equal(x.wallet(CORP).balance,500);
 }
});
test('duplicated physical source marker prevents either wallet debit',()=>{
 const x=fixture();x.rows.set('items'+SEP+999,{...x.item,itemID:999});
 assert.match(x.request().reason,/DUPLICATE_CARGO_PROVENANCE/);assert.equal(x.writes(),0);
});
test('insufficient native corporate ISK blocks transfer before all writes',()=>{
 const x=fixture();x.wallet(CORP).balance=1;
 assert.match(x.request().reason,/INSUFFICIENT_ISK/);assert.equal(x.writes(),0);
});
test('failed midway native writer rolls back wallets and item together in mock',()=>{
 const x=fixture();x.failAt(3);assert.match(x.request().reason,/COMMIT_UNCERTAIN/);
 assert.equal(x.writes(),3);
 assert.equal(x.rows.get('items'+SEP+ITEM).ownerID,NPC);assert.equal(x.wallet(CORP).balance,500);
 assert.deepEqual(x.service.requiresOperatorReconciliation(),[CID]);
});
test('tampered historical wallet receipt fails safely without another title move',()=>{
 const x=fixture();x.request();x.wallet(CORP).journal[0].amount=-5;
 assert.match(x.request().reason,/RECEIPT_CONFLICT/);assert.equal(x.wallet(NPC).balance,153.45);
});
test('legacy NPC warehouse transfer of same cargo is mutually exclusive',()=>{
 const x=fixture();x.rows.set('corporationRuntime'+SEP+'coopWarehouseTitleTransfer'+SEP+CID,{phase:'COMMITTED'});
 assert.match(x.request().reason,/LEGACY_TRANSFER/);
});
test('exact native office division and poisoned store reject pre-commit',()=>{
 const x=fixture();assert.equal(x.request({division:114}).reason,'MINING_ORE_TRANSFER_SCOPE_INVALID');
 x.poison(true);assert.equal(x.request().reason,'MINING_ORE_GAMESTORE_POISONED');
});

import {createPlayerMiningOreAudit} from '../integration/coopPlayerMiningOreTitle.cjs';
function auditFixture(){
 const x=fixture();assert.equal(x.request().status,'TITLE_TRANSFERRED');
 let office=true;
 const audit=createPlayerMiningOreAudit({
  readTitleReceipt:()=>x.rows.get('corporationRuntime'+SEP+RECEIPT(CID)),
  readCorporation:id=>x.rows.get('corporationRuntime'+SEP+'corporations'+SEP+id),
  findItemById:id=>x.rows.get('items'+SEP+id),
  findByCargoID:()=>[...x.rows].find(([key,value])=>key.startsWith('items'+SEP)&&
   value.customInfo===`coop-warehouse:v1:cargo:${CID}`)?.[1]||null,
  verifyOfficeReceipt:()=>office});
 const receipt={phase:'COMMITTED',cargoID:CID,itemID:ITEM,typeID:34,quantity:75,
   corporationID:NPC,stationID:STATION};
 return {x,audit,receipt,setOffice:v=>office=v};
}
test('warehouse reconciles paid title with same item, real office and both native journals',()=>{
 const a=auditFixture();assert.equal(a.audit.transferred(a.receipt),true);
});
test('warehouse reconciliation refuses absent source title or wrong destination office',()=>{
 const a=auditFixture();a.setOffice(false);assert.equal(a.audit.transferred(a.receipt),false);
 a.setOffice(true);a.x.rows.delete('corporationRuntime'+SEP+RECEIPT(CID));
 assert.equal(a.audit.transferred(a.receipt),false);
});
test('warehouse reconciliation refuses cloned or consumed original native item',()=>{
 const a=auditFixture();a.x.rows.delete('items'+SEP+ITEM);
 assert.equal(a.audit.transferred(a.receipt),false);
});
test('warehouse reconciliation rejects tampered native buyer wallet after title',()=>{
 const a=auditFixture();a.x.wallet(CORP).journal[0].amount=0;
 assert.equal(a.audit.transferred(a.receipt),false);
});
test('warehouse reconciliation rejects tampered conserved price witness',()=>{
 const a=auditFixture();a.x.rows.get('corporationRuntime'+SEP+RECEIPT(CID)).sourceAfterCents++;
 assert.equal(a.audit.transferred(a.receipt),false);
});

test('warehouse ore predating the funded mining shift is not counted as shift output',()=>{
 const x=fixture();x.proof.at=500;
 assert.match(x.request().reason,/FUNDED_FLEET_RECEIPT_MISMATCH/);
 assert.equal(x.writes(),0);
});
