'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const content=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalDurableHandoffReadback.cjs'),'utf8');
const T='corporationRuntime',P='coop-personal-fleet\u001f';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(run){
 const db=new DatabaseSync(':memory:');
 for(const t of [T,'items','characters'])db.exec(`CREATE TABLE "${t}" (key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 const put=(t,k,obj)=>db.prepare(`INSERT INTO "${t}" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(k,JSON.stringify(obj));
 const del=(t,k)=>db.prepare(`DELETE FROM "${t}" WHERE key=?`).run(k);
 const get=(t,k)=>{const r=db.prepare(`SELECT json FROM "${t}" WHERE key=?`).get(k);return r?JSON.parse(r.json):null};
 const scan=t=>db.prepare(`SELECT key,json FROM "${t}"`).all().map(r=>({key:r.key,value:JSON.parse(r.json)}));
 const row={version:1,phase:'ISSUING',dispatchCount:1,operationID:'deploy-1',assignmentID:'assignment-1',pilotID:'coop-pilot-123',contractID:'contract-1',shipItemID:2001,ownerCharacterID:90000001,stationID:600001,systemID:30000142,typeID:606,generation:1,fittingHash:sha('fit'),cargoHash:sha('cargo')};
 const permit={version:1,status:'CONSUMED',operationID:row.operationID,assignmentID:row.assignmentID,shipItemID:row.shipItemID,
  ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,stationID:row.stationID,systemID:row.systemID,generation:row.generation,sourcePF54Hash:sha(row),fittingHash:row.fittingHash,cargoHash:row.cargoHash,consumedAtMs:1800000000000};
 const lock={assignmentID:row.assignmentID,sourcePF54Hash:sha(row)};
 const ownerChar={characterID:90000001,accountId:55,shipID:2010,shipTypeID:670,shipName:'Capsule',stationID:600001,structureID:null,balance:777};
 const source={itemID:2001,ownerID:90000001,categoryID:6,singleton:1,typeID:606,locationID:30000142,flagID:0,quantity:-1,stacksize:1,spaceState:{systemID:30000142,position:{x:1,y:2,z:3},direction:{x:1,y:0,z:0}}};
 const capsule={itemID:2010,ownerID:90000001,categoryID:6,singleton:1,typeID:670,locationID:600001,flagID:4,quantity:-1,stacksize:1,itemName:'Capsule',spaceState:null};
 put(T,P+'deploy-v1:'+row.assignmentID,row);put(T,P+'handoff-v1:'+row.assignmentID,permit);
 put(T,P+'handoff-ship-v1:'+row.shipItemID,lock);
 put('characters','90000001',ownerChar);put('items','items',{'2001':source,'2010':capsule});
 const shared={poisoned:false,throws:false,writeCount:0};
 const store={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>shared.poisoned,
  transact(tables,fn){assert.deepEqual(tables,[T,'characters','items']);
   db.exec('BEGIN IMMEDIATE');try{
    const result=fn({get,scan,put(){shared.writeCount++;throw Error('READ_ONLY_INSPECTOR_WROTE')}});
    if(shared.throws)throw Error('UNKNOWN_COMMIT');
    db.exec('COMMIT');return result;
   }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
  }}};
 const validStockSpace=(x,r)=>!!x&&x.itemID===r.shipItemID&&x.ownerID===r.ownerCharacterID&&x.typeID===r.typeID&&x.categoryID===6&&x.flagID===0&&x.locationID===r.systemID&&x.spaceState?.systemID===r.systemID;
 const handoff={validPF54:r=>!!r&&r.version===1&&r.phase==='ISSUING'&&r.dispatchCount===1,
  key:id=>P+'handoff-v1:'+id,shipKey:id=>P+'handoff-ship-v1:'+id,validStockSpace};
 const validReplacement=(x,owner,station)=>!!x&&x.itemID===2010&&x.ownerID===owner&&x.typeID===670&&x.categoryID===6&&x.flagID===4&&x.locationID===station&&x.singleton===1&&x.stacksize===1&&x.quantity===-1&&(x.spaceState===null||x.spaceState===undefined);
 const mod={exports:{}};new Function('require','module','exports',content)((name)=>{
  if(name==='node:crypto')return require('node:crypto');
  if(name==='node:util')return require('node:util');
  if(name==='./coopPersonalFleetOriginalShipHandoff.cjs')return handoff;
  if(name==='./coopPersonalFleetOriginalAtomicSwitchAndHandoff.cjs')return {validReplacement};
  throw Error('UNEXPECTED_IMPORT:'+name);
 },mod,mod.exports);
 const inspector=mod.exports.createOriginalDurableHandoffInspector({gameStore:store});
 const request={assignmentID:row.assignmentID,ownerCharacterID:row.ownerCharacterID,oldShipItemID:2001,replacementShipItemID:2010};
 const inspect=()=>inspector.inspect(request);
 try{run({db,put,get,scan,del,row,permit,lock,ownerChar,source,capsule,request,inspect,shared});}
 finally{db.close();}
}
const ok='DURABLE_PLAYER_RELEASE_AND_HULL_TRANSFER_CONFIRMED';
function denial(change,reason){fixture(s=>{change(s);const result=s.inspect();assert.equal(result.status,'UNVERIFIED');assert.equal(result.reason,reason);assert.equal(s.shared.writeCount,0);});}
test('PF100C independently verifies committed player capsule, old hull and one-shot permit',()=>fixture(s=>{
 const result=s.inspect();assert.equal(result.status,ok);
 assert.equal(result.maySpawn,false);assert.equal(result.mayPublish,false);
 assert.equal(result.mayRetryAutomatically,false);assert.equal(s.shared.writeCount,0);
}));
test('PF100C no durable operation is not a replay receipt',()=>fixture(s=>{
 s.del(T,P+'deploy-v1:'+s.row.assignmentID);s.del(T,P+'handoff-v1:'+s.row.assignmentID);s.del(T,P+'handoff-ship-v1:'+s.row.shipItemID);
 assert.equal(s.inspect().status,'NO_MATCHING_DURABLE_OPERATION');
}));
test('PF100C refuses missing permit',()=>denial(s=>s.del(T,P+'handoff-v1:'+s.row.assignmentID),'PF100C_DURABLE_PERMIT_CONFLICT'));
test('PF100C refuses consumed permit with wrong operation',()=>denial(s=>s.put(T,P+'handoff-v1:'+s.row.assignmentID,{...s.permit,operationID:'other'}),'PF100C_DURABLE_PERMIT_CONFLICT'));
test('PF100C refuses consumed permit with wrong source hash',()=>denial(s=>s.put(T,P+'handoff-v1:'+s.row.assignmentID,{...s.permit,sourcePF54Hash:'0'.repeat(64)}),'PF100C_DURABLE_PERMIT_CONFLICT'));
test('PF100C refuses mismatched one-shot ship lock',()=>denial(s=>s.put(T,P+'handoff-ship-v1:'+s.row.shipItemID,{...s.lock,assignmentID:'other'}),'PF100C_DURABLE_PERMIT_CONFLICT'));
test('PF100C refuses changed deploy receipt',()=>denial(s=>s.put(T,P+'deploy-v1:'+s.row.assignmentID,{...s.row,generation:2}),'PF100C_DURABLE_PERMIT_CONFLICT'));
test('PF100C refuses stale player still in old hull',()=>denial(s=>s.put('characters','90000001',{...s.ownerChar,shipID:2001}),'PF100C_CHARACTER_OR_PHYSICAL_TITLE_DIVERGED'));
test('PF100C refuses source hull back in hangar',()=>denial(s=>s.put('items','items',{'2001':{...s.source,locationID:600001,flagID:4},'2010':s.capsule}),'PF100C_CHARACTER_OR_PHYSICAL_TITLE_DIVERGED'));
test('PF100C refuses replacement capsule with wrong owner',()=>denial(s=>s.put('items','items',{'2001':s.source,'2010':{...s.capsule,ownerID:999}}),'PF100C_CHARACTER_OR_PHYSICAL_TITLE_DIVERGED'));
test('PF100C refuses another active player using the old NPC hull',()=>denial(s=>s.put('characters','90000002',{characterID:90000002,shipID:2001}),'PF100C_COMPETING_PLAYER_SHIP_TITLE'));
test('PF100C refuses another active player using capsule',()=>denial(s=>s.put('characters','90000002',{characterID:90000002,shipID:2010}),'PF100C_COMPETING_PLAYER_SHIP_TITLE'));
test('PF100C refuses conflicting player active ship aliases',()=>denial(s=>s.put('characters','90000001',{...s.ownerChar,shipid:2001}),'PF100C_CHARACTER_SHIP_ALIASES_INVALID'));
test('PF100C refuses noncanonical character rowset',()=>denial(s=>s.put('characters','0009',{shipID:999}),'PF100C_INVALID_CHARACTER_ROWSET'));
test('PF100C refuses poisoned GameStore',()=>denial(s=>{s.shared.poisoned=true;},'PF100C_GAMESTORE_POISONED'));
test('PF100C refuses uncertain read-only COMMIT outcome',()=>denial(s=>{s.shared.throws=true;},'PF100C_ORIGINAL_READ_OR_COMMIT_OUTCOME_UNKNOWN'));
test('PF100C rejects invalid identifiers',()=>denial(s=>{s.request.assignmentID='';},'PF100C_IDENTIFIERS_INVALID'));
test('PF100C refuses character shipName divergent from original capsule',()=>denial(s=>s.put('characters','90000001',{...s.ownerChar,shipName:'Forged'}),'PF100C_CHARACTER_OR_PHYSICAL_TITLE_DIVERGED'));
