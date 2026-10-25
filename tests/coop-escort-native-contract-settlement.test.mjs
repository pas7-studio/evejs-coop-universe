import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createEscortContractSettlement}=require('../integration/coopEscortContractSettlement.cjs');
const prior=process.env.EVEJS_COOP_ESCORT_CONTRACTS;
process.env.EVEJS_COOP_ESCORT_CONTRACTS='1';
const offer={contractID:'escort-perimeter-001',manifestKey:'30000144-11-1234567',
  systemID:30000144,fleetID:11,haulerID:101,stationID:60001,
  corporationID:10001,pirateID:202,incidentKey:'30000144:202:101',
  fleetDuoID:33,characters:[701,702],amountISK:20000};
function fixture(options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'escort-test-'));
 const rows=[{cargoID:5501,haulerID:101,typeID:123,quantity:7,fromMinerID:303},
  {cargoID:5502,haulerID:101,typeID:124,quantity:9,fromMinerID:303}];
 const manifest={status:'READY',record:{key:offer.manifestKey,
  systemID:offer.systemID,fleetID:offer.fleetID,stationID:offer.stationID,
  corporationID:offer.corporationID,haulerIDs:[101],cargo:rows}};
 const full={status:'FULL_NATIVE_CARGO_DELIVERY_VERIFIED',key:offer.manifestKey,
  stationID:offer.stationID,haulerIDs:[101],cargoIDs:[5501,5502],stacks:2,quantity:16,
  convoySaved:false,paidReward:false};
 const incident={status:'READY',incidents:[{key:offer.incidentKey,systemID:offer.systemID,
  targetID:101,pirateID:202,targetRole:'hauler',duoFleetID:33,
  characters:[701,702],status:'PIRATE_WRECK_CONFIRMED',closed:true,nativeWreckID:999}]};
 const outcomes={status:'READY',outcomes:[{key:offer.incidentKey,haulerNativeWreckID:0,
  verifiedWarehouseStacks:rows.map((r,i)=>({cargoID:r.cargoID,itemID:i+9001,
   typeID:r.typeID,quantity:r.quantity,stationID:offer.stationID,ownerID:offer.corporationID}))}]};
 const delivery={status:'DELIVERED',terminal:true,nativeFullManifestProof:full};
 let balance=50000,reservation=null,settlement=null,reserveCalls=0,payCalls=0;
 const nativeFunds={
  capabilities:()=>({nativeDurable:true,atomicDualCredit:true,durableIdempotency:true}),
  verifyReservation:()=>reservation||{status:'NOT_FOUND'},
  reserveAtomic:(c)=>{reserveCalls++;if(options.reserveThrow)throw Error('before/after ambiguous');
   if(reservation)throw Error('already reserved');
   if(balance<c.amountISK)throw Error('insufficient funds');
   balance-=c.amountISK;reservation={status:'RESERVED',contractID:c.contractID,
    corporationID:c.corporationID,amountISK:c.amountISK,escrowKey:c.contractID,nativeDurable:true};},
  verifySettlement:()=>settlement||{status:'NOT_FOUND'},
  settleAtomic:(c)=>{payCalls++;if(options.payThrow)throw Error('ambiguous');
   if(settlement)throw Error('already paid');
   settlement={status:'SETTLED',contractID:c.contractID,corporationID:c.corporationID,
    amountISK:c.amountISK,escrowKey:c.contractID,escrowConsumed:true,nativeDurable:true,credits:c.credits};}
 };
 const deps={root,clock:()=>12345678,authorizeOffer:c=>({status:'AUTHORIZED_NATIVE_ESCORT',
  ...c}),
  readManifest:()=>manifest,verifyManifest:()=>full,readIncidents:()=>incident,
  readOutcomes:()=>outcomes,readNativeDelivery:()=>delivery,nativeFunds};
 const engine=()=>createEscortContractSettlement(deps);
 return {root,deps,engine,manifest,full,incident,outcomes,delivery,nativeFunds,
  getBalance:()=>balance,getReserveCalls:()=>reserveCalls,getPayCalls:()=>payCalls,
  setReservation:r=>{reservation=r},setSettlement:r=>{settlement=r},
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function run(fn){const t=fixture();try{return fn(t)}finally{t.cleanup()}}
test('default OFF prevents offer and money movement',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_CONTRACTS='0';
 try{assert.equal(t.engine().create(offer).status,'DISABLED');assert.equal(t.getBalance(),50000)}
 finally{process.env.EVEJS_COOP_ESCORT_CONTRACTS='1'}
}));
test('funding reserves real adapter balance once and only once',()=>run(t=>{
 const e=t.engine();assert.equal(e.create(offer).status,'OFFERED');
 assert.equal(e.fund(offer.contractID).status,'FUNDED');
 assert.equal(t.getBalance(),30000);assert.equal(t.getReserveCalls(),1);
 assert.equal(e.fund(offer.contractID).status,'CONTRACT_FUNDING_NOT_REPLAYABLE');
 assert.equal(t.engine().read(offer.contractID).phase,'FUNDED');
}));
test('all exact native evidence settles two players in one atomic call',()=>run(t=>{
 const e=t.engine();e.create(offer);e.fund(offer.contractID);
 const r=e.settle(offer.contractID);
 assert.equal(r.status,'SETTLED');assert.deepEqual(r.credits,[
  {characterID:701,amountISK:10000},{characterID:702,amountISK:10000}]);
 assert.equal(t.getPayCalls(),1);
 assert.equal(t.engine().settle(offer.contractID).status,'CONTRACT_SETTLEMENT_NOT_REPLAYABLE');
}));
test('cannot issue a second contract for the same immutable trip',()=>run(t=>{
 const e=t.engine();e.create(offer);
 assert.equal(e.create({...offer,contractID:'escort-perimeter-002'}).status,
  'MANIFEST_ALREADY_CLAIMED_OR_STORAGE_UNAVAILABLE');
}));
test('funding uncertainty fences retries, even across restart',()=>run(t=>{
 t.nativeFunds.reserveAtomic=()=>{throw Error('native RPC timeout')};
 const e=t.engine();e.create(offer);
 assert.equal(e.fund(offer.contractID).status,'NATIVE_RESERVATION_UNCERTAIN_REPAIR_REQUIRED');
 assert.equal(t.engine().fund(offer.contractID).status,'ESCORT_WRITER_LOCKED_REPAIR_REQUIRED');
 assert.equal(t.engine().read(offer.contractID).phase,'FUNDING_PREPARED');
}));
test('settlement uncertainty never retries, even when game restarts',()=>run(t=>{
 const e=t.engine();e.create(offer);e.fund(offer.contractID);
 t.nativeFunds.settleAtomic=()=>{throw Error('unknown transfer outcome')};
 assert.equal(e.settle(offer.contractID).status,'NATIVE_PAYOUT_UNCERTAIN_REPAIR_REQUIRED');
 assert.equal(t.engine().read(offer.contractID).phase,'SETTLEMENT_PREPARED');
 assert.equal(t.engine().settle(offer.contractID).status,'ESCORT_WRITER_LOCKED_REPAIR_REQUIRED');
}));
test('partial warehouse manifest cannot pay',()=>run(t=>{
 const e=t.engine();e.create(offer);e.fund(offer.contractID);
 t.full.cargoIDs=[5501];
 assert.equal(e.settle(offer.contractID).status,'ESCORT_FULL_NATIVE_DELIVERY_UNVERIFIED');
 assert.equal(t.getPayCalls(),0);assert.equal(e.read(offer.contractID).phase,'FUNDED');
}));
test('physical arrival not verified cannot pay',()=>run(t=>{
 const e=t.engine();e.create(offer);e.fund(offer.contractID);
 t.delivery.status='EN_ROUTE';
 assert.equal(e.settle(offer.contractID).status,'ESCORT_PHYSICAL_ARRIVAL_UNVERIFIED');
 assert.equal(t.getPayCalls(),0);
}));
test('one participant or wrong authenticated duo cannot pay',()=>run(t=>{
 const e=t.engine();e.create(offer);e.fund(offer.contractID);
 t.incident.incidents[0].characters=[701];
 assert.equal(e.settle(offer.contractID).status,'ESCORT_DUO_NATIVE_COMBAT_UNVERIFIED');
 assert.equal(t.getPayCalls(),0);
}));
test('confirmed hauler wreck prevents paying even if cargo recorded',()=>run(t=>{
 const e=t.engine();e.create(offer);e.fund(offer.contractID);
 t.outcomes.outcomes[0].haulerNativeWreckID=888;
 assert.equal(e.settle(offer.contractID).status,'ESCORT_NATIVE_CUSTODY_UNVERIFIED');
 assert.equal(t.getPayCalls(),0);
}));
test('missing receipt for one exact original cargoID blocks payment',()=>run(t=>{
 const e=t.engine();e.create(offer);e.fund(offer.contractID);
 t.outcomes.outcomes[0].verifiedWarehouseStacks.pop();
 assert.equal(e.settle(offer.contractID).status,'ESCORT_NATIVE_CUSTODY_UNVERIFIED');
 assert.equal(t.getPayCalls(),0);
}));
test('corrupt journal cannot be interpreted as a valid funding state',()=>run(t=>{
 const e=t.engine();e.create(offer);
 fs.appendFileSync(path.join(t.root,'escort-contracts',offer.contractID+'.jsonl'),'{broken');
 assert.equal(t.engine().fund(offer.contractID).status,'CONTRACT_JOURNAL_CORRUPT');
 assert.equal(t.getReserveCalls(),0);
}));
test('missing atomic native wallet features refuses offer',()=>run(t=>{
 t.nativeFunds.capabilities=()=>({nativeDurable:true,atomicDualCredit:false,durableIdempotency:true});
 assert.equal(t.engine().create(offer).status,'ATOMIC_NATIVE_WALLET_PROVIDER_UNAVAILABLE');
 assert.equal(t.getReserveCalls(),0);
}));
process.on('exit',()=>{if(prior===undefined)delete process.env.EVEJS_COOP_ESCORT_CONTRACTS;
 else process.env.EVEJS_COOP_ESCORT_CONTRACTS=prior});
