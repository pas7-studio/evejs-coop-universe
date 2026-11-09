'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('./pf54-fixture.cjs');
const {createOriginalPlayerShipActivation,
 createOriginalCharacterRecordWriteBarrier}=
 require('../native/coopPersonalFleetOriginalNativePermit.cjs');
const C='characters',T='corporationRuntime',I='items',FOREIGN=90000002,LOCK='pf93-collateral-write';
const clone=x=>structuredClone(x);
function fixture(cb){
 const temp=F.tempDb(),f=F.open(temp.file);
 try{
  f.seed();
  if(f.get(C,String(F.OWNER))?.characterID!==F.OWNER)
   throw Error('PF93_NATIVE_OWNER_ROW_MISSING');
  return cb(f);
 }finally{f.close();temp.cleanup();}
}
function activate(f,verifyOriginalDockedPlayerSession){
 const api=createOriginalPlayerShipActivation({
  gameStore:f.gameStore,pf52:F.pf52,
  enabled:()=>true,allWritersFenced:()=>true,
  verifyOriginalDockedPlayerSession});
 return api.activate({characterID:F.OWNER,targetShipItemID:F.SHIP,
  stationID:F.STATION,expectedBefore:f.get(C,String(F.OWNER)),
  session:{characterID:F.OWNER,stationID:F.STATION}});
}
function write(f,lease,modify){
 const barrier=createOriginalCharacterRecordWriteBarrier({
  pf52:F.pf52,verifyOriginalSessionLease:lease});
 return f.gameStore.coopAtomicNativeRows.transact([T,I,C],tx=>{
  const before=tx.get(C,String(F.OWNER)),after=clone(before);
  modify(after);
  return barrier.inTransaction({tx,characterID:F.OWNER,
   expectedBefore:before,nextRecord:after,
   session:{characterID:F.OWNER,stationID:F.STATION}});
 });
}
test('PF93 stock switch accepts a pure read-only original session witness',()=>fixture(f=>{
 let checks=0;
 const res=activate(f,(_request,reader)=>{
  checks++;
  assert.equal(reader.put,undefined);
  assert.equal(reader.del,undefined);
  assert.equal(reader.get(I,String(F.SHIP)).itemID,F.SHIP);
  assert.ok(Array.isArray(reader.scan(C)));
  return true;
 });
 assert.equal(res.status,'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION');
 assert.equal(checks,2);
 assert.equal(f.get(C,String(F.OWNER)).shipID,F.SHIP);
}));
test('PF93 original player switch denies normal early false without changing rows',()=>fixture(f=>{
 const out=activate(f,()=>false);
 assert.equal(out.reason,'PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF93 original player switch rolls back collateral corporation put on failed first witness',()=>fixture(f=>{
 let txCapture;f.shared.onTx=tx=>{txCapture=tx;};
 const out=activate(f,()=>{
  txCapture.put(T,LOCK,{unexpected:true});
  return false;
 });
 assert.equal(out.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(f.get(T,LOCK),null);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF93 original player switch rolls back foreign character put on true first witness',()=>fixture(f=>{
 let txCapture;f.shared.onTx=tx=>{txCapture=tx;};
 const out=activate(f,()=>{
  txCapture.put(C,String(FOREIGN),{characterID:FOREIGN,shipID:F.SHIP});
  return true;
 });
 assert.equal(out.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(f.get(C,String(FOREIGN)),null);
}));
test('PF93 original player switch rolls back collateral corporation put on second witness',()=>fixture(f=>{
 let txCapture,n=0;f.shared.onTx=tx=>{txCapture=tx;};
 const out=activate(f,()=>{
  if(++n===2)txCapture.put(T,LOCK,{unexpected:true});
  return true;
 });
 assert.equal(out.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(n,2);
 assert.equal(f.get(T,LOCK),null);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF93 async original player session witness is not accepted',()=>fixture(f=>{
 const out=activate(f,()=>Promise.resolve(true));
 assert.equal(out.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF93 generic original character writer accepts unmodified source-bound witness',()=>fixture(f=>{
 let n=0;
 const out=write(f,()=>++n>0,next=>{next.shipID=F.SHIP;});
 assert.equal(out.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(n,2);
 assert.equal(f.get(C,String(F.OWNER)).shipID,F.SHIP);
}));
test('PF93 generic writer rolls back a foreign corporation row even when witness returns false',()=>fixture(f=>{
 let captured;f.shared.onTx=tx=>{captured=tx;};
 assert.throws(()=>write(f,()=>{
  captured.put(T,LOCK,{balance:90000});
  return false;
 },next=>{next.shipID=F.SHIP;}),/PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK/);
 assert.equal(f.get(T,LOCK),null);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF93 generic writer rolls back a foreign corporation row after a true second witness',()=>fixture(f=>{
 let captured,n=0;f.shared.onTx=tx=>{captured=tx;};
 assert.throws(()=>write(f,()=>{
  if(++n===2)captured.put(T,LOCK,{balance:90000});
  return true;
 },next=>{next.shipID=F.SHIP;}),/PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK/);
 assert.equal(n,2);
 assert.equal(f.get(T,LOCK),null);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF93 generic writer rolls back a foreign original character row written by closure',()=>fixture(f=>{
 let captured;f.shared.onTx=tx=>{captured=tx;};
 assert.throws(()=>write(f,()=>{
  captured.put(C,String(FOREIGN),{characterID:FOREIGN,shipID:F.SHIP});
  return false;
 },next=>{next.shipID=F.SHIP;}),/PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK/);
 assert.equal(f.get(C,String(FOREIGN)),null);
}));
test('PF93 generic writer rolls back a collateral original ItemStore row write',()=>fixture(f=>{
 let captured;f.shared.onTx=tx=>{captured=tx;};
 const before=f.scan(I);
 assert.throws(()=>write(f,()=>{
  captured.put(I,'some-other-original-item-row',{unexpected:1});
  return false;
 },next=>{next.shipID=F.SHIP;}),/PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK/);
 assert.equal(f.get(I,'some-other-original-item-row'),null);
 assert.deepEqual(f.scan(I),before);
}));
test('PF93 generic writer read-only witness gets no mutating tx capability',()=>fixture(f=>{
 const out=write(f,(_request,reader)=>{
  assert.equal(reader.put,undefined);
  assert.equal(reader.del,undefined);
  const row=reader.get(C,String(F.OWNER));row.balance=0;
  const rows=reader.scan(T);rows.push({key:'spoof',value:{}});
  return true;
 },next=>{next.shipID=F.SHIP;});
 assert.equal(out.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(f.get(C,String(F.OWNER)).balance,5000);
 assert.equal(f.get(T,'spoof'),null);
}));
test('PF93 generic writer denies session witnesses returning a thenable',()=>fixture(f=>{
 assert.throws(()=>write(f,()=>Promise.resolve(true),
  next=>{next.shipID=F.SHIP;}),/PF93_ASYNC_SESSION_WITNESS_FORBIDDEN/);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF93 generic original wallet update needs no scan or session witness',()=>fixture(f=>{
 let scans=0;
 f.shared.onTx=tx=>{const prior=tx.scan;tx.scan=(...a)=>{scans++;return prior(...a);};};
 const out=write(f,()=>{throw Error('WITNESS_MUST_NOT_RUN')},
  next=>{next.balance=5055;});
 assert.equal(out.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(out.protectedChange,false);
 assert.equal(scans,0);
}));

test('PF93 canonical row fingerprints do not depend on SQLite scan enumeration order',()=>fixture(f=>{
 f.put(C,String(FOREIGN),{characterID:FOREIGN,shipID:70000007});
 f.put(T,'pf93\u001fother-key',{count:12});
 let reversed=false;
 f.shared.onTx=tx=>{
  const scan=tx.scan;
  tx.scan=table=>{
   const rows=scan(table);
   reversed=!reversed;
   return reversed?rows.slice().reverse():rows;
  };
 };
 const out=activate(f,()=>true);
 assert.equal(out.status,'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION');
 assert.equal(f.get(C,String(F.OWNER)).shipID,F.SHIP);
}));
test('PF93 no transaction-scoped SQLite scan authority fails closed',()=>fixture(f=>{
 f.shared.onTx=tx=>{tx.scan=undefined;};
 const out=activate(f,()=>true);
 assert.equal(out.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
 assert.throws(()=>write(f,()=>true,next=>{next.shipID=F.SHIP;}),
  /PF93_ORIGINAL_ROWSET_SCAN_REQUIRED/);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
