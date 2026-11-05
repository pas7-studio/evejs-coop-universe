'use strict';
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const pf52=require('../deps/pf52-reference-hangar.cjs');
const pf53=require('../deps/pf53-reference-paid-hiring.cjs');
const pf54=require('../native/coopPersonalFleetOriginalDeployment.cjs');
const OWNER=90000001,EMPLOYER=1000110,AGENT=300001,PILOT='coop-pilot-123';
const SHIP=2001,STATION=600001,SYSTEM=30000142,ASSIGNMENT='pf54-assignment-1';
const H=(s)=>createHash('sha256').update(s).digest('hex');
const FIT=H('real-original-fittings-v1'),CARGO=H('real-original-cargo-v1');
const OFFER={offerID:'pf54-offer-1',revision:1,contractID:'pf54-contract-1',pilotID:PILOT,
 agentID:AGENT,ownerCharacterID:OWNER,employerCorpID:EMPLOYER,amountCents:150000,
 expiresAtMs:2000000000000};
const session={characterID:OWNER,userid:55,socket:{destroyed:false}};
function command(extra={}){return {operationID:'pf54-deploy-1',assignmentID:ASSIGNMENT,
 ownerCharacterID:OWNER,pilotID:PILOT,shipItemID:SHIP,stationID:STATION,
 systemID:SYSTEM,expectedGeneration:1,expectedRosterRevision:2,expectedPilotRevision:1,
 session,...extra};}
