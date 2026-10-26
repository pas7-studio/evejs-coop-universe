import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {HULL_CLASSES,hullForClass,income,credit,purchase,affordableClass}=
 require('../integration/coopFactionWarTreasury.cjs');

test('income counts only real holdings and evidenced kills',()=>{
 const result=income({heldSystemIDs:[30000142,30000142,30000144,0,-1,'x'],confirmedKills:2});
 assert.equal(result.systems,2);
 assert.equal(result.kills,2);
 assert.equal(result.sectorISK,500000);
 assert.equal(result.bountyISK,3000000);
 assert.equal(result.totalISK,3500000);
 assert.equal(result.paper,true);
});

test('credit never goes negative and stays labelled paper',()=>{
 const up=credit({balanceISK:1000,income:income({heldSystemIDs:[1]})});
 assert.equal(up.beforeISK,1000);
 assert.equal(up.afterISK,251000);
 const down=credit({balanceISK:-500,income:{totalISK:-100}});
 assert.equal(down.afterISK,0);
 assert.equal(down.paper,true);
});

test('a purchase is refused when the treasury cannot pay, and never fakes a market fill',()=>{
 const poor=purchase({balanceISK:1000,classID:'battleship'});
 assert.equal(poor.status,'REFUSED_UNFUNDED');
 assert.equal(poor.balanceISK,1000);
 const rich=purchase({balanceISK:500000000,classID:'battleship'});
 assert.equal(rich.status,'PURCHASED');
 assert.equal(rich.paper,true);
 assert.equal(rich.evidence,'PAPER_BUDGET_NO_MARKET_ORDER_NO_CARGO');
 assert.equal(rich.balanceISK,500000000-rich.costISK);
});

test('an unknown hull class is refused instead of guessed',()=>{
 assert.equal(purchase({balanceISK:1e12,classID:'titan'}).status,'REFUSED_UNKNOWN_CLASS');
 assert.equal(hullForClass('cruiser').priceISK,35000000);
});

test('promotion is bounded by what the treasury can actually equip',()=>{
 assert.equal(affordableClass({balanceISK:0}),null);
 assert.equal(affordableClass({balanceISK:10000000}),'frigate');
 assert.equal(affordableClass({balanceISK:40000000}),'cruiser');
 assert.equal(affordableClass({balanceISK:5000000000,preferredClassID:'battleship'}),'battleship');
 // A preferred class that is too expensive must not silently fall back upward.
 assert.equal(affordableClass({balanceISK:10000000,preferredClassID:'capital'}),null);
 assert.equal(HULL_CLASSES.length,6);
});
