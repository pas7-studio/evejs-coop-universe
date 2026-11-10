'use strict';
/** PF110: original sqliteStore grouped entity/module rows, real Node SQLite. */
const {test}=require('node:test');
const a=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {nativeGroupShipVacant}=require('../native/coopPersonalFleetContractLifecycle.cjs');
const SEP='\u001f',SHIP=2001,OTHER=2002;
function fixture(fn){
 const db=new DatabaseSync(':memory:');
 for(const name of ['npcEntities','npcModules'])
  db.exec('CREATE TABLE "'+name+'" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const table=t=>{if(!['npcEntities','npcModules'].includes(t))throw Error('UNKNOWN_TABLE');return '"'+t+'"';};
 const tx={
  get(t,k){const r=db.prepare('SELECT json FROM '+table(t)+' WHERE key=?').get(k);
   return r?JSON.parse(r.json):null;},
  scan(t){return db.prepare('SELECT key,json FROM '+table(t)).all()
   .map(r=>({key:r.key,value:JSON.parse(r.json)}));}
 };
 const put=(t,k,v)=>db.prepare('INSERT INTO '+table(t)+
  '(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
  .run(k,JSON.stringify(v));
 const seed=()=>{
  put('npcEntities','entities',{});
  put('npcEntities','nextEntityID',980000000000);
  put('npcModules','modules',{});
  put('npcModules','nextModuleID',980100000000);
 };
 try{return fn({tx,put,seed});}finally{db.close();}
}
const entity=(id=OTHER)=>({entityID:id,ownerCharacterID:90000001});
const moduleRow=(id=7001,entityID=OTHER)=>({moduleID:id,entityID,slot:1});
const check=(f,t,g,field)=>nativeGroupShipVacant(f.tx,t,g,field,SHIP);
test('PF110 original grouped SQL skeletons admit absent physical NPC',()=>fixture(f=>{
 f.seed();
 a.equal(check(f,'npcEntities','entities','entityID'),true);
 a.equal(check(f,'npcModules','modules','moduleID'),true);
}));
test('PF110 unrelated physical native entity does not count as lost ship',()=>fixture(f=>{
 f.seed();f.put('npcEntities','entities'+SEP+OTHER,entity());
 a.equal(check(f,'npcEntities','entities','entityID'),true);
 f.put('npcEntities','entities'+SEP+SHIP,entity(SHIP));
 a.equal(check(f,'npcEntities','entities','entityID'),false);
}));
test('PF110 module on destroyed ship still present denies loss',()=>fixture(f=>{
 f.seed();f.put('npcModules','modules'+SEP+'7001',moduleRow(7001,SHIP));
 a.equal(check(f,'npcModules','modules','moduleID'),false);
}));
test('PF110 unrelated native module does not block ship',()=>fixture(f=>{
 f.seed();f.put('npcModules','modules'+SEP+'7001',moduleRow());
 a.equal(check(f,'npcModules','modules','moduleID'),true);
}));
test('PF110 missing group skeleton never proves loss',()=>fixture(f=>{
 a.equal(check(f,'npcEntities','entities','entityID'),null);
 a.equal(check(f,'npcModules','modules','moduleID'),null);
}));
test('PF110 corrupt unrelated native module row fails closed',()=>fixture(f=>{
 f.seed();f.put('npcModules','modules'+SEP+'7001',moduleRow(7002));
 a.equal(check(f,'npcModules','modules','moduleID'),null);
}));
test('PF110 noncanonical grouped SQLite key fails closed',()=>fixture(f=>{
 f.seed();f.put('npcEntities','entities'+SEP+'02001',entity(SHIP));
 a.equal(check(f,'npcEntities','entities','entityID'),null);
}));
test('PF110 hidden alias of another physical NPC is rejected',()=>fixture(f=>{
 f.seed();f.put('npcEntities','entities'+SEP+OTHER,entity(SHIP));
 a.equal(check(f,'npcEntities','entities','entityID'),null);
}));
test('PF110 fabricated aggregate npcEntities root never counts as a group',()=>fixture(f=>{
 f.put('npcEntities','npcEntities',{entities:{}});
 a.equal(check(f,'npcEntities','entities','entityID'),null);
}));
test('PF110 malformed native group skeleton denied',()=>fixture(f=>{
 f.seed();f.put('npcModules','modules',{modules:{}});
 a.equal(check(f,'npcModules','modules','moduleID'),null);
}));
test('PF110 group query must be backed by original tx scan',()=>{
 a.equal(nativeGroupShipVacant({get:()=>({})},'npcEntities','entities','entityID',SHIP),null);
});
