import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createSellPricing,validConfig}=require('../integration/coopNpcSellPricing.cjs');

function bench(options={}){
 let time=1_000_000;
 const pricing=createSellPricing({clock:()=>time,...options});
 return {pricing,advance:ms=>{time+=ms;},at:()=>time};
}

test('a fresh haul asks for the full market price',()=>{
 const {pricing}=bench();
 pricing.offer('60014935:17464',5203.7);
 const decision=pricing.decide({key:'60014935:17464',bestBid:5203.7});
 assert.equal(decision.action,'SELL');
 assert.equal(decision.pct,1);
 assert.equal(decision.price,5203.7);
});

test('nobody buying steps the price down a little every interval',()=>{
 const b=bench({intervalMs:120000,stepPct:0.05,minPct:0.55});
 b.pricing.offer('s:1230',1000);
 assert.equal(b.pricing.floor('s:1230').price,1000);
 b.advance(120000);
 assert.equal(b.pricing.floor('s:1230').price,950);
 b.advance(120000);
 assert.equal(b.pricing.floor('s:1230').price,900);
 b.advance(600000);
 assert.equal(b.pricing.floor('s:1230').price,650);
});

test('the floor never goes below the configured minimum',()=>{
 const b=bench({intervalMs:60000,stepPct:0.1,minPct:0.55});
 b.pricing.offer('s:1230',1000);
 b.advance(60*1000*50);
 assert.equal(b.pricing.floor('s:1230').pct,0.55);
 assert.equal(b.pricing.floor('s:1230').price,550);
});

test('an unsold stack is held, not dumped below the floor',()=>{
 const b=bench({intervalMs:60000,stepPct:0.1,minPct:0.55});
 b.pricing.offer('s:1230',1000);
 b.advance(60000*6);
 const decision=b.pricing.decide({key:'s:1230',bestBid:540});
 assert.equal(decision.action,'HOLD_FLOOR');
 assert.equal(decision.reason,'BID_BELOW_FLOOR');
 assert.equal(decision.price,550);
});

test('a rival bid at the current floor is accepted',()=>{
 const b=bench({intervalMs:60000,stepPct:0.1,minPct:0.55});
 b.pricing.offer('s:1230',1000);
 b.advance(60000*4);
 const decision=b.pricing.decide({key:'s:1230',bestBid:600});
 assert.equal(decision.action,'SELL');
 assert.equal(decision.bestBid,600);
});

test('no buyer at any price is an honest hold',()=>{
 const {pricing}=bench();
 pricing.offer('s:1230',1000);
 const decision=pricing.decide({key:'s:1230',bestBid:0});
 assert.equal(decision.action,'HOLD_FLOOR');
 assert.equal(decision.reason,'NO_BUYER_AT_ANY_PRICE');
});

test('a sale resets the asking price for the next haul',()=>{
 const b=bench({intervalMs:60000,stepPct:0.1,minPct:0.55});
 b.pricing.offer('s:1230',1000);
 b.advance(60000*4);
 assert.equal(b.pricing.floor('s:1230').price,600);
 b.pricing.noteSold('s:1230');
 assert.equal(b.pricing.floor('s:1230').price,1000);
 assert.equal(b.pricing.snapshot()['s:1230'].sold,1);
});

test('a better bid raises the anchor but never lowers it',()=>{
 const {pricing}=bench();
 pricing.offer('s:1230',1000);
 pricing.offer('s:1230',1200);
 assert.equal(pricing.floor('s:1230').price,1200);
 pricing.offer('s:1230',900);
 assert.equal(pricing.floor('s:1230').price,1200);
});

test('unknown stacks and nonsense prices are ignored',()=>{
 const {pricing}=bench();
 assert.equal(pricing.offer('s:1230',0),null);
 assert.equal(pricing.offer('',1000),null);
 assert.equal(pricing.decide({key:'s:absent',bestBid:10}).action,'NO_REFERENCE');
 assert.equal(pricing.noteSold('s:absent'),false);
 assert.equal(pricing.floor('s:absent'),null);
});

test('bad configuration is rejected instead of quietly mispricing stock',()=>{
 assert.equal(validConfig({intervalMs:60000,stepPct:0.05,minPct:0.5}),true);
 assert.equal(validConfig({intervalMs:10,stepPct:0.05,minPct:0.5}),false);
 assert.equal(validConfig({intervalMs:60000,stepPct:0,minPct:0.5}),false);
 assert.equal(validConfig({intervalMs:60000,stepPct:0.05,minPct:1.2}),false);
 assert.throws(()=>createSellPricing({intervalMs:10}),/INVALID_SELL_PRICING_CONFIG/);
});