const claimsPolicy={KEY:'coop-personal-fleet\u001factor-claims-v1',empty(){return {version:1,claims:{},generations:{},processed:{}}},
 validate(v){if(!v||v.version!==1||!v.claims||!v.generations||!v.processed||
 [v.claims,v.generations,v.processed].some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('CLAIM_CORRUPT');
 const pilots=new Set();for(const [key,c] of Object.entries(v.claims)){
 if(!Number.isSafeInteger(Number(key))||Number(key)<=0||String(Number(key))!==key||
 c.entityID!==Number(key)||c.ownerType!=='PERSONAL_FLEET'||
 !/^coop-pilot-\d{3,}$/.test(c.pilotID)||pilots.has(c.pilotID)||
 !Number.isSafeInteger(c.generation)||c.generation<=0||
 v.generations[key]<c.generation)throw Error('CLAIM_CORRUPT');pilots.add(c.pilotID);}
 return v;}};
function tempDb(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf54-'));
 return {dir,file:path.join(dir,'native.sqlite'),cleanup(){fs.rmSync(dir,{recursive:true,force:true})}};}
function open(file,options={}){
 const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');
 const tables=new Set(['characters','corporationRuntime','npcEntities','items']);
 for(const t of tables)db.exec('CREATE TABLE IF NOT EXISTS "'+t+'" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
 const table=t=>{if(!tables.has(t))throw Error('UNDECLARED_TABLE');return '"'+t+'"'};
 const get=(t,k)=>{const r=db.prepare('SELECT json FROM '+table(t)+' WHERE key=?').get(k);return r?JSON.parse(r.json):null};
 const put=(t,k,v)=>db.prepare('INSERT INTO '+table(t)+'(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,JSON.stringify(v));
 const scan=t=>db.prepare('SELECT key,json FROM '+table(t)).all().map(x=>({key:x.key,value:JSON.parse(x.json)}));
 const shared={enabled:true,writers:true,auth:true,authority:true,exclusive:true,native:true,spawnCount:0,
 scene:null,offer:{...OFFER},fittingHash:FIT,cargoHash:CARGO,txid:1793884000001,clock:1793884000000,
 attemptStatus:'COMPLETED',onHandoff:null,onTx:null,failAfterPut:null};
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,transact(ts,callback){
  if(!ts.every(t=>tables.has(t))||new Set(ts).size!==ts.length)throw Error('UNDECLARED_TABLE');
  db.exec('BEGIN IMMEDIATE');let n=0;
  try{
   const tx={get,scan,put(t,k,v){put(t,k,v);n++;if(shared.failAfterPut===n)throw Error('FAULT_DURING_TX');}};
   if(typeof shared.onTx==='function')shared.onTx(tx,ts);
   const result=callback(tx);
   if(result&&typeof result.then==='function')throw Error('ASYNC_FORBIDDEN');
   db.exec('COMMIT');return result;
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }};
 const gameStore={coopAtomicNativeRows:atomic};
 const access={isOwner(s,o){return shared.auth&&s?.characterID===o&&s.userid===55;}};
 const hiring=pf53.createPersonalFleetPaidHiring({gameStore,pf52,access,
  resolveNativeOffer:()=>shared.offer,
  verifyOriginalNpcPilot(c,offer,tx){return shared.native&&tx.get('npcEntities','npcEntities')?.pilots?.[c.pilotID]?.available===true;},
  verifyNativeEmployer:(c,offer,corp)=>shared.native&&corp.isNPC===true,
  verifyJournalID:({transactionID})=>transactionID===shared.txid,
  originalTransactionID:()=>shared.txid,notifyOriginalWallet:()=>true,
  allWalletWritersFenced:()=>shared.writers,enabled:()=>shared.enabled,clock:()=>shared.clock});
 const hangar=pf52.createPersonalFleetHangarBridge({gameStore,access,
  enabled:()=>shared.enabled,allWritersFenced:()=>shared.writers,
  verifyPaidHire:()=>true,verifyShipAvailable:()=>shared.authority,verifyRelease:()=>true});
 const deps={gameStore,pf52,claimsPolicy,access,
  verifyOriginalEquipment(){return shared.authority?{fittingHash:shared.fittingHash,cargoHash:shared.cargoHash}:null},
  verifyOriginalDeploymentAuthority(){return shared.authority},
  verifyExclusiveOwnership(){return shared.exclusive},
  executeOriginalHandoff(row){
   shared.spawnCount++;
   if(shared.onHandoff)return shared.onHandoff(row,{db,get,put,atomic,shared});
   if(!shared.native)throw Error('NATIVE_SHIP_HANDOFF_FAILED');
   atomic.transact(['items'],tx=>{
    const items=tx.get('items','items'),hull=items[String(row.shipItemID)];
    tx.put('items','items',{...items,[String(row.shipItemID)]:{...hull,flagID:0,locationID:row.systemID,
     spaceState:{systemID:row.systemID,position:{x:10,y:20,z:30},velocity:{x:0,y:0,z:0},mode:'STOP'}}});
   });
   shared.scene={nativeNpc:true,shipItemID:row.shipItemID,entityID:row.shipItemID,
    controllerEntityID:row.shipItemID,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,systemID:row.systemID,assignmentID:row.assignmentID,
    generation:row.generation,alive:true,noDuplicatePhysicalEntity:true,
    fittingHash:shared.fittingHash,cargoHash:shared.cargoHash};
   return {status:shared.attemptStatus};
  },
  verifyOriginalActor(row){const s=shared.scene;if(!s||!shared.native)return null;
   return {source:'ORIGINAL_EVEJS_NATIVE_PROOF_V1',originalShipItemID:s.shipItemID,
    nativeEntityID:s.entityID,nativeControllerEntityID:s.controllerEntityID,
    ownerCharacterID:s.ownerCharacterID,pilotID:s.pilotID,systemID:s.systemID,
    assignmentID:s.assignmentID,generation:s.generation,
    alive:s.alive,noDuplicatePhysicalEntity:s.noDuplicatePhysicalEntity,
    fittingHash:s.fittingHash,cargoHash:s.cargoHash};},
  allWritersFenced:()=>shared.writers,enabled:()=>shared.enabled,clock:()=>shared.clock};
 Object.assign(deps,options);
 const bridge=pf54.createOriginalDeploymentBridge(deps);
 function seed(){put('characters','characters',{[OWNER]:{characterID:OWNER,balance:5000,walletJournal:[]}});
  put('corporationRuntime','corporations\u001f'+EMPLOYER,{corporationID:EMPLOYER,isNPC:true,
   wallet:{divisions:{'1000':{balance:800,journal:[],transactions:[]}}}});
  put('npcEntities','npcEntities',{pilots:{[PILOT]:{available:true,pilotID:PILOT,agentID:AGENT}}});
  put('items','items',{[SHIP]:{itemID:SHIP,shipID:SHIP,shipTypeID:606,typeID:606,
   ownerID:OWNER,locationID:STATION,flagID:4,categoryID:6,singleton:1,stacksize:1,
   quantity:-1,spaceState:null}});
 }
 function onboard(){const hire=hiring.hire({operationID:'pf54-hire-1',offerID:OFFER.offerID,
  offerRevision:OFFER.revision,contractID:OFFER.contractID,pilotID:PILOT,agentID:AGENT,
  ownerCharacterID:OWNER,expectedRosterRevision:0,session});
  if(hire.status!=='APPLIED')throw Error('HIRE_FAILED '+JSON.stringify(hire));
  const reserved=hangar.execute({type:'RESERVE_HANGAR_SHIP',operationID:'pf54-reserve-1',
   pilotID:PILOT,ownerCharacterID:OWNER,session,shipItemID:SHIP,stationID:STATION,
   assignmentID:ASSIGNMENT,expectedRosterRevision:1,expectedPilotRevision:0});
  if(reserved.status!=='APPLIED')throw Error('RESERVE_FAILED '+JSON.stringify(reserved));
 }
 return {db,get,put,scan,gameStore,shared,deps,bridge,seed,onboard,hiring,hangar,close(){db.close()}};
}
module.exports={open,tempDb,command,session,OWNER,EMPLOYER,AGENT,PILOT,SHIP,STATION,SYSTEM,ASSIGNMENT,H,FIT,CARGO,claimsPolicy,pf52,pf53,pf54};