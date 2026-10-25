import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {plan,commitNative,assertZeroMoney}=require('../integration/coopNativeTradeAtomic.cjs');
const {patch,inventoryPath,tradePath}=require('../scripts/coop-atomic-trade-patch.cjs');
const trade={status:'open',traders:[11,22],tradeContainerID:91000000,dockedLocationID:60003760,moneyOffers:[0,0]};
const item=(itemID,ownerID,locationID,categoryID=18)=>({itemID,ownerID,locationID,typeID:categoryID===6?603:34,categoryID,flagID:4,singleton:categoryID===6?1:0,quantity:categoryID===6?-1:25,stacksize:categoryID===6?1:25});
const data=()=>({
 '1001':item(1001,11,91000000,6),
 '1002':{...item(1002,11,1001),flagID:27},
 '1003':{...item(1003,11,1002),flagID:5},
 '1004':item(1004,22,91000000),
 '7777':item(7777,44,60003760),
});
const planIt=(over={})=>plan({trade,roots:[{itemID:1001},{itemID:1004}],items:data(),activeShipIDs:[3001,3002],...over});
test('single atomic manifest owns entire ship, nested module and nested cargo',()=>{
 const p=planIt();assert.equal(p.ok,true);assert.equal(p.changes.length,4);
 assert.deepEqual(p.changes.map(x=>[x.itemID,x.ownerID,x.locationID]),[
  [1001,22,60003760],[1002,22,1001],[1003,22,1002],[1004,11,60003760]]);
 assert.equal(p.rootCount,2);
});
test('all state checks occur before any write; unmatched manifest fails closed',()=>{
 assert.equal(planIt({roots:[{itemID:1001}]}).reason,'TRADE_MANIFEST_CHANGED');
 assert.equal(planIt({roots:[{itemID:1001},{itemID:1004},{itemID:1004}]}).reason,'TRADE_MANIFEST_CHANGED');
});
test('active ships cannot be gifted',()=>assert.equal(planIt({activeShipIDs:[1001]}).reason,'INVALID_TRADE_ROOT'));
test('cross-owner nested item cannot leave with ship',()=>{
 const d=data();d['1002'].ownerID=22;
 assert.equal(planIt({items:d}).reason,'INVALID_NESTED_CUSTODY');
});
test('cycle or nested item overlap is rejected',()=>{
 const d=data();d['1001'].locationID=1003;
 assert.equal(planIt({items:d}).reason,'TRADE_MANIFEST_CHANGED');
});
test('trade snapshots after first settlement cannot pass twice',()=>{
 const p=planIt();const after=data();for(const c of p.changes)after[String(c.itemID)]={...c.previous,ownerID:c.ownerID,locationID:c.locationID,flagID:c.flagID};
 assert.equal(planIt({items:after}).reason,'TRADE_MANIFEST_CHANGED');
});
test('ISK offer always fails before wallet mutations',()=>{
 assert.equal(planIt({trade:{...trade,moneyOffers:[100,0]}}).reason,'NONZERO_ISK_NOT_ATOMIC');
 assert.equal(planIt({trade:{...trade,moneyOffers:[NaN,0]}}).reason,'NONZERO_ISK_NOT_ATOMIC');
});
test('partial/invalid stack, bad location, duplicate and invalid ID blocked',()=>{
 const a=data();a['1002'].stacksize=0;assert.equal(planIt({items:a}).reason,'INVALID_NATIVE_QUANTITY');
 const b=data();b['1004'].itemID=999;assert.equal(planIt({items:b}).reason,'INVALID_NATIVE_ROW');
});
test('exact reversible pinned overlay transform on source-shaped anchors',()=>{
 const inv='function keep() {}\nmodule.exports = {\n  writeItemCustomInfo,\n};\n';
 const t='function trading() {\n    const moneyTransferResult = this._completeMoneyTransfer(trade);\n    const itemTransferResult = this._completeItemTransfers(trade);\n}\n';
 for(const [s,file] of [[inv,inventoryPath],[t,tradePath]]){
  const installed=patch(s,file); assert.ok(installed.includes('transferCoopManifestAtomically')||installed.includes('EVEJS_COOP_ATOMIC_TRADE'));
  assert.equal(patch(installed,file),installed);assert.equal(patch(installed,file,true),s);
 }
});

test('native commit writes complete ownership graph in ONE real items-table call',()=>{
 const before=data(),writes=[];
 const result=commitNative({trade,roots:[{itemID:1001},{itemID:1004}],activeShipIDs:[],
   readItems:()=>before,writeItems:(next,options)=>{writes.push({next,options});return true},
   normalizeInventoryItem:x=>({...x}),buildInventoryItem:x=>({...x}),
   indexDeltaFromChanges:changes=>({upsertedIDs:changes.map(x=>x.item.itemID),removedIDs:[]}),
   cloneValue:x=>JSON.parse(JSON.stringify(x))});
 assert.equal(result.success,true);assert.equal(writes.length,1);
 assert.equal(writes[0].next['1001'].ownerID,22);assert.equal(writes[0].next['1003'].ownerID,22);
 assert.equal(writes[0].next['1004'].ownerID,11);assert.equal(before['1001'].ownerID,11);
 assert.equal(result.data.changes.length,4);
});
test('failed native one-write cannot mutate original memory or wallet',()=>{
 const before=data();let writes=0;
 const deps={trade,roots:[{itemID:1001},{itemID:1004}],activeShipIDs:[],
   readItems:()=>before,writeItems:()=>{writes++;return false},
   normalizeInventoryItem:x=>({...x}),buildInventoryItem:x=>({...x}),
   indexDeltaFromChanges:()=>({}),cloneValue:x=>JSON.parse(JSON.stringify(x))};
 assert.equal(commitNative(deps).errorMsg,'TRADE_ATOMIC_WRITE_FAILED');
 assert.equal(before['1001'].ownerID,11);assert.equal(writes,1);
});
test('zero-ISK gate rejects money before any native wallet call',()=>{
 let resets=0,throws=0;
 const svc={_resetOfferState:()=>{resets++},_throwTradeError:(msg)=>{throws++;throw Error(msg)}};
 assert.throws(()=>assertZeroMoney({...trade,moneyOffers:[1,0]},svc),/zero ISK/);
 assert.equal(resets,1);assert.equal(throws,1);
 assert.doesNotThrow(()=>assertZeroMoney(trade,svc));
});