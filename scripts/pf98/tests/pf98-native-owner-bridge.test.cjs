'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../../pf58/tests/pf54-fixture.cjs');
const {createOriginalPlayerShipActivation,createOriginalCharacterRecordWriteBarrier}=
 require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs');
const C='characters',I='items',T='corporationRuntime';
const clone=x=>structuredClone(x);
function fixture(callback){
 const old=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const tmp=F.tempDb(),f=F.open(tmp.file);
 try{
  f.seed();
  const root=f.get(C,C),row=root?.[String(F.OWNER)];
  if(!row)throw Error('PF98_LEGACY_SEED_MISSING');
  f.db.prepare('DELETE FROM "characters" WHERE key=?').run(C);
  f.put(C,String(F.OWNER),row);
  process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
  callback(f);
 }finally{
  if(old===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=old;
  f.close();tmp.cleanup();
 }
}
function activate(f,verify=()=>true){
 const owner=createOriginalPlayerShipActivation({
  gameStore:f.gameStore,pf52:F.pf52,enabled:()=>true,
  allWritersFenced:()=>true,verifyOriginalDockedPlayerSession:verify
 });
 return owner.activate({
  characterID:F.OWNER,targetShipItemID:F.SHIP,stationID:F.STATION,
  expectedBefore:clone(f.get(C,String(F.OWNER))),
  session:{characterID:F.OWNER,stationID:F.STATION}
 });
}
function update(f,callback,verify=()=>true){
 const owner=createOriginalCharacterRecordWriteBarrier({
  pf52:F.pf52,verifyOriginalSessionLease:verify
 });
 return f.gameStore.coopAtomicNativeRows.transact([T,I,C],tx=>{
  const before=tx.get(C,String(F.OWNER)),next=clone(before);
  callback(next,tx);
  return owner.inTransaction({tx,characterID:F.OWNER,expectedBefore:before,
   nextRecord:next,session:{characterID:F.OWNER,stationID:F.STATION}});
 });
}
function installTestOwner(f,{after=null}={}){
 const stats={calls:0,requestIDs:[],triedWrite:0};
 f.shared.onTx=tx=>{
  const rawPut=tx.put.bind(tx);
  let witnessing=false,poison=false,denied=false;
  tx.put=(...args)=>{
   if(witnessing){stats.triedWrite++;poison=true;
    throw Error('PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK');}
   if(poison||denied){poison=true;throw Error('PF96_ORIGINAL_SESSION_WITNESS_DENIED_WRITE');}
   return rawPut(...args);
  };
  tx.verifyReadOnlySessionWitness=(check,request)=>{
   stats.calls++;
   stats.requestIDs.push(request?.characterID);
   if(poison)throw Error('PF96_ORIGINAL_SESSION_WITNESS_TRANSACTION_POISONED');
   if(typeof check!=='function')throw Error('PF95_ORIGINAL_SESSION_WITNESS_REQUIRED');
   let result;
   witnessing=true;
   const reader=Object.freeze({get:(t,k)=>clone(tx.get(t,k)),scan:t=>clone(tx.scan(t))});
   try{result=check(request,reader);
    if(result&&typeof result.then==='function')
     throw Error('PF95_ASYNC_ORIGINAL_SESSION_WITNESS_FORBIDDEN');
   }finally{witnessing=false;}
   if(after)after({tx,request,result,stats});
   if(result!==true)denied=true;
   return result===true;
  };
 };
 return stats;
}
test('PF98 PF91 native activation has no owner hook: cannot certify session or write title',()=>fixture(f=>{
 let called=0;
 const result=activate(f,()=>{called++;return true});
 assert.equal(result.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(called,0);assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF98 PF92 protected title without source owner hook throws for SQLite rollback',()=>fixture(f=>{
 let called=0;
 assert.throws(()=>update(f,n=>{n.shipID=F.SHIP;n.shipTypeID=606;},()=>{
  called++;return true;
 }),/PF92_CHARACTER_TRANSACTION_ABORT:PF98_ORIGINAL_SQLITE_OWNER_SESSION_WITNESS_REQUIRED/);
 assert.equal(called,0);assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF98 PF91 calls source owner twice before writing original active title',()=>fixture(f=>{
 const stat=installTestOwner(f);let checks=0;
 const result=activate(f,(req,reader)=>{
  checks++;assert.equal(reader.put,undefined);assert.equal(reader.del,undefined);
  assert.equal(req.characterID,F.OWNER);return true;
 });
 assert.equal(result.status,'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION');
 assert.equal(checks,2);assert.equal(stat.calls,2);
 assert.deepEqual(stat.requestIDs,[F.OWNER,F.OWNER]);
 assert.equal(f.get(C,String(F.OWNER)).shipID,F.SHIP);
}));
test('PF98 PF92 calls source owner twice before updating one original title row',()=>fixture(f=>{
 const stat=installTestOwner(f);const before=clone(f.get(I,'items'));
 const result=update(f,n=>{n.shipID=F.SHIP;n.shipTypeID=606;},(_req,reader)=>{
  assert.equal(reader.put,undefined);return true;
 });
 assert.equal(result.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(result.protectedChange,true);assert.equal(stat.calls,2);
 assert.equal(f.get(C,String(F.OWNER)).shipID,F.SHIP);
 assert.deepEqual(f.get(I,'items'),before);
}));
test('PF98 PF91 source-owner false verdict blocks original player activation',()=>fixture(f=>{
 const stat=installTestOwner(f);
 const result=activate(f,()=>false);
 assert.equal(result.reason,'PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
 assert.equal(stat.calls,1);assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF98 PF92 source-owner false verdict blocks original character title',()=>fixture(f=>{
 const stat=installTestOwner(f);
 const result=update(f,n=>{n.shipID=F.SHIP;n.shipTypeID=606;},()=>false);
 assert.equal(result.reason,'PF92_CHARACTER_SESSION_LEASE_REQUIRED');
 assert.equal(stat.calls,1);assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF98 PF91 late source-owner revocation blocks title without partial write',()=>fixture(f=>{
 const stat=installTestOwner(f);let n=0;
 const result=activate(f,()=>++n===1);
 assert.equal(result.reason,'PF91_ORIGINAL_PLAYER_SESSION_REVOKED');
 assert.equal(stat.calls,2);assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF98 PF92 late source-owner revocation blocks writer before original row put',()=>fixture(f=>{
 const stat=installTestOwner(f);let n=0;
 const result=update(f,next=>{next.shipID=F.SHIP;next.shipTypeID=606;},()=>++n===1);
 assert.equal(result.reason,'PF92_CHARACTER_SESSION_LEASE_REVOKED');
 assert.equal(stat.calls,2);assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF98 PF91 forbidden callback write cannot be laundered by returning true',()=>fixture(f=>{
 const stat=installTestOwner(f);let captured;
 const result=activate(f,()=>{
  assert.ok(captured);
  try{captured.put(T,'some-collateral',{x:1});}catch{}
  return true;
 });
 assert.equal(result.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(f.get(T,'some-collateral'),null);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
 assert.ok(stat.triedWrite>0);
}));
test('PF98 native generic wallet update needs no source session witness',()=>fixture(f=>{
 const result=update(f,n=>{n.balance+=10;},()=>{throw Error('UNREACHABLE_SESSION_WITNESS')});
 assert.equal(result.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(result.protectedChange,false);assert.equal(f.get(C,String(F.OWNER)).balance,5010);
}));
test('PF98 native PF91 async witness result never authenticates player session',()=>fixture(f=>{
 const stat=installTestOwner(f);
 const result=activate(f,()=>Promise.resolve(true));
 assert.equal(result.reason,'PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');
 assert.equal(stat.calls,1);assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
test('PF98 native PF92 thrown witness error forces original SQLite rollback',()=>fixture(f=>{
 installTestOwner(f);
 assert.throws(()=>update(f,n=>{n.shipID=F.SHIP;n.shipTypeID=606;},()=>{throw Error('SESSION_REVOKED')}),/SESSION_REVOKED/);
 assert.equal(f.get(C,String(F.OWNER)).shipID,undefined);
}));
