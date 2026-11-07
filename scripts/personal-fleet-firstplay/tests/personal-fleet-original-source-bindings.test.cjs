'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalSourceBindings.js'),'utf8');
const OWNER=90000111,SHIP=2001,STATION=60003760,SYSTEM=30000142;
function fixture(callback){
 const db=new DatabaseSync(':memory:');
 for(const t of ['characters','items'])db.exec(`CREATE TABLE "${t}" (key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 const get=(t,k)=>{const r=db.prepare(`SELECT json FROM "${t}" WHERE key=?`).get(k);return r?JSON.parse(r.json):null};
 const put=(t,k,v)=>db.prepare(`INSERT INTO "${t}" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(k,JSON.stringify(v));
 const state={poisoned:false,live:true,duplicate:false,station:true,structure:false,validStation:true,scene:true,entity:true};
 const session={characterID:OWNER,charid:OWNER,userid:55,socket:{destroyed:false},stationid:STATION,
  shipid:SHIP,_space:{initialStateSent:true,systemID:SYSTEM,shipID:SHIP}};
 const char={characterID:OWNER,accountId:55,shipID:SHIP,stationID:STATION,corporationID:1000035};
 const item={itemID:SHIP,ownerID:OWNER,locationID:SYSTEM,categoryID:6,flagID:0};
 put('characters',String(OWNER),char);put('items','items',{[SHIP]:item});
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>state.poisoned,
  transact(tables,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn({get});db.exec('COMMIT');return r;}
   catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}}};
 const registry={getSessions:()=>state.live?(state.duplicate?[session,session]:[session]):[],findSessionByCharacterID:()=>state.live?session:null};
 const location={getSessionStationID:s=>state.station?s.stationid:0,getSessionStructureID:()=>state.structure?123456:0};
 const stations={getStationRecord:(_session,id)=>state.validStation?{stationID:id,solarSystemID:SYSTEM}:{stationID:0,solarSystemID:SYSTEM}};
 const space={getSceneForSession:()=>state.scene?{systemID:SYSTEM,getEntityByID:id=>state.entity?{kind:'ship',itemID:id,nativeNpc:false,transient:false}:null}:null};
 const paths=[];
 const mock=n=>{paths.push(n);
  const all={'../gameStore':{coopAtomicNativeRows:atomic},
   '../services/chat/sessionRegistry':registry,
   '../services/structure/structureLocation':location,
   '../services/_shared/stationStaticData':stations,
   '../services/corporation/corporationState':{getCorporationRecord:id=>id===1000035?{corporationID:id}:null},
   './runtime':space};
  if(!Object.prototype.hasOwnProperty.call(all,n))throw Error('UNTRUSTED_IMPORT:'+n);
  return all[n];};
 const mod={exports:{}};
 vm.runInNewContext(source,{module:mod,require:mock,Object,Array,Number,Boolean,Set,process},{filename:'coopPersonalFleetOriginalSourceBindings.js'});
 const bound=mod.exports.createOriginalSourceBindings();
 const auth=()=>bound.access.isOwner(session,OWNER);
 const dock=()=>bound.resolveOriginalDockContext(session,OWNER);
 const follow=()=>bound.resolveOriginalFollowTarget(session,OWNER,SYSTEM);
 try{callback({db,get,put,state,session,char,item,auth,dock,follow,paths,bound});}
 finally{db.close();}
}
test('native source only imports original EveJS GameStore, sessions, docking and scene',()=>fixture(f=>{
 assert.deepEqual(f.paths,['../gameStore','../services/chat/sessionRegistry',
  '../services/structure/structureLocation','../services/_shared/stationStaticData',
  '../services/corporation/corporationState','./runtime']);
}));
test('original live session, account and current original character row accept',()=>fixture(f=>{
 assert.equal(f.auth(),true);
}));
test('existing real station and exact original character dock produce station/system context',()=>fixture(f=>{
 assert.deepEqual(JSON.parse(JSON.stringify(f.dock())),{stationID:STATION,systemID:SYSTEM,originalNativeVerified:true});
}));
test('current station session cannot follow from docked state',()=>fixture(f=>{
 assert.equal(f.follow(),null);
}));
test('original live space ship and actual scene entity give physical FOLLOW target',()=>fixture(f=>{
 f.state.station=false;f.put('characters',String(OWNER),{...f.char,stationID:null});
 assert.deepEqual(JSON.parse(JSON.stringify(f.follow())),{shipItemID:SHIP,systemID:SYSTEM,nativeVerified:true});
}));
test('duplicate login blocks owner even if registry picks one',()=>fixture(f=>{
 f.state.duplicate=true;assert.equal(f.auth(),false);assert.equal(f.dock(),null);
}));
test('closed native socket blocks original owner',()=>fixture(f=>{
 f.session.socket.destroyed=true;assert.equal(f.auth(),false);
}));
test('foreign account blocked against durable character account',()=>fixture(f=>{
 f.session.userid=999;assert.equal(f.auth(),false);
}));
test('forged session-shaped object absent registry is blocked',()=>fixture(f=>{
 assert.equal(f.bound.access.isOwner({...f.session},OWNER),false);
}));
test('poisoned original GameStore never authorizes owner',()=>fixture(f=>{
 f.state.poisoned=true;assert.equal(f.auth(),false);
}));
test('no live session registry membership blocks owner',()=>fixture(f=>{
 f.state.live=false;assert.equal(f.auth(),false);
}));
test('changed session charid blocks source owner',()=>fixture(f=>{
 f.session.charid=OWNER+1;assert.equal(f.auth(),false);
}));
test('docking in a structure is not represented as station',()=>fixture(f=>{
 f.state.structure=true;assert.equal(f.dock(),null);
}));
test('station source lookup cannot silently fall back to default station',()=>fixture(f=>{
 f.state.validStation=false;assert.equal(f.dock(),null);
}));
test('station mismatch between native character and session blocks',()=>fixture(f=>{
 f.put('characters',String(OWNER),{...f.char,stationID:STATION+1});assert.equal(f.dock(),null);
}));
test('space follow requires real scene and entity',()=>fixture(f=>{
 f.state.station=false;f.state.scene=false;assert.equal(f.follow(),null);
}));
test('space follow requires exact original physical entity',()=>fixture(f=>{
 f.state.station=false;f.state.entity=false;assert.equal(f.follow(),null);
}));
test('space follow rejects stock ship ItemStore owner mismatch',()=>fixture(f=>{
 f.state.station=false;f.put('items','items',{[SHIP]:{...f.item,ownerID:OWNER+1}});
 assert.equal(f.follow(),null);
}));
test('space follow refuses wrong system ID',()=>fixture(f=>{
 f.state.station=false;assert.equal(f.bound.resolveOriginalFollowTarget(f.session,OWNER,SYSTEM+1),null);
}));
test('space follow refuses destroyed or changed original active ship',()=>fixture(f=>{
 f.state.station=false;f.put('characters',String(OWNER),{...f.char,shipID:SHIP+1});
 assert.equal(f.follow(),null);
}));
test('foreign character cannot assume another player dock/source target',()=>fixture(f=>{
 assert.equal(f.bound.access.isOwner(f.session,OWNER+1),false);
 assert.equal(f.bound.resolveOriginalDockContext(f.session,OWNER+1),null);
}));
test('original PF58 native actor owner corporation comes from durable character and static corporation',()=>fixture(f=>{
 assert.equal(f.bound.resolveOwnerCorporation(OWNER),1000035);
}));
test('original PF58 source refuses missing or fabricated corporation ownership',()=>fixture(f=>{
 f.put('characters',String(OWNER),{...f.char,corporationID:999});
 assert.equal(f.bound.resolveOwnerCorporation(OWNER),null);
}));
