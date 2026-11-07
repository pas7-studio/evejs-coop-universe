'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const F=require('../../pf58/tests/pf54-fixture.cjs');
const permit=require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs');
const C='characters',I='items',T='corporationRuntime',OTHER_SHIP=2002;
function source(name,requirePath){
 const mod={exports:{}};
 const p=path.resolve(__dirname,'../native/'+name);
 new Function('require','module','exports','process')(requirePath,mod,mod.exports,process,
  );
 return mod.exports;
}
function compile(name,requirePath){
 const mod={exports:{}},text=fs.readFileSync(path.resolve(__dirname,'../native/'+name),'utf8');
 new Function('require','module','exports','process',text)(requirePath,mod,mod.exports,process);
 return mod.exports;
}
function fixture(t,callback,{reserve=false}={}){
 const oldFlag=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 const tmp=F.tempDb(),f=F.open(tmp.file);
 try{
  f.seed();if(reserve)f.onboard();
  const original=f.get(C,C)?.[String(F.OWNER)];
  assert.ok(original,'PF99_ORIGINAL_CHARACTER_SEED_REQUIRED');
  f.db.prepare('DELETE FROM "characters" WHERE key=?').run(C);
  f.put(C,String(F.OWNER),{...original,characterID:F.OWNER,accountId:55,
   shipID:OTHER_SHIP,shipTypeID:606,shipName:'Old Hull',
   stationID:F.STATION,structureID:null});
  const items=f.get(I,I),old=items[String(F.SHIP)];
  items[String(F.SHIP)]={...old,itemName:'New Hull'};
  items[String(OTHER_SHIP)]={...old,itemID:OTHER_SHIP,shipID:OTHER_SHIP,
   itemName:'Old Hull',flagID:4,locationID:F.STATION};
  f.put(I,I,items);
  const sessions=new Set(),session={
   userid:55,characterID:F.OWNER,charid:F.OWNER,
   stationid:F.STATION,stationID:F.STATION,structureid:null,structureID:null,
   shipID:OTHER_SHIP,shipid:OTHER_SHIP,activeShipID:OTHER_SHIP,
   socket:{destroyed:false},clientID:1234
  };
  sessions.add(session);
  const registry={
   getSessions:()=>[...sessions].filter(s=>s.socket&&!s.socket.destroyed),
   findSessionByCharacterID:cid=>[...sessions].find(s=>s.characterID===cid&&
    s.socket&&!s.socket.destroyed)||null
  };
  const station=s=>Number(s?.stationid??s?.stationID??s?.stationId??0)||0;
  const structure=s=>Number(s?.structureid??s?.structureID??s?.structureId??0)||0;
  const docking={getSessionStationID:station,getSessionStructureID:structure,
   getDockedLocationID:s=>structure(s)||station(s)};
  const identity=compile('coopPersonalFleetOriginalSessionWitness.js',p=>{
   if(p==='../services/chat/sessionRegistry')return registry;
   if(p==='../services/structure/structureLocation')return docking;
   throw Error('PF99_IDENTITY_IMPORT_UNKNOWN:'+p);
  });
  const bindings=compile('coopPersonalFleetOriginalSessionBindings.js',p=>{
   if(p==='./coopPersonalFleetOriginalNativePermit.cjs')return permit;
   if(p==='./coopPersonalFleetOriginalSessionWitness.js')return identity;
   throw Error('PF99_BINDING_IMPORT_UNKNOWN:'+p);
  });
  const stats={witness:0};
  f.shared.onTx=tx=>{
   tx.verifyReadOnlySessionWitness=(cb,request)=>{
    stats.witness++;
    const readOnly=Object.freeze({
     get:(table,key)=>structuredClone(tx.get(table,key)),
     scan:table=>structuredClone(tx.scan(table))
    });
    return cb(request,readOnly)===true;
   };
  };
  const player=bindings.createSourceBoundPlayerShipActivation({
   gameStore:f.gameStore,pf52:F.pf52,enabled:()=>true,allWritersFenced:()=>true,
   // A malicious caller-supplied callback is deliberately IGNORED.
   verifyOriginalDockedPlayerSession:()=>true
  });
  const charBarrier=bindings.createSourceBoundCharacterRecordWriteBarrier({
   pf52:F.pf52,verifyOriginalSessionLease:()=>true
  });
  const activate=(incoming=session)=>{
   const old=f.get(C,String(F.OWNER));
   return player.activate({characterID:F.OWNER,targetShipItemID:F.SHIP,
    stationID:F.STATION,expectedBefore:structuredClone(old),session:incoming});
  };
  const write=(change, incoming=session)=>f.gameStore.coopAtomicNativeRows.transact(
   [T,I,C],tx=>{
    const before=tx.get(C,String(F.OWNER)),next=structuredClone(before);
    change(next);
    return charBarrier.inTransaction({tx,characterID:F.OWNER,
     expectedBefore:before,nextRecord:next,session:incoming});
   }
  );
  callback({f,sessions,session,registry,identity,bindings,player,
   charBarrier,activate,write,stats});
 }finally{
  f.close();tmp.cleanup();
  if(oldFlag===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
  else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=oldFlag;
 }
}
test('PF99 source-bound PF91 actually changes original character title under SQLite tx',t=>fixture(t,s=>{
 const out=s.activate();
 assert.equal(out.status,'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION');
 assert.equal(s.stats.witness,2);
 assert.equal(s.f.get(C,String(F.OWNER)).shipID,F.SHIP);
 assert.equal(s.f.get(I,I)[String(F.SHIP)].ownerID,F.OWNER);
}));
test('PF99 source-bound PF92 writes exactly one existing character title row',t=>fixture(t,s=>{
 const before=structuredClone(s.f.get(I,I));
 const out=s.write(next=>{next.shipID=F.SHIP;next.shipTypeID=606;next.shipName='New Hull';});
 assert.equal(out.status,'APPLIED_ORIGINAL_CHARACTER_ROW');
 assert.equal(out.protectedChange,true);assert.equal(s.stats.witness,2);
 assert.equal(s.f.get(C,String(F.OWNER)).shipID,F.SHIP);
 assert.deepEqual(s.f.get(I,I),before);
}));
test('PF99 foreign account cannot use PF91 despite injected true callback',t=>fixture(t,s=>{
 s.session.userid=999;
 const out=s.activate();
 assert.equal(out.reason,'PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
 assert.equal(s.f.get(C,String(F.OWNER)).shipID,OTHER_SHIP);
}));
test('PF99 cloned session cannot use PF91 despite copying every identity field',t=>fixture(t,s=>{
 const clone=structuredClone(s.session);
 const out=s.activate(clone);
 assert.equal(out.reason,'PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
 assert.equal(s.f.get(C,String(F.OWNER)).shipID,OTHER_SHIP);
}));
test('PF99 station reassignment blocks source-bound player selection',t=>fixture(t,s=>{
 s.session.stationid=F.STATION+1;s.session.stationID=F.STATION+1;
 const out=s.activate();
 assert.equal(out.reason,'PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
}));
test('PF99 logout after first witness refuses late PF91 title commit',t=>fixture(t,s=>{
 const before=s.f.get(C,String(F.OWNER));
 let n=0;
 const orig=s.identity.verifyOriginalDockedPlayerSession;
 s.f.shared.onTx=tx=>{
  tx.verifyReadOnlySessionWitness=(fn,request)=>{
   const result=fn(request,{get:(t,k)=>tx.get(t,k),scan:t=>tx.scan(t)});
   if(++n===1)s.sessions.delete(s.session);
   return result;
  };
 };
 const out=s.player.activate({characterID:F.OWNER,targetShipItemID:F.SHIP,
  stationID:F.STATION,expectedBefore:before,session:s.session});
 assert.equal(out.reason,'PF91_ORIGINAL_PLAYER_SESSION_REVOKED');
 assert.equal(s.f.get(C,String(F.OWNER)).shipID,OTHER_SHIP);
}));
test('PF99 source-bound PF92 rejects cloned session and rolls back',t=>fixture(t,s=>{
 const old=s.f.get(C,String(F.OWNER));
 const out=s.write(next=>{next.shipID=F.SHIP;next.shipTypeID=606;},
  structuredClone(s.session));
 assert.equal(out.reason,'PF92_CHARACTER_SESSION_LEASE_REQUIRED');
 assert.deepEqual(s.f.get(C,String(F.OWNER)),old);
}));
test('PF99 PF91 rejects reserved physical hull without altering ItemStore',t=>fixture(t,s=>{
 const items=structuredClone(s.f.get(I,I));
 const out=s.activate();
 assert.notEqual(out.status,'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION');
 assert.deepEqual(s.f.get(I,I),items);
},{reserve:true}));
test('PF99 binder refuses PF91 on native owner flag OFF even inside test runner',t=>fixture(t,s=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const out=s.activate();
 assert.equal(out.reason,'PF99_NATIVE_SESSION_OWNER_DISABLED');
 assert.equal(s.stats.witness,0);
}));
test('PF99 binder refuses PF92 inside an original SQLite tx when flag OFF',t=>fixture(t,s=>{
 delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 assert.throws(()=>s.write(next=>{next.shipID=F.SHIP;}),/PF99_NATIVE_SESSION_OWNER_DISABLED/);
 assert.equal(s.f.get(C,String(F.OWNER)).shipID,OTHER_SHIP);
}));
test('PF99 binder never accepts a caller supplied session verifier callback',t=>fixture(t,s=>{
 const out=s.bindings.createSourceBoundPlayerShipActivation({
  gameStore:s.f.gameStore,pf52:F.pf52,enabled:()=>true,
  allWritersFenced:()=>true,verifyOriginalDockedPlayerSession:()=>true
 });
 const clone=structuredClone(s.session);
 const result=out.activate({characterID:F.OWNER,targetShipItemID:F.SHIP,
  stationID:F.STATION,expectedBefore:s.f.get(C,String(F.OWNER)),session:clone});
 assert.equal(result.reason,'PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
}));
