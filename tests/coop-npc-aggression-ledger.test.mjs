import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createAggressionLedger,getSharedLedger,DEFAULT_WINDOW_MS}=require('../integration/coopNpcAggressionLedger.cjs');

const attack={systemID:30000142,victimEntityID:140000100,attackerShipID:900000001,
 characterID:2110000001,atMs:1000};

test('a verified attack is remembered per victim inside its window',()=>{
 const ledger=createAggressionLedger();
 assert.equal(ledger.note(attack).status,'RECORDED');
 const hit=ledger.lastFor({systemID:30000142,victimEntityID:140000100,nowMs:1500});
 assert.equal(hit.attackerShipID,900000001);
 assert.equal(hit.characterID,2110000001);
 assert.equal(ledger.lastFor({systemID:30000142,victimEntityID:140000100,nowMs:1000+DEFAULT_WINDOW_MS+1}),null);
 // another victim, another system: never mixed up
 assert.equal(ledger.lastFor({systemID:30000142,victimEntityID:140000101,nowMs:1500}),null);
 assert.equal(ledger.lastFor({systemID:30000144,victimEntityID:140000100,nowMs:1500}),null);
});

test('a record from the future is not usable',()=>{
 const ledger=createAggressionLedger();
 ledger.note(attack);
 assert.equal(ledger.lastFor({systemID:30000142,victimEntityID:140000100,nowMs:999}),null);
 assert.equal(ledger.lastFor({systemID:30000142,victimEntityID:140000100,nowMs:1000}).atMs,1000);
});

test('an incomplete or impossible aggression is refused, never stored',()=>{
 const ledger=createAggressionLedger();
 assert.equal(ledger.note({}).status,'REFUSED');
 assert.equal(ledger.note({...attack,attackerShipID:0}).status,'REFUSED');
 assert.equal(ledger.note({...attack,characterID:0}).status,'REFUSED');
 assert.equal(ledger.note({...attack,victimEntityID:900000001}).status,'REFUSED'); // ship cannot attack itself
 assert.equal(ledger.note({...attack,atMs:-5}).status,'REFUSED');
 assert.equal(ledger.size(),0);
});

test('the newest attack for a victim wins',()=>{
 const ledger=createAggressionLedger();
 ledger.note(attack);
 ledger.note({...attack,attackerShipID:900000002,characterID:2110000002,atMs:2000});
 const hit=ledger.lastFor({systemID:30000142,victimEntityID:140000100,nowMs:2500});
 assert.equal(hit.attackerShipID,900000002);
 assert.equal(ledger.size(),1);
});

test('a busy world cannot grow the ledger without bound',()=>{
 const ledger=createAggressionLedger({maxEntries:10});
 for(let i=0;i<25;i++)ledger.note({...attack,victimEntityID:140000200+i,atMs:1000+i});
 assert.equal(ledger.size()<=10,true);
 // the newest records survive
 assert.equal(ledger.lastFor({systemID:30000142,victimEntityID:140000224,nowMs:1024})!==null,true);
});

test('the shared ledger is one stable instance',()=>{
 assert.equal(getSharedLedger(),getSharedLedger());
 assert.throws(()=>createAggressionLedger({windowMs:10}),/AGGRESSION_WINDOW_INVALID/);
 assert.throws(()=>createAggressionLedger({maxEntries:0}),/AGGRESSION_CAP_INVALID/);
});
