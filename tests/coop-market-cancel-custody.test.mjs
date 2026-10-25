import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assertMatchingBuyEscrow,assertCancelledAck}=require('../integration/coopMarketCancelCustody.cjs');
const {patch}=require('../scripts/coop-market-cancel-custody-patch.cjs');
const original={order_id:'9100000000000001',owner_id:123,is_corp:false,source:'player',state:'open',
 row:{order_id:'9100000000000001',station_id:60001234,type_id:34,vol_remaining:7,price:12.34,bid:true,source:'player'}};
const funded={orderId:'9100000000000001',ownerId:123,isCorp:false,escrowType:'buy',
 stationId:60001234,typeId:34,remainingQuantity:7,price:12.34,escrowAmount:86.38};
const input=(o=original,e=funded)=>({order:o,escrow:e});
test('verified exact native buy order and matching native escrow',()=>{
 const p=assertMatchingBuyEscrow(input());
 assert.equal(p.refundCents,8638);
 assert.equal(p.orderID,'9100000000000001');
 assert.equal(Object.isFrozen(p),true);
});
test('reject missing escrow, never mint from Rust price times quantity',()=>{
 for(const e of [null,undefined,{}, {...funded,escrowType:'sell'}, {...funded,isCorp:true}])
  assert.throws(()=>assertMatchingBuyEscrow({order:original,escrow:e}),/COOP_MARKET_CANCEL_/);
});
test('reject mismatched owner, station, type, order and quantity',()=>{
 for(const [field,value] of [['orderId','9100000000000002'],['ownerId',999],['stationId',111],
  ['typeId',35],['remainingQuantity',6]])
  assert.throws(()=>assertMatchingBuyEscrow(input(original,{...funded,[field]:value})),/COOP_MARKET_CANCEL_/);
});
test('reject stale Rust row after partial fill; no surplus buy refund',()=>{
 const partial={...original,row:{...original.row,vol_remaining:3}};
 assert.throws(()=>assertMatchingBuyEscrow(input(partial)),/COOP_MARKET_CANCEL_/);
 assert.equal(assertMatchingBuyEscrow(input(partial,{...funded,remainingQuantity:3,escrowAmount:37.02})).refundCents,3702);
});
test('reject free cash from manipulated price or escrow amount',()=>{
 for(const changes of [{price:0},{price:12.35},{escrowAmount:999999},{escrowAmount:NaN}])
  assert.throws(()=>assertMatchingBuyEscrow(input(original,{...funded,...changes})),/COOP_MARKET_CANCEL_/);
});
test('reject an order with counterfeit row, ask direction or corporation owner',()=>{
 const candidates=[{...original,row:{...original.row,bid:false}},
  {...original,row:{...original.row,order_id:'9100000000000002'}},
  {...original,owner_id:999},{...original,is_corp:true},{...original,source:'coop-npc'},
  {...original,row:{...original.row,price:13}},
  {...original,row:{...original.row,vol_remaining:-1}}];
 for(const order of candidates)assert.throws(()=>assertMatchingBuyEscrow(input(order)),/COOP_MARKET_CANCEL_/);
});
test('strict decimal-only Rust order identity; reject numeric overflow and decimals',()=>{
 for(const bad of [Number.MAX_SAFE_INTEGER+1,'0009','1e9',9.2,'-2','0'])
  assert.throws(()=>assertMatchingBuyEscrow(input({...original,order_id:bad})),/COOP_MARKET_CANCEL_/);
});
test('cancel ACK must match the same native Rust order',()=>{
 assert.equal(assertCancelledAck({ack:{order_id:original.order_id,state:'cancelled',invalidated:true},orderID:original.order_id}),true);
 for(const ack of [null,{}, {order_id:original.order_id,state:'open',invalidated:true},
  {order_id:original.order_id,state:'cancelled',invalidated:false},
  {order_id:'9100000000000002',state:'cancelled',invalidated:true}])
  assert.throws(()=>assertCancelledAck({ack,orderID:original.order_id}),/COOP_MARKET_CANCEL_/);
});
const fixture=`function syncOpenBuyEscrowRecords(ownerOrders = []) {
 for(const ownerOrder of ownerOrders) {
    upsertBuyEscrowRecord(ownerOrder);
 }
}
function updateMovedItemsOwner(){}
async function applyExpiredOrderEvent(event) {
  if (true) {
    const escrowRecord = getEscrowRecord(orderID);
    if (escrowRecord && getEscrowType(escrowRecord) === "buy") {
      const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);
    }
  }
}
function applyCancelledStructureMarketOrder(order) {
    const escrowRecord = getEscrowRecord(orderID);
    const refundAmount = escrowRecord && getEscrowType(escrowRecord) === "buy"
      ? roundIsk(escrowRecord.escrowAmount):0;
}
async function cancelStructureMarketOrdersForServiceLoss(){}
class Proxy {
  async Handle_CancelCharOrder(args, session) {
      const cancelResponse = await marketDaemonClient.call("CancelOrder", {
        order_id: orderID,
      });
      if (normalizeBoolean(orderRow && orderRow.bid) && cancelResponse && cancelResponse.invalidated) {
        const escrowRecord = getEscrowRecord(orderID);
        const refundAmount = escrowRecord && getEscrowType(escrowRecord) === "buy"
          ? roundIsk(escrowRecord.escrowAmount):0;
      }
  }
  async Handle_ModifyCharOrder(args, session) {}
}`;
test('one installer-owned patch is idempotent, reversible, gated and syntax-safe',()=>{
 const changed=patch(fixture);
 assert.notEqual(changed,fixture);
 assert.equal(patch(changed),changed);
 assert.equal(patch(changed,{remove:true}),fixture);
 assert.equal(patch(fixture,{remove:true}),fixture);
 assert.equal((changed.match(/EVEJS_COOP_MARKET_CANCEL_CUSTODY/g)||[]).length,6);
 assert.doesNotThrow(()=>new Function(changed));
});
test('source hooks preserve CRLF and refuse unknown or duplicate native anchors',()=>{
 const crlf=fixture.replaceAll('\n','\r\n');
 assert.equal(patch(patch(crlf),{remove:true}),crlf);
 assert.throws(()=>patch(fixture.replace('const cancelResponse =','const otherResponse =')),
  /COOP_CANCEL_SOURCE_ANCHOR_MISMATCH/);
 const patched=patch(fixture);
 assert.throws(()=>patch(patched.replace('async function applyExpiredOrderEvent(event) {',
  'async function applyExpiredOrderEvent(event) {}\nasync function applyExpiredOrderEvent(event) {')),
  /COOP_CANCEL_SOURCE_SECTION_MISSING/);
});

test('exact pinned market overlay roundtrip with concurrent catalog/NPC hooks',t=>{
 const upstream=process.env.EVEJS_COOP_CODE_PATH;
 if(!upstream){t.skip('EVEJS_COOP_CODE_PATH is not available in this session');return;}
 const fs=require('node:fs'),path=require('node:path');
 const {specs,transform}=require('../scripts/patch-evejs-coop.cjs');
 const file='server/src/services/market/marketProxyService.js';
 const spec=specs.find(s=>s.file===file);
 assert.ok(spec,'registered market source required');
 const native=fs.readFileSync(path.join(upstream,file),'utf8');
 const pristine=transform(native,spec,true);
 const applied=transform(pristine,spec,false);
 assert.ok(applied.includes('EVEJS_COOP_MARKET_CANCEL_CUSTODY'));
 assert.equal(transform(applied,spec,false),applied);
 assert.equal(transform(applied,spec,true),pristine);
});
