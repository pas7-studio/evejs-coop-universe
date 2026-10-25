import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {KINDS,buildNotice,negotiate}=require('../integration/coopCourierNotices.cjs');

const contract={contractID:980000000,volume:29500,reward:30000,collateral:300000,startStationID:60015260,endStationID:60015262};
const ctx={contractID:980000000,volumeM3:29500,reward:30000,collateral:300000,
 fromStationName:'Jita IV-4',toStationName:'Jita IV-62',pilotName:'Haul Jita Charon'};

test('every notice kind produces a subject and a body naming the contract',()=>{
 for(const kind of KINDS){
  const notice=buildNotice(kind,{...ctx,quoteIsk:1203000});
  assert.equal(notice.status,'NOTICE',kind);
  assert.match(notice.subject,new RegExp(String(ctx.contractID)));
  assert.ok(notice.body.length>40,kind);
  assert.match(notice.body,/Haul Jita Charon/);
 }
 assert.equal(buildNotice('nonsense',ctx).status,'NO_NOTICE');
});

test('the accepted and departing notices say what the player needs to know',()=>{
 const accepted=buildNotice('accepted',ctx).body;
 assert.match(accepted,/accepted your contract 980000000/);
 assert.match(accepted,/29,500 m3/);
 assert.match(accepted,/Jita IV-4/);
 const departing=buildNotice('departing',ctx).body;
 assert.match(departing,/Undocked from Jita IV-4/);
 assert.match(departing,/warping to Jita IV-62/);
});

test('a lost cargo notice returns the collateral instead of begging',()=>{
 const body=buildNotice('failed',ctx).body;
 assert.match(body,/collateral of 300,000 ISK is yours again/);
 assert.match(body,/not asking for the 30,000 ISK/);
});

test('an underpriced contract gets a concrete counter-offer, not silence',()=>{
 const result=negotiate(contract,{totalIsk:1203000,pilotName:'Haul Jita Charon'});
 assert.equal(result.status,'COUNTER_OFFER');
 assert.equal(result.shortfallIsk,1173000);
 assert.equal(result.notice.counterOfferIsk,1203000);
 assert.match(result.notice.body,/I can do it for 1,203,000 ISK/);
});

test('a fair price is accepted without haggling',()=>{
 assert.equal(negotiate({...contract,reward:1203000},{totalIsk:1203000}).status,'ACCEPTABLE');
 assert.equal(negotiate(contract,{}).status,'NO_NEGOTIATION');
});
