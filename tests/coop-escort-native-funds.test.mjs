import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url);
const {createEscortNativeFunds,ESCROW_KEY}=require('../integration/coopEscortNativeFunds.cjs');
const originalA=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
const originalB=process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET;
process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS='1';
process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET='1';
const c={contractID:'escort-test-01',manifestKey:'30000144-11-1234',corporationID:10001,
  amountISK:20000,characters:[701,702]};
const corp={wallet:{divisions:{'1000':{key:1000,balance:50000,journal:[],transactions:[]}}}};
const char=id=>({characterID:id,balance:500,balanceChange:0,walletJournal:[]});
function sandbox(){
 const root=mkdtempSync(path.join(os.tmpdir(),'evejs-escort-wallet-'));
 const filename=path.join(root,'game.sqlite');
 const db=new DatabaseSync(filename);
 db.exec('CREATE TABLE "corporationRuntime" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 db.exec('CREATE TABLE "characters" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const insert=(table,key,val)=>db.prepare('INSERT INTO "'+table+'"(key,json) VALUES(?,?)').run(key,JSON.stringify(val));
 insert('corporationRuntime','corporations\u001f10001',corp);insert('characters','701',char(701));insert('characters','702',char(702));
 let txCalls=0,fault=null,failureProof=false,corruptFailure=false;
 const txProvider={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,
  transact(tables,fn){txCalls++;
   assert.deepEqual([...tables].sort(),['characters','corporationRuntime']);
   db.exec('BEGIN IMMEDIATE');
   try{const tx={
    get(t,k){const r=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(k);return r?JSON.parse(r.json):null},
    put(t,k,value){db.prepare('INSERT INTO "'+t+'"(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(value));if(fault===k)throw Error('INJECTED_WRITE_FAILURE')}
   };const x=fn(tx);db.exec('COMMIT');return x;
   }catch(e){db.exec('ROLLBACK');throw e}
  }};
 const engine=createEscortNativeFunds({atomicRows:txProvider,isNpcCorporation:id=>id===10001,
  clock:()=>1234567,verifyNativeFailure:v=>failureProof?{
   status:"DURABLE_NATIVE_CONVOY_TERMINAL_FAILURE",
   contractID:v.contractID,manifestKey:corruptFailure?"wrong":v.manifestKey,
   corporationID:v.corporationID,reason:"NATIVE_HAULER_WRECK",
   failureWitnessID:9001,nativeDurable:true,deliveryImpossible:true,
   noPriorPayout:true}:null});
 const get=(t,k)=>JSON.parse(db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(k).json);
 return {db,filename,root,engine,get,txCalls:()=>txCalls,failAt:k=>fault=k,
  setFailureProof:()=>failureProof=true,setCorruptFailure:()=>corruptFailure=true,
  close:()=>{db.close();rmSync(root,{recursive:true,force:true})}};
}
function run(fn){const t=sandbox();try{fn(t)}finally{t.close()}}
const pay={contractID:c.contractID,corporationID:c.corporationID,amountISK:c.amountISK,
 credits:[{characterID:701,amountISK:10000},{characterID:702,amountISK:10000}]};
test('native escrow and both wallets conserve the exact original ISK',()=>run(t=>{
 assert.deepEqual(t.engine.capabilities(),{nativeDurable:true,atomicDualCredit:true,durableIdempotency:true});
 assert.equal(t.engine.verifyReservation(c).status,'NOT_FOUND');
 assert.equal(t.engine.reserveAtomic(c).status,'RESERVED');
 assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,30000);
 assert.equal(t.get('characters','701').balance,500);
 assert.equal(t.engine.verifyReservation(c).status,'RESERVED');
 assert.equal(t.engine.settleAtomic(pay).status,'SETTLED');
 assert.equal(t.get('characters','701').balance,10500);
 assert.equal(t.get('characters','702').balance,10500);
 assert.equal(t.engine.verifySettlement(c).status,'SETTLED');
 assert.equal(t.get('corporationRuntime',ESCROW_KEY).byContract[c.contractID].status,'SETTLED');
 assert.equal(30000+10500+10500,50000+500+500);
}));
test('retry contract reservation cannot double-debit',()=>run(t=>{
 t.engine.reserveAtomic(c);
 assert.throws(()=>t.engine.reserveAtomic(c),/CONTRACT_ALREADY_RESERVED/);
 assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,30000);
}));
test('same immutable manifest cannot secure another contract',()=>run(t=>{
 t.engine.reserveAtomic(c);
 assert.throws(()=>t.engine.reserveAtomic({...c,contractID:'escort-test-02'}),/MANIFEST_ALREADY_FUNDED/);
}));
test('double native payout refused and first payout persists',()=>run(t=>{
 t.engine.reserveAtomic(c);t.engine.settleAtomic(pay);
 assert.throws(()=>t.engine.settleAtomic(pay),/RESERVATION_NOT_PAYABLE/);
 assert.equal(t.get('characters','701').balance,10500);
}));
test('failed second wallet write rolls back first character credit and escrow',()=>run(t=>{
 t.engine.reserveAtomic(c);t.failAt('702');
 assert.throws(()=>t.engine.settleAtomic(pay),/INJECTED_WRITE_FAILURE/);
 assert.equal(t.get('characters','701').balance,500);
 assert.equal(t.get('characters','702').balance,500);
 assert.equal(t.engine.verifyReservation(c).status,'RESERVED');
}));
test('failed escrow write rolls back corporate debit',()=>run(t=>{
 t.failAt(ESCROW_KEY);
 assert.throws(()=>t.engine.reserveAtomic(c),/INJECTED_WRITE_FAILURE/);
 assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,50000);
 assert.equal(t.engine.verifyReservation(c).status,'NOT_FOUND');
}));
test('funding refuses insufficient native NPC funds',()=>run(t=>{
 assert.throws(()=>t.engine.reserveAtomic({...c,amountISK:100000}),/INSUFFICIENT_CORPORATION_FUNDS/);
 assert.equal(t.engine.verifyReservation(c).status,'NOT_FOUND');
}));
test('funding refuses non-native or absent recipients',()=>run(t=>{
 assert.throws(()=>t.engine.reserveAtomic({...c,corporationID:999}),/CONTRACT_INVALID/);
 assert.throws(()=>t.engine.reserveAtomic({...c,characters:[701,909]}),/CHARACTER_WALLET_UNAVAILABLE/);
 assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,50000);
}));
test('mismatched amount and recipients cannot steal reserved escrow',()=>run(t=>{
 t.engine.reserveAtomic(c);
 assert.throws(()=>t.engine.settleAtomic({...pay,amountISK:18000,credits:[{characterID:701,amountISK:9000},{characterID:702,amountISK:9000}]}),/RESERVATION_NOT_PAYABLE/);
 assert.throws(()=>t.engine.settleAtomic({...pay,credits:[{characterID:701,amountISK:10000},{characterID:703,amountISK:10000}]}),/RESERVATION_NOT_PAYABLE/);
}));
test('invalid corrupt escrow fails closed instead of resetting it',()=>run(t=>{
 t.engine.reserveAtomic(c);
 t.db.prepare('UPDATE "corporationRuntime" SET json=? WHERE key=?').run('{"version":0}',ESCROW_KEY);
 assert.throws(()=>t.engine.verifyReservation(c),/ESCROW_LEDGER_INVALID/);
 assert.throws(()=>t.engine.reserveAtomic({...c,contractID:'escort-test-03'}),/ESCROW_LEDGER_INVALID/);
}));
test('flags remain OFF without any native wallet writes',()=>run(t=>{
 process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET='0';
 try{assert.equal(t.engine.capabilities().nativeDurable,false);
  assert.throws(()=>t.engine.reserveAtomic(c),/ATOMIC_WALLET_DISABLED/);
  assert.equal(t.txCalls(),0)}finally{process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET='1'}
}));
test('committed escrow and both native recipients survive reopening SQLite',()=>run(t=>{
 t.engine.reserveAtomic(c);t.engine.settleAtomic(pay);
 const another=new DatabaseSync(t.filename);
 assert.equal(JSON.parse(another.prepare('SELECT json FROM "characters" WHERE key=?').get('701').json).balance,10500);
 assert.equal(JSON.parse(another.prepare('SELECT json FROM "corporationRuntime" WHERE key=?').get(ESCROW_KEY).json).byContract[c.contractID].status,'SETTLED');
 another.close();
}));

