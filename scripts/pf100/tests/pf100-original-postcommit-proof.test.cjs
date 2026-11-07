'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync(path.resolve(__dirname,'../native/coopPersonalFleetOriginalPostCommitProof.js'),'utf8');
function scenario(run){
 const priorWitness=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
 const priorAtomic=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS='1';
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS='1';
 const db=new DatabaseSync(':memory:');
 for(const table of ['characters','items'])db.exec(`CREATE TABLE "${table}" (key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 const put=(table,key,value)=>db.prepare(`INSERT OR REPLACE INTO "${table}" (key,json) VALUES (?,?)`).run(key,JSON.stringify(value));
 const get=(table,key)=>{const row=db.prepare(`SELECT json FROM "${table}" WHERE key=?`).get(key);return row?JSON.parse(row.json):null;};
 const row={characterID:901,accountId:55,stationID:6001,structureID:null,
   shipID:2002,shipTypeID:606,shipName:'Old'};
 const items={'2001':{itemID:2001,ownerID:901,categoryID:6,singleton:1,
   flagID:4,locationID:6001,typeID:607,itemName:'New'},
   '2002':{itemID:2002,ownerID:901,categoryID:6,singleton:1,
   flagID:4,locationID:6001,typeID:606,itemName:'Old'}};
 put('characters','901',row);put('items','items',items);
 const session={socket:{destroyed:false},userid:55,characterID:901,charid:901,
   stationID:6001,stationid:6001,structureID:null,structureid:null,
   shipID:2002,shipid:2002,activeShipID:2002};
 const sessions=new Set([session]);
 const registry={getSessions:()=>[...sessions].filter(s=>!s.socket.destroyed),
   findSessionByCharacterID:id=>[...sessions].find(s=>s.characterID===id&&!s.socket.destroyed)||null};
 const docking={getSessionStationID:s=>s.stationid||0,
   getSessionStructureID:s=>s.structureid||0,
   getDockedLocationID:s=>s.structureid||s.stationid||0};
 const module={exports:{}};
 new Function('require','module','exports','process',source)((p)=>{
   if(p==='../services/chat/sessionRegistry')return registry;
   if(p==='../services/structure/structureLocation')return docking;
   throw Error('UNEXPECTED_IMPORT:'+p);
 },module,module.exports,process);
 const receipt={status:'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION',mayCommit:true,
   characterID:901,targetShipItemID:2001,previousShipID:2002,stationID:6001};
 const request={...receipt,activationResult:receipt,session};
 const read={get};
 const verify=()=>module.exports.verifyOriginalPostCommitPlayerShip(request,read);
 const commit=()=>{db.exec('BEGIN IMMEDIATE');put('characters','901',{
    ...row,shipID:2001,shipTypeID:607,shipName:'New'});db.exec('COMMIT');};
 try{run({db,get,put,row,items,request,receipt,session,sessions,registry,read,verify,commit});}
 finally{db.close();if(priorWitness===undefined)delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;
   else process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=priorWitness;
   if(priorAtomic===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
   else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=priorAtomic;}
}
const expected=(scenarioFn,status,reason)=>scenario(s=>{scenarioFn(s);
  const result=s.verify();assert.equal(result.status,status);if(reason)assert.equal(result.reason,reason);});
test('PF100 before COMMIT cannot publish even with claimed receipt',()=>expected(()=>{},'BLOCKED','PF100_COMMITTED_CHARACTER_DIVERGED'));
test('PF100 physical committed character/item proof yields session publication ticket',()=>expected(s=>s.commit(),'READY_FOR_NATIVE_SESSION_APPLY'));
test('PF100 status after session already synchronized is idempotent',()=>expected(s=>{s.commit();Object.assign(s.session,{shipID:2001,shipid:2001,activeShipID:2001});},'ALREADY_SYNCED'));
test('PF100 reject feature OFF',()=>expected(s=>{s.commit();delete process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS;},'BLOCKED','PF100_NATIVE_OWNER_DISABLED'));
test('PF100 reject SQLite atomic owner OFF',()=>expected(s=>{s.commit();delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;},'BLOCKED','PF100_NATIVE_OWNER_DISABLED'));
test('PF100 reject forged result',()=>expected(s=>{s.commit();s.request.activationResult={...s.receipt,mayCommit:false};},'BLOCKED','PF100_COMMIT_RECEIPT_INVALID'));
test('PF100 reject duplicated live character session',()=>expected(s=>{s.commit();s.sessions.add({...s.session,socket:{destroyed:false}});},'BLOCKED','PF100_SESSION_REVOKED_OR_DUPLICATED'));
test('PF100 reject clone identity not registered',()=>expected(s=>{s.commit();s.request.session=structuredClone(s.session);},'BLOCKED','PF100_SESSION_REVOKED_OR_DUPLICATED'));
test('PF100 reject disconnect after durable commit',()=>expected(s=>{s.commit();s.session.socket.destroyed=true;},'BLOCKED','PF100_LIVE_SESSION_INVALID'));
test('PF100 reject account switch after commit',()=>expected(s=>{s.commit();s.session.userid=66;},'BLOCKED','PF100_COMMITTED_CHARACTER_DIVERGED'));
test('PF100 reject docking change after commit',()=>expected(s=>{s.commit();s.session.stationid=6002;s.session.stationID=6002;},'BLOCKED','PF100_SESSION_DOCK_CHANGED'));
test('PF100 reject session ship mismatch after commit',()=>expected(s=>{s.commit();s.session.shipid=2020;},'BLOCKED','PF100_SESSION_SHIP_CHANGED'));
test('PF100 reject changed original physical target after commit',()=>expected(s=>{s.commit();s.put('items','items',{'2001':{...s.items['2001'],ownerID:999}});},'BLOCKED','PF100_COMMITTED_PHYSICAL_SHIP_DIVERGED'));
test('PF100 reject persisted row rollback after receipt',()=>expected(s=>{s.commit();s.put('characters','901',{...s.row,shipID:2020});},'BLOCKED','PF100_COMMITTED_CHARACTER_DIVERGED'));
test('PF100 reject postcommit missing ItemStore',()=>expected(s=>{s.commit();s.db.exec(`DELETE FROM "items"`);},'BLOCKED','PF100_COMMITTED_PHYSICAL_SHIP_DIVERGED'));
test('PF100 read-only proof never modifies physical SQLite',()=>scenario(s=>{
 s.commit();const before=s.db.prepare('SELECT json FROM "characters"').get().json;
 const a=s.verify();assert.equal(a.mayPublish,true);
 assert.equal(s.db.prepare('SELECT json FROM "characters"').get().json,before);
 assert.equal(s.session.shipID,2002);assert.equal(Object.isFrozen(a),true);
}));
