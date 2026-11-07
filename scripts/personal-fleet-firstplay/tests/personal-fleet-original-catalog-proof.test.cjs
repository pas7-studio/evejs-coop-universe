'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,
 '../native/coopPersonalFleetOriginalCatalogProof.js'),'utf8');
function fixture(){
 const id=3011234,corpID=1000001;
 const c={npcCharacterID:id,employerCorpID:corpID,
  profileID:'real-original-profile',shipTypeID:606,amountCents:1999};
 const wage={npcCharacterID:id,employerCorpID:corpID,
  profileID:c.profileID,shipTypeID:c.shipTypeID,
  salaryCents:450,periodMs:86400000};
 const data={character:{ownerID:id,typeID:1373,ownerName:'Native Pilot'},
  profile:{profile:{profileID:c.profileID,shipTypeID:606,
   loadoutID:'real-native-loadout',behaviorProfileID:'real-behavior'},
   loadout:{loadoutID:'real-native-loadout'},
   behaviorProfile:{behaviorProfileID:'real-behavior'}},
  corp:{corporationID:corpID,isNPC:true},
  wallet:{corporationID:corpID,wallet:{divisions:{'1000':{
   balance:100000,journal:[],transactions:[]}}}}};
 let poisoned=false,throwOnRead=false,sourcePresent=true,readCount=0,inTxn=false;
 const events=[];
 const m={exports:{}};
 const deps={
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
   isPoisoned:()=>poisoned,transact:(tables,cb)=>{
    readCount++;
    assert.deepEqual(Array.from(tables),['corporationRuntime']);
    if(throwOnRead)throw Error('STOCK_SQLITE_UNAVAILABLE');
    assert.equal(inTxn,false);
    inTxn=true;events.push('atomic-start');
    try{return cb({get:(table,key)=>{
     assert.equal(inTxn,true);
     assert.equal(table,'corporationRuntime');
     return key==='corporations\u001f'+corpID?data.wallet:null;
    }});}finally{inTxn=false;events.push('atomic-end');}
   }}},
  '../services/corporation/corporationState':{
   getNpcCharacterOwnerRecord:()=>{assert.equal(inTxn,false);events.push('sde-npc');return data.character;},
   getCorporationRecord:()=>{assert.equal(inTxn,false);events.push('sde-corp');return data.corp;},
   isNpcCorporationID:()=>sourcePresent},
  './npc/npcData':{buildNpcDefinition:()=>{
   assert.equal(inTxn,false);events.push('stock-profile');return data.profile;}}
 };
 vm.runInNewContext(source,{module:m,exports:m.exports,
  require:name=>{if(!(name in deps))throw Error('UNKNOWN_IMPORT:'+name);
   return deps[name];},Object,Array,Set,Number,Error},{filename:'pf102.js'});
 const validate=(cs=[c],ws=[wage])=>m.exports.verifyOriginalCatalogAndWages(cs,ws);
 return {id,corpID,c,wage,data,deps,validate,
  poison:()=>poisoned=true,throwRead:()=>throwOnRead=true,
  removeCorpSource:()=>sourcePresent=false,
  getReadCount:()=>readCount,events};
}
const blocked=(f,reason,cs,ws)=>{
 const result=f.validate(cs,ws);
 assert.equal(result.verified,false);
 assert.equal(result.reason,reason);
};
test('PF102 original SDE NPC + loaded profile + NPC corp wallet verifies',()=>{
 const f=fixture(),r=f.validate();
 assert.equal(r.verified,true);
 assert.equal(r.source,'ORIGINAL_EVEJS_PF102_CATALOG_PREFLIGHT_V1');
 assert.equal(r.npcCount,1);
 assert.equal(f.getReadCount(),1);
});
test('PF102 empty source catalog is not auto-populated from NPC profile DB',()=>{
 const f=fixture();blocked(f,'PF102_AUTHORED_CATALOG_AND_WAGE_PAIR_REQUIRED',[],[]);
 assert.equal(f.getReadCount(),0);
});
test('PF102 cannot hire an invented NPC character',()=>{
 const f=fixture();f.data.character=null;
 blocked(f,'PF102_ORIGINAL_SDE_NPC_CHARACTER_NOT_FOUND');
});
test('PF102 cannot hire a synthetic owner placeholder',()=>{
 const f=fixture();f.data.character.ownerName='Entity 3011234';
 blocked(f,'PF102_ORIGINAL_SDE_NPC_CHARACTER_NOT_FOUND');
});
test('PF102 original entity must be NPC character, not ship or corp',()=>{
 const f=fixture();f.data.character.typeID=2;
 blocked(f,'PF102_ORIGINAL_SDE_NPC_CHARACTER_NOT_FOUND');
});
test('PF102 immutable original NPC profile must match reserved hull',()=>{
 const f=fixture();f.data.profile.profile.shipTypeID=123;
 blocked(f,'PF102_ORIGINAL_PROFILE_OR_FITTINGS_NOT_FOUND');
});
test('PF102 rejects absent stock loadout',()=>{
 const f=fixture();f.data.profile.loadout=null;
 blocked(f,'PF102_ORIGINAL_PROFILE_OR_FITTINGS_NOT_FOUND');
});
test('PF102 rejects detached stock behavior profile',()=>{
 const f=fixture();f.data.profile.behaviorProfile.behaviorProfileID='other';
 blocked(f,'PF102_ORIGINAL_PROFILE_OR_FITTINGS_NOT_FOUND');
});
test('PF102 only native SDE NPC employer is allowed',()=>{
 const f=fixture();f.data.corp.isNPC=false;
 blocked(f,'PF102_ORIGINAL_NPC_EMPLOYER_WALLET_NOT_FOUND');
});
test('PF102 rejects original corporation that lacks native ID authority',()=>{
 const f=fixture();f.removeCorpSource();
 blocked(f,'PF102_ORIGINAL_NPC_EMPLOYER_WALLET_NOT_FOUND');
});
test('PF102 rejects missing original employer ledger',()=>{
 const f=fixture();f.data.wallet.wallet.divisions['1000'].journal=null;
 blocked(f,'PF102_ORIGINAL_NPC_EMPLOYER_WALLET_NOT_FOUND');
});
test('PF102 rejects negative native wallet balance',()=>{
 const f=fixture();f.data.wallet.wallet.divisions['1000'].balance=-2;
 blocked(f,'PF102_ORIGINAL_NPC_EMPLOYER_WALLET_NOT_FOUND');
});
test('PF102 refuses wage rate from a foreign corporation',()=>{
 const f=fixture();
 blocked(f,'PF102_IMMUTABLE_WAGE_TERMS_INVALID',[f.c],
  [{...f.wage,employerCorpID:f.corpID+1}]);
 assert.equal(f.getReadCount(),0);
});
test('PF102 wage periods must be positive bounded whole milliseconds',()=>{
 const f=fixture();
 blocked(f,'PF102_IMMUTABLE_WAGE_TERMS_INVALID',[f.c],
  [{...f.wage,periodMs:100}]);
});
test('PF102 duplicate NPC catalog entry cannot issue two hire offers',()=>{
 const f=fixture();
 blocked(f,'PF102_AUTHORED_CATALOG_AND_WAGE_PAIR_REQUIRED',
  [f.c,f.c],[f.wage]);
});
test('PF102 rejects extra arbitrary fields in sourced hire offers',()=>{
 const f=fixture();
 blocked(f,'PF102_INVALID_OR_DUPLICATE_AUTHORED_NPC',
  [{...f.c,allowFreeSalary:true}],[f.wage]);
});
test('PF102 refuses missing explicit recurring wage consent terms',()=>{
 const f=fixture();
 blocked(f,'PF102_SALARY_POLICY_NOT_ONE_TO_ONE',[f.c],
  [{...f.wage,npcCharacterID:f.id+1}]);
});
test('PF102 salary policy cannot contain caller-added rate override',()=>{
 const f=fixture();
 blocked(f,'PF102_IMMUTABLE_WAGE_TERMS_INVALID',[f.c],
  [{...f.wage,overrideAmount:1}]);
});
test('PF102 poisoned original GameStore never authorizes a launch',()=>{
 const f=fixture();f.poison();
 blocked(f,'PF102_ORIGINAL_GAMESTORE_POISONED');
 assert.equal(f.getReadCount(),0);
});
test('PF102 thrown original SQLite/SDE lookup is a deny, never readiness',()=>{
 const f=fixture();f.throwRead();
 blocked(f,'PF102_ORIGINAL_SDE_OR_SQLITE_READ_UNCERTAIN');
});
test('PF102 second original NPC requires independent exact salary mapping',()=>{
 const f=fixture(),second={...f.c,npcCharacterID:f.id+1};
 blocked(f,'PF102_SALARY_POLICY_NOT_ONE_TO_ONE',
  [f.c,second],[f.wage,{...f.wage,npcCharacterID:f.id+2}]);
});

test('PF102 stock source lookups must complete outside original SQLite transaction',()=>{
 const f=fixture(),r=f.validate();
 assert.equal(r.verified,true);
 assert.deepEqual(f.events,
  ['sde-npc','stock-profile','sde-corp','atomic-start','atomic-end']);
});