test('proof-backed refund restores exactly the corporate debit without crediting pilots',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.setFailureProof();
  assert.equal(t.engine.refundAtomic(c).status,'REFUNDED');
  assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,50000);
  assert.equal(t.get('characters','701').balance,500);
  assert.equal(t.get('characters','702').balance,500);
  assert.equal(t.engine.verifyRefund(c).status,'REFUNDED');
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('refund cannot run twice after a valid durable native failure',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.setFailureProof();t.engine.refundAtomic(c);
  assert.throws(()=>t.engine.refundAtomic(c),/REFUND_NOT_ALLOWED/);
  assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,50000);
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('refunded escrow cannot ever be paid to characters afterward',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.setFailureProof();t.engine.refundAtomic(c);
  assert.throws(()=>t.engine.settleAtomic(pay),/RESERVATION_NOT_PAYABLE/);
  assert.equal(t.get('characters','701').balance,500);
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('settled escrow can never be refunded even with a claimed terminal failure',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.engine.settleAtomic(pay);t.setFailureProof();
  assert.throws(()=>t.engine.refundAtomic(c),/REFUND_NOT_ALLOWED/);
  assert.equal(t.get('characters','701').balance,10500);
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('a timeout without durable loss witness cannot refund a native escrow',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);
  assert.throws(()=>t.engine.refundAtomic(c),/NATIVE_FAILURE_NOT_VERIFIED/);
  assert.equal(t.engine.verifyReservation(c).status,'RESERVED');
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('refunding needs exact trusted manifest identity in failure witness',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.setFailureProof();t.setCorruptFailure();
  assert.throws(()=>t.engine.refundAtomic(c),/NATIVE_FAILURE_NOT_VERIFIED/);
  assert.equal(t.engine.verifyReservation(c).status,'RESERVED');
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('refund remains feature disabled by default even if failure witness exists',()=>run(t=>{
 t.engine.reserveAtomic(c);t.setFailureProof();
 delete process.env.EVEJS_COOP_ESCORT_REFUNDS;
 assert.throws(()=>t.engine.refundAtomic(c),/REFUNDS_DISABLED/);
 assert.equal(t.engine.verifyReservation(c).status,'RESERVED');
}));
test('SQLite fault at escrow receipt rolls back native refund corporate credit',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.setFailureProof();t.failAt(ESCROW_KEY);
  assert.throws(()=>t.engine.refundAtomic(c),/INJECTED_WRITE_FAILURE/);
  assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,30000);
  assert.equal(t.engine.verifyReservation(c).status,'RESERVED');
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('wrong requested contract identity cannot refund other escrow',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.setFailureProof();
  assert.throws(()=>t.engine.refundAtomic({...c,amountISK:18000}),/REFUND_NOT_ALLOWED/);
  assert.equal(t.get('corporationRuntime','corporations\u001f10001').wallet.divisions['1000'].balance,30000);
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
test('native escrow remains a single-manifest claim even after refund',()=>run(t=>{
 process.env.EVEJS_COOP_ESCORT_REFUNDS='1';
 try{t.engine.reserveAtomic(c);t.setFailureProof();t.engine.refundAtomic(c);
  assert.throws(()=>t.engine.reserveAtomic({...c,contractID:'escort-test-02'}),/MANIFEST_ALREADY_FUNDED/);
 }finally{delete process.env.EVEJS_COOP_ESCORT_REFUNDS}
}));
process.on('exit',()=>{
 if(originalA===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=originalA;
 if(originalB===undefined)delete process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET;else process.env.EVEJS_COOP_NATIVE_ESCORT_WALLET=originalB;
});
