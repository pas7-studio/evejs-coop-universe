'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const original=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalAtomicSwitchAndHandoff.cjs'),'utf8');
const P='coop-personal-fleet\u001f',T='corporationRuntime';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(cb){
 const oldFlags=['EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS','EVEJS_COOP_NATIVE_ATOMIC_ROWS','EVEJS_COOP_PERSONAL_FLEET_ATOMIC_HANDOFF'].map(k=>[k,process.env[k]]);
 for(const [k] of oldFlags)process.env[k]='1';
 const db=new DatabaseSync(':memory:');
 for(const table of ['corporationRuntime','items','characters'])db.exec(`CREATE TABLE "${table}" (key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 const get=(t,k)=>{const r=db.prepare(`SELECT json FROM "${t}" WHERE key=?`).get(k);return r?JSON.parse(r.json):null};
 const put=(t,k,v)=>db.prepare(`INSERT INTO "${t}" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(k,JSON.stringify(v));
 const scan=t=>db.prepare(`SELECT key,json FROM "${t}"`).all().map(r=>({key:r.key,value:JSON.parse(r.json)}));
 const state={enabled:true,writers:true,exclusive:true,equipment:true,actorFree:true,spawn:true,
  witnessCalls:0,revokeAt:0,poisoned:false,failOnPut:0,writeCount:0,commitUncertain:false,rogueWrite:false,currentTx:null};
 const row={version:1,phase:'ISSUING',dispatchCount:1,operationID:'deploy-1',assignmentID:'assignment-1',pilotID:'coop-pilot-123',contractID:'contract-1',shipItemID:2001,ownerCharacterID:90000001,stationID:600001,systemID:30000142,typeID:606,generation:1,fittingHash:sha('fit'),cargoHash:sha('cargo')};
 const previous={itemID:2001,shipID:2001,ownerID:90000001,locationID:600001,
  flagID:4,typeID:606,categoryID:6,singleton:1,stacksize:1,quantity:-1,spaceState:null};
 const capsule={itemID:2010,shipID:2010,ownerID:90000001,locationID:600001,
  flagID:4,typeID:670,itemName:'Capsule',categoryID:6,singleton:1,stacksize:1,
  quantity:-1,spaceState:null};
 const char={characterID:90000001,accountId:55,stationID:600001,structureID:null,
  shipID:2001,shipTypeID:606,shipName:'My Ship',balance:777};
 const session={socket:{destroyed:false},characterID:90000001,charid:90000001,userid:55,
  stationID:600001,stationid:600001,structureID:null,structureid:null,
  shipID:2001,shipid:2001,activeShipID:2001};
 const items={'2001':previous,'2010':capsule};
 const index={version:1,ships:{'2001':{ownerCharacterID:90000001,pilotID:row.pilotID,
  assignmentID:row.assignmentID,stationID:row.stationID,generation:1}},pilots:{[row.pilotID]:{contractID:row.contractID}}};
 const roster={version:1,pilots:{[row.pilotID]:{contractID:row.contractID,shipItemID:2001,
  assignmentID:row.assignmentID,generation:1,status:'HANGAR_RESERVED'}}};
 put('characters','90000001',char);put('items','items',items);
 put(T,P+'deploy-v1:'+row.assignmentID,row);
 put(T,P+'hangar-reservations-v1',index);
 put(T,P+'roster-v1:'+row.ownerCharacterID,roster);
 // A faithful constrained adapter subset; whole original owner is not installed.
 const a={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>state.poisoned,transact(tables,callback){
  assert.deepEqual(tables,['corporationRuntime','items','characters']);
  db.exec('BEGIN IMMEDIATE');state.writeCount=0;let insideWitness=false,sticky=false;
  try{
   const tx={get,scan,put(t,k,value){if(insideWitness){sticky=true;throw Error('PF96_WRITE_DURING_WITNESS');}put(t,k,value);state.writeCount++;
      if(state.failOnPut&&state.writeCount===state.failOnPut)throw Error('SIGKILL_SIMULATED_AFTER_WRITE');},
     verifyReadOnlySessionWitness(witness,request){
      state.witnessCalls++;
      if(state.revokeAt===state.witnessCalls)return false;
      insideWitness=true;let passed;
      try{passed=witness(request,{get:(t,k)=>structuredClone(get(t,k)),scan:t=>structuredClone(scan(t))})===true;}
      finally{insideWitness=false;}
      if(sticky)throw Error('PF96_STICKY_WRITER_POISON');
      return passed;
     }};
   state.currentTx=tx;const result=callback(tx);assert.equal(typeof result?.then,'undefined');
   if(sticky)throw Error('PF96_STICKY_COMMIT_FENCE');
   db.exec('COMMIT');if(state.commitUncertain)throw Error('COMMIT_ACK_UNCERTAIN');
   return result;
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }};
 const pf52={REGISTRY_KEY:P+'hangar-reservations-v1',ROSTER_PREFIX:P+'roster-v1:',
   checkCompetingClaims:()=>null,validateIndex:x=>x};
 const inspected=(tx,{ownerCharacterID,shipItemID,allowOwnerAlreadyActive=false})=>{
  const rows=tx.scan('characters');
  let ownerFound=false;
  for(const {key,value} of rows){
   if(!/^\d+$/.test(key)||String(Number(key))!==key||value.characterID!==Number(key))return {verified:false};
   if(key===String(ownerCharacterID))ownerFound=true;
   if([value.shipID,value.shipid,value.activeShipID].some(x=>Number(x)===shipItemID)){
    if(!(allowOwnerAlreadyActive&&key===String(ownerCharacterID)))return {verified:false};
   }
  }
  return {verified:ownerFound};
 };
 const validStockHangar=(item,r)=>!!item&&item.itemID===r.shipItemID&&
  item.ownerID===r.ownerCharacterID&&item.typeID===r.typeID&&item.categoryID===6&&
  item.locationID===r.stationID&&item.flagID===4&&item.singleton===1&&item.quantity===-1;
 const validStockSpace=(item,r)=>!!item&&item.itemID===r.shipItemID&&
  item.locationID===r.systemID&&item.flagID===0&&item.spaceState?.systemID===r.systemID;
 const validPF54=r=>!!r&&r.version===1&&r.phase==='ISSUING'&&r.dispatchCount===1&&
  r.shipItemID===2001&&r.ownerCharacterID===90000001&&r.stationID===600001&&
  r.systemID===30000142&&r.typeID===606&&r.pilotID==='coop-pilot-123';
 const permit={createReciprocalWriterFence:()=>({inTransaction:({tx,shipItemID})=>{
   const reserved=tx.get(T,P+'hangar-reservations-v1')?.ships?.[String(shipItemID)];
   return reserved?{mayCommit:false}:{mayCommit:true};
  }}),inspectOriginalCharacterShipRows:inspected};
 const handoff={validPF54,validStockHangar,validStockSpace,
  key:id=>P+'handoff-v1:'+id,shipKey:id=>P+'handoff-ship-v1:'+id,
  verifyReservation:(idx,rost,r)=>!!idx?.ships?.[String(r.shipItemID)]&&
    rost?.pilots?.[r.pilotID]?.status==='HANGAR_RESERVED'};
 const boot={moveOriginalShipToSpaceAtomically(r,spawn,tx){
  const existing=tx.get('items','items'),item=existing[String(r.shipItemID)];
  if(!validStockHangar(item,r))return {success:false};
  tx.put('items','items',{...existing,[String(r.shipItemID)]:{...item,
    locationID:r.systemID,flagID:0,spaceState:{systemID:r.systemID,
    position:spawn.position,direction:spawn.direction,mode:'STOP'}}});
  return {success:true};
 }};
 const authority={verifyOriginalDockedPlayerSession:req=>{
  const curr=get('characters',String(req.characterID));
  return req.session===session&&session.socket.destroyed===false&&
   req.characterID===row.ownerCharacterID&&session.userid===curr?.accountId&&
   session.shipID===row.shipItemID&&session.stationid===row.stationID&&
   req.previousShipItemID===curr.shipID;
 }};
 const mockRequire=p=>{
  if(p==='node:crypto')return require('node:crypto');
  if(p==='node:util')return require('node:util');
  if(p==='./coopPersonalFleetOriginalNativePermit.cjs')return permit;
  if(p==='./coopPersonalFleetOriginalShipHandoff.cjs')return handoff;
  if(p==='./coopPersonalFleetNativeBootstrap.cjs')return boot;
  if(p==='./coopPersonalFleetOriginalSessionWitness.js')return authority;
  throw Error('UNEXPECTED_IMPORT '+p);
 };
 const module={exports:{}};
 new Function('require','module','exports','process','structuredClone',original)(mockRequire,module,module.exports,process,structuredClone);
 const service=module.exports.createOriginalAtomicSwitchAndHandoff({gameStore:{coopAtomicNativeRows:a},pf52,
  enabled:()=>state.enabled,allWritersFenced:()=>state.writers,
  verifyExclusive:()=>state.exclusive,verifyOriginalEquipment:()=>{
   if(state.rogueWrite){try{state.currentTx.put('items','items',get('items','items'));}catch{}}
   return state.equipment?
   {fittingHash:row.fittingHash,cargoHash:row.cargoHash}:null;},
  verifyNoPhysicalActor:()=>state.actorFree,
  resolveOriginalUndock:()=>state.spawn?{stationID:row.stationID,systemID:row.systemID,
   sessionless:true,position:{x:1,y:2,z:3},direction:{x:1,y:0,z:0}}:null,
  clock:()=>1800000000000});
 const request={session,pf54Row:row,replacementShipItemID:2010,expectedCharacterBefore:structuredClone(char)};
 const run=()=>service.execute(request);
 try{cb({db,get,put,scan,row,char,session,items,request,run,state,service,pf52});}
 finally{db.close();for(const [k,v] of oldFlags){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
function verified(cb,status,reason){fixture(x=>{
 cb(x);const prior=x.get(T,P+'handoff-v1:'+x.row.assignmentID);const r=x.run();assert.equal(r.status,status);if(reason)assert.equal(r.reason,reason);
 if(status==='BLOCKED')assert.deepEqual(x.get(T,P+'handoff-v1:'+x.row.assignmentID),prior);
 });}
const ok='COMMITTED_PENDING_SESSION_AND_NPC_RECONCILE';
test('PF100B one SQLite COMMIT changes original active ship, physical old item and PF58 one-shot permit',()=>fixture(x=>{
 const result=x.run();assert.equal(result.status,ok);
 const after=x.get('characters','90000001');assert.equal(after.shipID,2010);
 assert.equal(after.shipTypeID,670);assert.equal(after.balance,777);
 const moved=x.get('items','items');assert.equal(Object.keys(moved).length,2);
 assert.equal(moved['2001'].locationID,x.row.systemID);
 assert.equal(moved['2001'].flagID,0);assert.equal(moved['2010'].locationID,x.row.stationID);
 assert.equal(x.get(T,P+'handoff-v1:'+x.row.assignmentID).status,'CONSUMED');
 assert.equal(x.session.shipID,2001,'never change session during COMMIT');
 assert.equal(x.state.witnessCalls,4);
}));
test('PF100B cannot replay consumed one-shot permit',()=>fixture(x=>{
 assert.equal(x.run().status,ok);assert.equal(x.run().status,'BLOCKED');
}));
test('PF100B input cannot replace real PF54 dispatch row',()=>verified(x=>{x.request.pf54Row={...x.row,operationID:'other'};},'BLOCKED','PF100B_DURABLE_PF54_ROW_CHANGED'));
test('PF100B blocked if session witness falsified on first read',()=>verified(x=>{x.state.revokeAt=1;},'BLOCKED','PF100B_LIVE_SOURCE_SESSION_UNVERIFIED'));
test('PF100B blocked if session revoked just before write',()=>verified(x=>{x.state.revokeAt=3;},'BLOCKED','PF100B_AUTHORITY_REVOKED_BEFORE_COMMIT'));
test('PF100B blocked if session account changes',()=>verified(x=>{x.session.userid=123;},'BLOCKED','PF100B_LIVE_SOURCE_SESSION_UNVERIFIED'));
test('PF100B blocked if session dock changes',()=>verified(x=>{x.session.stationid=600002;},'BLOCKED','PF100B_LIVE_SOURCE_SESSION_UNVERIFIED'));
test('PF100B refuses target not a preexisting capsule',()=>verified(x=>{x.put('items','items',{'2001':x.items['2001']});},'BLOCKED','PF100B_PHYSICAL_HULL_OR_CAPSULE_INVALID'));
test('PF100B refuses capsule owner mismatch',()=>verified(x=>{x.put('items','items',{...x.items,'2010':{...x.items['2010'],ownerID:44}});},'BLOCKED','PF100B_PHYSICAL_HULL_OR_CAPSULE_INVALID'));
test('PF100B refuses non-capsule replacement',()=>verified(x=>{x.put('items','items',{...x.items,'2010':{...x.items['2010'],typeID:606}});},'BLOCKED','PF100B_PHYSICAL_HULL_OR_CAPSULE_INVALID'));
test('PF100B refuses stale character row',()=>verified(x=>{x.put('characters','90000001',{...x.char,balance:778});},'BLOCKED','PF100B_ACTIVE_ORIGINAL_SHIP_NOT_OWNED'));
test('PF100B refuses original ship no longer actively owned',()=>verified(x=>{x.put('characters','90000001',{...x.char,shipID:2010});x.request.expectedCharacterBefore={...x.char,shipID:2010};},'BLOCKED','PF100B_LIVE_SOURCE_SESSION_UNVERIFIED'));
test('PF100B refuses second character title collision',()=>verified(x=>{x.put('characters','90000002',{characterID:90000002,shipID:2010});},'BLOCKED','PF100B_PLAYER_SHIP_COLLISION'));
test('PF100B refuses PF52 reservation missing',()=>verified(x=>{x.put(T,P+'hangar-reservations-v1',{version:1,ships:{},pilots:{}});},'BLOCKED','PF100B_PF52_RESERVATION_UNVERIFIED'));
test('PF100B refuses reserved replacement capsule',()=>verified(x=>{const i=x.get(T,P+'hangar-reservations-v1');i.ships['2010']={};x.put(T,P+'hangar-reservations-v1',i);},'BLOCKED','PF100B_REPLACEMENT_CUSTODY_BLOCKED'));
test('PF100B refuses physical existing actor',()=>verified(x=>{x.state.actorFree=false;},'BLOCKED','PF100B_ORIGINAL_OWNER_OR_EQUIPMENT_INVALID'));
test('PF100B refuses unavailable equipment witness',()=>verified(x=>{x.state.equipment=false;},'BLOCKED','PF100B_ORIGINAL_OWNER_OR_EQUIPMENT_INVALID'));
test('PF100B refuses unavailable undock coordinates',()=>verified(x=>{x.state.spawn=false;},'BLOCKED','PF100B_UNDOCK_UNPROVEN'));
test('PF100B refuses missing native feature flag',()=>verified(x=>{delete process.env.EVEJS_COOP_PERSONAL_FLEET_ATOMIC_HANDOFF;},'BLOCKED','PF100B_DISABLED_OR_WRITERS_UNFENCED'));
test('PF100B refuses untrusted original writer installation',()=>verified(x=>{x.state.writers=false;},'BLOCKED','PF100B_DISABLED_OR_WRITERS_UNFENCED'));
test('PF100B writes rolled back atomically on injected post-character crash',()=>fixture(x=>{
 x.state.failOnPut=2;const r=x.run();assert.equal(r.status,'OUTCOME_UNKNOWN');
 assert.equal(x.get('characters','90000001').shipID,2001);
 assert.equal(x.get('items','items')['2001'].flagID,4);
 assert.equal(x.get(T,P+'handoff-v1:'+x.row.assignmentID),null);
}));
test('PF100B writes rolled back atomically on injected post-item crash',()=>fixture(x=>{
 x.state.failOnPut=3;const r=x.run();assert.equal(r.status,'OUTCOME_UNKNOWN');
 assert.equal(x.get('characters','90000001').shipID,2001);
 assert.equal(x.get('items','items')['2001'].locationID,x.row.stationID);
 assert.equal(x.get(T,P+'handoff-v1:'+x.row.assignmentID),null);
}));
test('PF100B COMMIT acknowledgement unknown is not a retry token',()=>fixture(x=>{
 x.state.commitUncertain=true;const r=x.run();assert.equal(r.status,'OUTCOME_UNKNOWN');
 assert.equal(r.mayRetryAutomatically,false);
 assert.equal(x.get('characters','90000001').shipID,2010);
 assert.equal(x.get(T,P+'handoff-v1:'+x.row.assignmentID).status,'CONSUMED');
}));
test('PF100B disallows duplicate PF58 durable permit',()=>verified(x=>{x.put(T,P+'handoff-v1:'+x.row.assignmentID,{status:'CONSUMED'});},'BLOCKED','PF100B_HANDOFF_ALREADY_ATTEMPTED'));
test('PF100B block if active ship aliases contradict',()=>verified(x=>{
 x.put('characters','90000001',{...x.char,shipid:3000});
 x.request.expectedCharacterBefore={...x.char,shipid:3000};
},'BLOCKED','PF100B_ACTIVE_ORIGINAL_SHIP_NOT_OWNED'));
test('PF100B sticky owner witness rejects caught identical-value native callback write',()=>fixture(x=>{
 x.state.rogueWrite=true;
 const r=x.run();assert.equal(r.status,'OUTCOME_UNKNOWN');
 assert.equal(r.mayRetryAutomatically,false);
 assert.equal(x.get('characters','90000001').shipID,2001);
 assert.equal(x.get('items','items')['2001'].flagID,4);
 assert.equal(x.get(T,P+'handoff-v1:'+x.row.assignmentID),null);
}));
