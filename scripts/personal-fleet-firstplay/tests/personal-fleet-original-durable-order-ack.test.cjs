'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),
 {DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto'),
 fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalDurableOrderAck.js'),'utf8');
const pf56=require('../../pf56/native/coopPersonalFleetReturnDock.cjs');
const T='corporationRuntime',NE='npcEntities', F='coop-personal-fleet\u001f';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(run){
 const db=new DatabaseSync(':memory:');
 for(const name of [T,NE,'items','characters'])db.exec(`CREATE TABLE "${name}" (key TEXT PRIMARY KEY, json TEXT NOT NULL)`);
 let poisoned=false,on=true,fenced=true,actorOK=true,targetOK=true,controlOK=true,abort=false;
 let gets=0,puts=0,dispatch=0;
 const row={version:1,phase:'ISSUING',operationID:'op-123',
  assignmentID:'asgn-1',pilotID:'coop-pilot-123',ownerCharacterID:901,
  shipItemID:2301,systemID:30000142,actorGeneration:9,action:'FOLLOW',
  targetEntityID:3301,followRangeMeters:3000,startedAtMs:1700000000000};
 function signature(r){return hash([r.operationID,r.assignmentID,r.pilotID,r.ownerCharacterID,
  r.shipItemID,r.systemID,r.actorGeneration,r.action,r.targetEntityID??null,r.followRangeMeters??null]);}
 row.signature=signature(row);
 const entity={kind:'ship',itemID:2301,ownerID:901,nativeNpc:true,
  selectionID:'asgn-1',session:null,mode:'FOLLOW',targetEntityID:3301,followRange:3000,
  position:{x:1,y:2,z:3},velocity:{x:0.1,y:0,z:0},direction:{x:1,y:0,z:0},
  targetPoint:{x:2,y:2,z:3},speedFraction:0.4};
 const controller={entityID:2301,systemID:30000142,runtimeKind:'nativeAmbient',manualOrder:null};
 const storedController={entityID:2301,systemID:30000142,personalFleetOriginal:true,
  personalFleetAssignmentID:'asgn-1',personalFleetPilotID:'coop-pilot-123',
  runtimeKind:'nativeAmbient'};
 const stationBall={kind:'station',itemID:60000123,entityID:60000123,
  position:{x:200,y:300,z:400},radius:270};
 const scene={systemID:30000142,getEntityByID:id=>id===2301?entity:id===60000123?stationBall:null};
 const originalEntity={entityID:2301,systemID:30000142,ownerID:901,typeID:600,
  personalFleetOriginal:true,personalFleetAssignmentID:'asgn-1',
  personalFleetPilotID:'coop-pilot-123',mode:'STOP',targetEntityID:0,
  followRange:0,otherStockItemRef:'untouched'};
 const read=(table,key)=>{
  gets++;const q=db.prepare(`SELECT json FROM "${table}" WHERE key=?`).get(key);
  return q?JSON.parse(q.json):null;
 };
 const write=(table,key,value)=>{
  puts++;db.prepare(`INSERT INTO "${table}" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`)
   .run(key,JSON.stringify(value));
 };
 write(T,F+'manual-order-v1:2301',row);
 write(T,F+'manual-order-operations-v1',{
  version:1,operations:{'op-123':{phase:'ISSUING',signature:row.signature,shipItemID:2301}}});
 write(NE,'/',{nextEntityID:980000000001,entities:{'2301':originalEntity}});
 puts=0;
 const tx={get:read,put:write};
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poisoned,
  transact:(tables,fn)=>{
   assert.equal(new Set(tables).size,tables.length);
   db.exec('BEGIN IMMEDIATE');let committed=false;
   try{const guarded={get:(t,k)=>{assert.ok(tables.includes(t));return tx.get(t,k)},
    put:(t,k,v)=>{assert.ok(tables.includes(t));return tx.put(t,k,v)}};
    const result=fn(guarded);if(abort){abort=false;throw Error('SIGKILL_BEFORE_COMMIT');}
    db.exec('COMMIT');committed=true;return result;
   }finally{if(!committed)db.exec('ROLLBACK');}
  }};
 const original={
  '../gameStore':{coopAtomicNativeRows:atomic},
  './runtime':{scenes:new Map([[30000142,scene]])},
  './npc/npcRegistry':{getControllerByEntityID:()=>controller},
  './npc/nativeNpcStore':{getNativeEntity:()=>originalEntity,getNativeController:()=>storedController},
  './coopPersonalFleetNativeOrders':{key:id=>F+'manual-order-v1:'+id,signature},
  './coopPersonalFleetReturnDock':pf56,
  './worldData':{getStationByID:id=>id===60000123?{stationID:id,solarSystemID:30000142,
   position:{x:200,y:300,z:400}}:null}
 };
 const context={module:{exports:{}},exports:{},require:n=>{
  if(n==='node:crypto')return crypto;
  if(!(n in original))throw Error('UNKNOWN_SOURCE '+n);return original[n];
 },Date,Object,Number,Array,Set,Map,structuredClone,process};
 vm.runInNewContext(src,context,{filename:'coopPersonalFleetOriginalDurableOrderAck.js'});
 const opts={enabled:()=>on,allWritersFenced:()=>fenced,
  orderWitness:{verifyNativeActor:()=>actorOK,verifyOriginalControl:()=>controlOK,
   verifyTarget:()=>targetOK}};
 const create=()=>context.module.exports.createOriginalDurableOrderAck(opts);
 try{run({row,entity,controller,storedController,originalEntity,original,opts,create,
  read,write,tx,atomic,db,signature,pf56,
  setEnabled:x=>on=x,setFenced:x=>fenced=x,setPoisoned:x=>poisoned=x,
  setActor:x=>actorOK=x,setTarget:x=>targetOK=x,setControl:x=>controlOK=x,
  abortNext:()=>abort=true,getCounts:()=>({puts,gets,dispatch}),
  receipt:()=>read(T,F+'native-order-receipt-v1:op-123')});}
 finally{db.close();}
}
function writeAndVerify(f){const result=f.create().recordAfterNativeEffect(f.row);
 assert.equal(result.success,true,result.errorMsg);const proof=f.create().verifyPersistedNativeOrder(f.row,f.tx);
 assert.equal(proof?.source,'EVEJS_ORIGINAL_PERSISTED_NPC_ORDER_V1');
 return proof;
}
test('post-native-effect FOLLOW state + receipt committed atomically to original SQLite',()=>fixture(f=>{
 const proof=writeAndVerify(f);assert.equal(proof.noForeignCommand,true);
 const stored=f.read(NE,'/').entities['2301'];assert.equal(stored.mode,'FOLLOW');
 assert.equal(stored.targetEntityID,3301);assert.equal(stored.followRange,3000);
 assert.equal(stored.otherStockItemRef,'untouched');assert.equal(f.receipt().action,'FOLLOW');
}));
test('receipt remains verifiable by a fresh server-side owner after restart',()=>fixture(f=>{
 writeAndVerify(f);const afterRestart=f.create();
 assert.equal(afterRestart.verifyPersistedNativeOrder(f.row,f.tx)?.orderApplied,true);
}));
test('native receipt cannot be emitted twice after potential physical success',()=>fixture(f=>{
 writeAndVerify(f);assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('no receipt when native command has not entered durable ISSUING',()=>fixture(f=>{
 f.write(T,F+'manual-order-v1:2301',{...f.row,phase:'ACKED'});
 assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
 assert.equal(f.receipt(),null);
}));
test('the index and exact source signature must agree',()=>fixture(f=>{
 f.write(T,F+'manual-order-operations-v1',{version:1,operations:{'op-123':{
  phase:'ISSUING',signature:'f'.repeat(64),shipItemID:2301}}});
 assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('cross-player or fabricated actor source refuses even after effect',()=>fixture(f=>{
 f.setActor(false);assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
 f.setActor(true);f.setTarget(false);
 assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('combat or unverified original control blocks receipt',()=>fixture(f=>{
 f.setControl(false);assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('no false FOLLOW ack when original native entity remains STOP',()=>fixture(f=>{
 f.entity.mode='STOP';assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('no false FOLLOW ack when command targets another character ship',()=>fixture(f=>{
 f.entity.targetEntityID=3310;assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('no false FOLLOW ack when physics range differs from requested range',()=>fixture(f=>{
 f.entity.followRange=3300;assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('HOLD proof requires actual original STOP state and stop manual order',()=>fixture(f=>{
 f.row.action='HOLD';f.row.targetEntityID=null;f.row.followRangeMeters=null;
 f.row.signature=f.signature(f.row);
 f.write(T,F+'manual-order-v1:2301',f.row);
 f.write(T,F+'manual-order-operations-v1',{version:1,operations:{'op-123':{
  phase:'ISSUING',signature:f.row.signature,shipItemID:2301}}});
 f.entity.mode='STOP';f.entity.targetEntityID=0;f.entity.followRange=0;
 f.controller.manualOrder={type:'stop'};
 const proof=writeAndVerify(f);assert.equal(proof.action,'HOLD');
 assert.equal(f.read(NE,'/').entities['2301'].mode,'STOP');
}));
test('HOLD with foreign/active manual combat order cannot produce ACK',()=>fixture(f=>{
 f.row.action='HOLD';f.row.targetEntityID=null;f.row.signature=f.signature(f.row);
 f.write(T,F+'manual-order-v1:2301',f.row);
 f.write(T,F+'manual-order-operations-v1',{version:1,operations:{'op-123':{
  phase:'ISSUING',signature:f.row.signature,shipItemID:2301}}});
 f.entity.mode='STOP';f.controller.manualOrder={type:'attack'};
 assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('SIGKILL simulation before COMMIT rolls back BOTH movement state and receipt',()=>fixture(f=>{
 f.abortNext();let ans=f.create().recordAfterNativeEffect(f.row);
 assert.equal(ans.success,false);assert.match(ans.errorMsg,/UNKNOWN_NO_RETRY/);
 assert.equal(f.receipt(),null);assert.equal(f.read(NE,'/').entities['2301'].mode,'STOP');
}));
test('native NPC position movement does not erase durable PF55 order witness',()=>fixture(f=>{
 writeAndVerify(f);let root=f.read(NE,'/');root.entities['2301'].position.x=900;
 f.write(NE,'/',root);
 assert.equal(f.create().verifyPersistedNativeOrder(f.row,f.tx)?.orderApplied,true);
}));
test('changed original durable follow target invalidates PF55 order proof',()=>fixture(f=>{
 writeAndVerify(f);let root=f.read(NE,'/');root.entities['2301'].targetEntityID=9999;
 f.write(NE,'/',root);assert.equal(f.create().verifyPersistedNativeOrder(f.row,f.tx),null);
}));
test('tampering durable receipt signature invalidates independent PF55 ACK',()=>fixture(f=>{
 writeAndVerify(f);f.write(T,F+'native-order-receipt-v1:op-123',
  {...f.receipt(),signature:'f'.repeat(64)});
 assert.equal(f.create().verifyPersistedNativeOrder(f.row,f.tx),null);
}));
test('original writer-fence revocation refuses receipt and proof',()=>fixture(f=>{
 writeAndVerify(f);f.setFenced(false);
 assert.equal(f.create().verifyPersistedNativeOrder(f.row,f.tx),null);
 assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('poisoned native GameStore refuses receipt and proof',()=>fixture(f=>{
 writeAndVerify(f);f.setPoisoned(true);
 assert.equal(f.create().verifyPersistedNativeOrder(f.row,f.tx),null);
 assert.equal(f.create().recordAfterNativeEffect(f.row).success,false);
}));
test('native repository has no new wallet, ship, or client HTTP effects',()=>{
 for(const bad of ['.moveShipToSpace(','.dockShipToLocation(','.spawnNpc(','.transferCharacterBalance(',
                   'http.createServer','createOrderArbiter('])assert.equal(src.includes(bad),false,bad);
});

function seedOriginalReturn(f){
 const row={version:1,phase:'RETURN_ISSUING',operationID:'pf84-ret-123',
  assignmentID:'asgn-1',pilotID:'coop-pilot-123',ownerCharacterID:901,
  shipItemID:2301,stationID:60000123,systemID:30000142,
  reservationGeneration:1,actorGeneration:9,typeID:600,
  requestedByAccountID:55,requestedAtMs:1700000000000,
  returnDispatchCount:1,dockDispatchCount:0};
 row.signature=f.pf56.signature(row);
 f.write(T,f.pf56.key(row.assignmentID),row);
 f.write(T,f.pf56.OPS,{version:1,operations:{
  [row.operationID]:{assignmentID:row.assignmentID,signature:row.signature,phase:'RETURN_ISSUING'}}});
 f.write('characters',String(row.ownerCharacterID),{characterID:901,accountId:55});
 f.entity.mode='WARP';f.entity.pendingWarp={destination:{x:1200,y:300,z:400}};
 return row;
}
test('PF84B original native RETURN effect is persisted with a single exact SQLite receipt',()=>fixture(f=>{
 const row=seedOriginalReturn(f),ack=f.create();
 const recorded=ack.recordAfterNativeReturnEffect(row);
 assert.equal(recorded.success,true,recorded.errorMsg);
 const proof=ack.verifyPersistedNativeReturn(row,f.tx);
 assert.equal(proof?.source,'EVEJS_ORIGINAL_PERSISTED_NPC_RETURN_V1');
 assert.equal(proof.returnOrderPersisted,true);
 assert.equal(f.read(NE,'/').entities['2301'].personalFleetReturnOrder.signature,row.signature);
 assert.equal(f.create().recordAfterNativeReturnEffect(row).success,false);
}));
test('PF84B return proof survives new service owner, but rejects a changed original account',()=>fixture(f=>{
 const row=seedOriginalReturn(f),ack=f.create();
 assert.equal(ack.recordAfterNativeReturnEffect(row).success,true);
 assert.equal(f.create().verifyPersistedNativeReturn(row,f.tx)?.returnOrderPersisted,true);
 f.write('characters','901',{characterID:901,accountId:56});
 assert.equal(f.create().verifyPersistedNativeReturn(row,f.tx),null);
}));
test('PF84B fabricated return intent cannot produce a stock NPC receipt',()=>fixture(f=>{
 const row=seedOriginalReturn(f);f.setActor(false);
 assert.equal(f.create().recordAfterNativeReturnEffect(row).success,false);
 assert.equal(f.read(T,F+'native-return-receipt-v1:'+row.operationID),null);
}));
test('PF84B no original physical warp means no durable RETURN acknowledgement',()=>fixture(f=>{
 const row=seedOriginalReturn(f);
 f.entity.mode='STOP';f.entity.pendingWarp=null;
 assert.equal(f.create().recordAfterNativeReturnEffect(row).success,false);
 assert.equal(f.read(T,F+'native-return-receipt-v1:'+row.operationID),null);
}));
test('PF84B SQLite rollback leaves no forged acceptance after unknown commit',()=>fixture(f=>{
 const row=seedOriginalReturn(f);
 f.abortNext();const ack=f.create().recordAfterNativeReturnEffect(row);
 assert.equal(ack.success,false);
 assert.match(ack.errorMsg,/UNKNOWN_NO_RETRY/);
 assert.equal(f.read(T,F+'native-return-receipt-v1:'+row.operationID),null);
 assert.equal(f.read(NE,'/').entities['2301'].personalFleetReturnOrder,undefined);
}));
test('PF84B tampered stock entity receipt is not accepted for RETURNING',()=>fixture(f=>{
 const row=seedOriginalReturn(f);assert.equal(f.create().recordAfterNativeReturnEffect(row).success,true);
 const root=f.read(NE,'/');
 root.entities['2301'].personalFleetReturnOrder.stationID=row.stationID+1;
 f.write(NE,'/',root);
 assert.equal(f.create().verifyPersistedNativeReturn(row,f.tx),null);
}));
