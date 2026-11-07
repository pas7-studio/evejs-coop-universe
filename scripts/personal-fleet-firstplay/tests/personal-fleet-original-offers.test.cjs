'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createOriginalOfferAuthority,key}=require('../native/coopPersonalFleetOriginalOfferAuthority.js');
const SEP='\u001f',T='corporationRuntime',CHAR='characters';
const NPC=30001001,CORP=1000110,OWNER=90000111,OWNER2=90000222;
const ENTRY=Object.freeze({npcCharacterID:NPC,employerCorpID:CORP,profileID:'cooperative_friendly_a',shipTypeID:606,amountCents:75000});
const eRow=()=>({corporationID:CORP,wallet:{divisions:{'1000':{balance:1000,journal:[],transactions:[]}}}});
function fixture(cb,{catalog=[ENTRY]}={}){
 const db=new DatabaseSync(':memory:');
 for(const t of [T,CHAR])db.exec(`CREATE TABLE "${t}" (key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 const put=(t,k,row)=>db.prepare(`INSERT INTO "${t}" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(k,JSON.stringify(row));
 const get=(t,k)=>{const r=db.prepare(`SELECT json FROM "${t}" WHERE key=?`).get(k);return r?JSON.parse(r.json):null};
 const state={enabled:true,fenced:true,poisoned:false,time:1800000000000,originalNpc:true,originalProfile:true,originalCorporation:true,originalWallet:true,allowed:true,account:88,forceUnknown:false,sessionRevokedInside:false,paidReceiptValid:true,writes:[],poisonedTx:false};
 const session={characterID:OWNER,userid:88,socket:{destroyed:false}},
   session2={characterID:OWNER2,userid:89,socket:{destroyed:false}};
 put(CHAR,String(OWNER),{characterID:OWNER,accountId:88,balance:2000});
 put(CHAR,String(OWNER2),{characterID:OWNER2,accountId:89,balance:5000});
 put(T,'corporations'+SEP+CORP,eRow());
 const index={version:1,pilots:{},ships:{},contracts:{},processed:{}};
 put(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1',index);
 const atomic={mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>state.poisoned,transact:(tables,fn)=>{
  assert.deepEqual(tables,[T,CHAR]);db.exec('BEGIN IMMEDIATE');
  try{const result=fn({get,put:(t,k,v)=>{state.writes.push([t,k]);put(t,k,v)}});
   if(state.forceUnknown)throw Error('commit uncertain');
   db.exec('COMMIT');return result;
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }};
 const pf52={REGISTRY_KEY:'coop-personal-fleet'+SEP+'hangar-reservations-v1',validateIndex:row=>row,newIndex:()=>({version:1,pilots:{},ships:{},contracts:{},processed:{}})};
 const pf53={paidKey:op=>'coop-personal-fleet'+SEP+'paid-hire-v1:'+op,verifyPaidReceipt:()=>state.paidReceiptValid};
 const access={isOwner:()=>state.allowed};
 const originalNpcCharacters={getNpcCharacterOwnerRecord:c=>state.originalNpc&&c===NPC?
  {ownerID:NPC,ownerName:'Authored SDE Person',typeID:1373}:null};
 const originalNpcData={buildNpcDefinition:p=>state.originalProfile&&p===ENTRY.profileID?{
  profile:{profileID:p,shipTypeID:606,loadoutID:'loadout_a',behaviorProfileID:'behavior_a'},loadout:{slots:[2]},behaviorProfile:{type:'follow'}}:null};
 const originalCorporations={getCorporationRecord:c=>state.originalCorporation&&c===CORP?
  {corporationID:CORP,isNPC:true}:null,isNpcCorporationID:c=>state.originalCorporation&&c===CORP};
 const owner=createOriginalOfferAuthority({gameStore:{coopAtomicNativeRows:atomic},pf52,pf53,access,
  originalNpcCharacters,originalNpcData,originalCorporations,
  authoredCatalog:catalog,enabled:()=>state.enabled,allWalletWritersFenced:()=>state.fenced,
  clock:()=>state.time,ttlMs:15*60*1000});
 const c={ownerCharacterID:OWNER,session};
 const offers=()=>owner.listNativeOffers(c),quote=()=>offers()[0],
  lookup=(id)=>owner.lookupNativeOffer({...c,offerID:id});
 try{cb({db,get,put,index,state,session,session2,owner,offers,quote,lookup,c,pf53});}
 finally{db.close();}
}
test('offers from actual original SDE character + NPC profile + NPC corp and wallet only',()=>fixture(f=>{
 const a=f.quote();assert.equal(a.version,1);assert.equal(a.source,'ORIGINAL_EVEJS_STATIC_NPC_OFFER_V1');
 assert.equal(a.pilotID,'coop-pilot-'+NPC);assert.equal(a.agentID,NPC);assert.equal(a.amountCents,75000);
 assert.equal(a.ownerCharacterID,OWNER);assert.equal(a.employerCorpID,CORP);
 assert.equal(f.get(CHAR,String(OWNER)).balance,2000);
 assert.equal(f.get(T,'corporations'+SEP+CORP).wallet.divisions['1000'].balance,1000);
 assert.deepEqual(f.state.writes.map(x=>x[0]),[T]);
}));
test('list is idempotent while offer unexpired',()=>fixture(f=>{
 const a=f.quote(),b=f.quote();assert.deepEqual(a,b);assert.equal(f.state.writes.length,1);
}));
test('retrieving existing offer checks one original durable row',()=>fixture(f=>{
 const a=f.quote();assert.deepEqual(f.lookup(a.offerID),a);assert.equal(f.state.writes.length,1);
}));
test('expired unpaid offer rotates revision and unique contract ID',()=>fixture(f=>{
 const a=f.quote();f.state.time=a.expiresAtMs+1;
 const b=f.quote();assert.equal(b.revision,2);assert.notEqual(b.contractID,a.contractID);
 assert.equal(b.offerID,a.offerID);
}));
test('PF53 can resolve an exact authorized server offer inside its original tx',()=>fixture(f=>{
 const o=f.quote();const cmd={session:f.session,ownerCharacterID:OWNER,offerID:o.offerID,
  offerRevision:o.revision,agentID:o.agentID,pilotID:o.pilotID,contractID:o.contractID};
 const r=f.db.prepare(`SELECT json FROM "${T}" WHERE key=?`).get(key(o.offerID));assert.ok(r);
 const read={get:f.get};
 assert.deepEqual(f.owner.resolveNativeOffer(cmd,read),o);
 assert.equal(f.owner.verifyOriginalNpcPilot(cmd,o,read),true);
 assert.equal(f.owner.verifyNativeEmployer(cmd,o,eRow(),read),true);
}));
test('does not offer a pilot already hired via PF52 original index',()=>fixture(f=>{
 const i=f.get(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1');i.pilots['coop-pilot-'+NPC]={contractID:'mine'};
 f.put(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1',i);
 assert.deepEqual(f.offers(),[]);assert.equal(f.state.writes.length,0);
}));
test('paid historical contract is not silently reoffered after dismissal',()=>fixture(f=>{
 const a=f.quote(),i=f.get(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1');
 i.processed['pf-uuid']={receipt:{type:'HIRED',pilotID:a.pilotID,contractID:a.contractID}};
 f.put(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1',i);
 f.put(T,f.pf53.paidKey('pf-uuid'),{status:'PAID'});
 assert.deepEqual(f.offers(),[]);
}));
test('a tampered or missing historical paid PF53 receipt poisons new offers',()=>fixture(f=>{
 const a=f.quote(),i=f.get(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1');
 i.processed['pf-uuid']={receipt:{type:'HIRED',pilotID:a.pilotID,contractID:a.contractID}};
 f.put(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1',i);
 assert.deepEqual(f.offers(),[]);
 f.put(T,f.pf53.paidKey('pf-uuid'),{status:'PAID'});f.state.paidReceiptValid=false;
 assert.deepEqual(f.offers(),[]);
}));
test('refuses mismatched original owner account',()=>fixture(f=>{
 f.session.userid=101;assert.deepEqual(f.offers(),[]);assert.equal(f.state.writes.length,0);
}));
test('refuses a closed socket',()=>fixture(f=>{
 f.session.socket.destroyed=true;assert.deepEqual(f.offers(),[]);
}));
test('refuses revoked ownership',()=>fixture(f=>{
 f.state.allowed=false;assert.deepEqual(f.offers(),[]);
}));
test('refuses disabled native offer gate',()=>fixture(f=>{
 f.state.enabled=false;assert.deepEqual(f.offers(),[]);
}));
test('refuses missing reciprocal native wallet writer fence',()=>fixture(f=>{
 f.state.fenced=false;assert.deepEqual(f.offers(),[]);
}));
test('refuses poisoned GameStore',()=>fixture(f=>{
 f.state.poisoned=true;assert.deepEqual(f.offers(),[]);
}));
test('does not issue for unavailable original NPC person',()=>fixture(f=>{
 f.state.originalNpc=false;assert.deepEqual(f.offers(),[]);
}));
test('does not issue for missing authored NPC loadout/behavior',()=>fixture(f=>{
 f.state.originalProfile=false;assert.deepEqual(f.offers(),[]);
}));
test('does not issue for missing genuine original NPC corporation',()=>fixture(f=>{
 f.state.originalCorporation=false;assert.deepEqual(f.offers(),[]);
}));
test('does not issue when NPC employer real wallet missing',()=>fixture(f=>{
 f.put(T,'corporations'+SEP+CORP,{corporationID:CORP});assert.deepEqual(f.offers(),[]);
}));
test('quote for owner1 is never accepted for owner2',()=>fixture(f=>{
 const offer=f.quote();assert.equal(f.owner.lookupNativeOffer({session:f.session2,ownerCharacterID:OWNER2,offerID:offer.offerID}),null);
}));
test('foreign session cannot cause quote for other owner',()=>fixture(f=>{
 assert.deepEqual(f.owner.listNativeOffers({session:f.session2,ownerCharacterID:OWNER}),[]);
}));
test('tampering persisted source proof denies lookup/renewal',()=>fixture(f=>{
 const offer=f.quote(),bad={...offer,sourceProof:'0'.repeat(64)};
 f.put(T,key(offer.offerID),bad);assert.equal(f.lookup(offer.offerID),null);assert.deepEqual(f.offers(),[]);
}));
test('tampering amount/price denies lookup or reissuance',()=>fixture(f=>{
 const offer=f.quote();f.put(T,key(offer.offerID),{...offer,amountCents:1});
 assert.equal(f.lookup(offer.offerID),null);assert.deepEqual(f.offers(),[]);
}));
test('stale offer revision rejected for PF53 hire',()=>fixture(f=>{
 const offer=f.quote();const command={session:f.session,ownerCharacterID:OWNER,offerID:offer.offerID,
  offerRevision:3,agentID:NPC,pilotID:offer.pilotID,contractID:offer.contractID};
 assert.equal(f.owner.resolveNativeOffer(command,{get:f.get}),null);
}));
test('expired quote denied from PF53 without refresh',()=>fixture(f=>{
 const o=f.quote();f.state.time=o.expiresAtMs;
 assert.equal(f.lookup(o.offerID),null);
 assert.equal(f.owner.resolveNativeOffer({session:f.session,ownerCharacterID:OWNER,
  offerID:o.offerID,offerRevision:o.revision,agentID:o.agentID,
  pilotID:o.pilotID,contractID:o.contractID},{get:f.get}),null);
}));
test('cannot manufacture character from a profile without a real NPC SDE owner',()=>fixture(f=>{
 f.state.originalNpc=false;assert.equal(f.lookup('pf-offer-'+OWNER+'-'+NPC),null);
}));
test('inconsistent transaction acknowledgment is never shown as valid offer',()=>fixture(f=>{
 f.state.forceUnknown=true;assert.deepEqual(f.offers(),[]);
 assert.equal(f.get(T,key('pf-offer-'+OWNER+'-'+NPC)),null);
}));
test('catalog empty by default: no synthetic pilots',()=>fixture(f=>{
 assert.deepEqual(f.offers(),[]);
},{catalog:[]}));
test('rejects duplicate authored original NPC identities at startup',()=>{
 assert.throws(()=>fixture(()=>{}, {catalog:[ENTRY,ENTRY]}),/AUTHORITIES_REQUIRED/);
});
test('rejects negative or non-integer money in config',()=>{
 assert.throws(()=>fixture(()=>{}, {catalog:[{...ENTRY,amountCents:12.5}]}),/AUTHORITIES_REQUIRED/);
});
test('rejects unexpected caller control fields in authored catalog',()=>{
 assert.throws(()=>fixture(()=>{}, {catalog:[{...ENTRY,source:'INJECTED'}]}),/AUTHORITIES_REQUIRED/);
});
test('authoring source snapshot cannot be changed by caller after construction',()=>{
 const source=[{...ENTRY}];fixture(f=>{const q=f.quote();source[0].amountCents=1;
  assert.equal(f.lookup(q.offerID).amountCents,75000);
 },{catalog:source});
});
test('PF53 atomic offer verification refuses invalid original native clock',()=>fixture(f=>{
 const o=f.quote();f.state.time=NaN;
 const command={session:f.session,ownerCharacterID:OWNER,offerID:o.offerID,
  offerRevision:o.revision,agentID:o.agentID,pilotID:o.pilotID,contractID:o.contractID};
 assert.equal(f.owner.resolveNativeOffer(command,{get:f.get}),null);
}));
test('PF53 atomic offer verification refuses a changed original SDE profile after quote',()=>fixture(f=>{
 const o=f.quote(),cmd={session:f.session,ownerCharacterID:OWNER,offerID:o.offerID,
  offerRevision:o.revision,agentID:o.agentID,pilotID:o.pilotID,contractID:o.contractID};
 f.state.originalProfile=false;
 assert.equal(f.owner.resolveNativeOffer(cmd,{get:f.get}),null);
}));
test('source-bound factory lazy-loads only original EveJS corporation and NPC-data owners',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const code=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalOfferAuthority.js'),'utf8');
 const names=[];const fake={getNpcCharacterOwnerRecord:()=>null,getCorporationRecord:()=>null,isNpcCorporationID:()=>false};
 const sandbox={module:{exports:{}},process,require:n=>{
  names.push(n);
  if(n==='node:crypto')return require('node:crypto');
  if(n==='node:util')return require('node:util');
  if(n==='../services/corporation/corporationState')return fake;
  if(n==='./npc/npcData')return {buildNpcDefinition:()=>null};
  throw Error('UNAUTHORIZED_SOURCE_MODULE '+n);
 },structuredClone};
 vm.runInNewContext(code,sandbox,{filename:'coopPersonalFleetOriginalOfferAuthority.js'});
 assert.deepEqual(names,['node:crypto','node:util']);
 assert.throws(()=>sandbox.module.exports.createSourceBoundOriginalOfferAuthority({}),/AUTHORITIES_REQUIRED/);
 assert.deepEqual(names.slice(2),['../services/corporation/corporationState','./npc/npcData']);
});
function withPaid(f){
 const offer=f.quote(),op='pf-uuid-1';
 const ix=f.get(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1');
 ix.pilots[offer.pilotID]={pilotID:offer.pilotID,ownerCharacterID:OWNER,
  contractID:offer.contractID,hireReceiptHash:'digest-paid'};
 ix.processed[op]={receipt:{type:'HIRED',pilotID:offer.pilotID,
  contractID:offer.contractID},signature:'receipt'};
 f.put(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1',ix);
 const paid={status:'PAID',operationID:op,offerID:offer.offerID,offerRevision:offer.revision,
  pilotID:offer.pilotID,contractID:offer.contractID,ownerCharacterID:OWNER,
  employerCorpID:offer.employerCorpID,amountCents:offer.amountCents,
  hireReceiptHash:'digest-paid'};
 f.put(T,f.pf53.paidKey(op),paid);
 return {offer,op,paid};
}
test('hired pilot accepts ONLY exact authored original physical ship type',()=>fixture(f=>{
 const {offer}=withPaid(f);const command={session:f.session,ownerCharacterID:OWNER,
  pilotID:offer.pilotID,shipTypeID:606};
 assert.equal(f.owner.verifyHiredPilotHull(command),true);
 assert.equal(f.owner.verifyHiredPilotHull({...command,shipTypeID:607}),false);
}));
test('hired original native profile is resolved only from paid PF53 receipt',()=>fixture(f=>{
 const {offer}=withPaid(f);
 const def=f.owner.resolvePaidNativeProfile({ownerCharacterID:OWNER,
  shipItemID:2001,contractID:offer.contractID,pilotID:offer.pilotID,typeID:606});
 assert.equal(def.profile.profileID,ENTRY.profileID);
 assert.equal(def.profile.shipTypeID,606);
}));
test('adoption refuses mismatched original hull ship type even if NPC was hired',()=>fixture(f=>{
 const {offer}=withPaid(f);
 assert.equal(f.owner.resolvePaidNativeProfile({ownerCharacterID:OWNER,shipItemID:2001,
  contractID:offer.contractID,pilotID:offer.pilotID,typeID:607}),null);
}));
test('original native actor cannot adopt an unpaid NPC contract',()=>fixture(f=>{
 const offer=f.quote();assert.equal(f.owner.resolvePaidNativeProfile({ownerCharacterID:OWNER,
  shipItemID:2001,contractID:offer.contractID,pilotID:offer.pilotID,typeID:606}),null);
}));
test('tampered original PF53 payment blocks physical actor and spare hull assignment',()=>fixture(f=>{
 const {offer}=withPaid(f);f.state.paidReceiptValid=false;
 assert.equal(f.owner.verifyHiredPilotHull({session:f.session,ownerCharacterID:OWNER,
  pilotID:offer.pilotID,shipTypeID:606}),false);
 assert.equal(f.owner.resolvePaidNativeProfile({ownerCharacterID:OWNER,
  shipItemID:2001,contractID:offer.contractID,pilotID:offer.pilotID,typeID:606}),null);
}));
test('hired original pilot cannot be assigned by another account',()=>fixture(f=>{
 const {offer}=withPaid(f);
 assert.equal(f.owner.verifyHiredPilotHull({session:f.session2,ownerCharacterID:OWNER2,
  pilotID:offer.pilotID,shipTypeID:606}),false);
}));
test('hired pilot cannot be assigned with stale owner registry/contract',()=>fixture(f=>{
 const {offer}=withPaid(f);
 const ix=f.get(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1');
 ix.pilots[offer.pilotID].contractID='wrong';
 f.put(T,'coop-personal-fleet'+SEP+'hangar-reservations-v1',ix);
 assert.equal(f.owner.verifyHiredPilotHull({session:f.session,ownerCharacterID:OWNER,
  pilotID:offer.pilotID,shipTypeID:606}),false);
}));
test('hired actor refuses profile drift after PF53 payment',()=>fixture(f=>{
 const {offer}=withPaid(f);f.state.originalProfile=false;
 assert.equal(f.owner.resolvePaidNativeProfile({ownerCharacterID:OWNER,shipItemID:2001,
  contractID:offer.contractID,pilotID:offer.pilotID,typeID:606}),null);
}));
test('hired profile rejects wrong native contract ID even when ship ID matches',()=>fixture(f=>{
 const {offer}=withPaid(f);
 assert.equal(f.owner.resolvePaidNativeProfile({ownerCharacterID:OWNER,shipItemID:2001,
  contractID:'pf-foreign',pilotID:offer.pilotID,typeID:606}),null);
}));
test('source authored NPC has to be eligible for original ship type before quote',()=>fixture(f=>{
 const a={...ENTRY,shipTypeID:607};
 assert.deepEqual(f.offers(),[]);
}, {catalog:[{...ENTRY,shipTypeID:607}]}));
