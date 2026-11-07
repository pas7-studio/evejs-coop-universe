'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,
 '../native/coopPersonalFleetOriginalAuthoredPolicy.js'),'utf8');
const ROOT='/work/Code',STATIC=path.join(ROOT,'data',
 'eve-online-static-data-20261108-jsonl');
const CORP=1000017,CHAR=3011234,SHIP=606,PROFILE='genuine-pilot';
function fixture({missingSde=false,wrongCorp=false,missingNpc=false,
 wrongCategory=false,wrongProfile=false,noPlayerHull=false,
 corruptStatic=false,duplicates=false,unknownCharacter=false,
 emptyProfile=false,profileKind='npc'}={}){
 const events=[],writes=[];
 const npcCharacter={_key:CHAR,corporationID:wrongCorp?1000019:CORP,
  name:{en:'Authentic SDE Pilot'}};
 const npcCorp={_key:CORP,name:{en:'Authentic NPC Corporation'}};
 const p={profileID:PROFILE,entityType:profileKind,shipTypeID:SHIP,
  corporationID:CORP,loadoutID:'original-fit',behaviorProfileID:'original-behavior'};
 const def={profile:{...p},loadout:{loadoutID:'original-fit',
  modules:[],charges:[]},behaviorProfile:{behaviorProfileID:'original-behavior'}};
 const readFile=(file)=>{
  events.push(['sde-read',file]);
  if(file.endsWith('npcCorporations.jsonl'))
   return corruptStatic?'{invalid\n':JSON.stringify(npcCorp)+'\n';
  if(file.endsWith('npcCharacters.jsonl'))
   return (duplicates?[npcCharacter,npcCharacter]:[npcCharacter])
    .map(x=>JSON.stringify(x)).join('\n')+'\n';
  throw Error('SOURCE_READ_FORBIDDEN:'+file);
 };
 const realFS={
  statSync(file){
   if(file===path.join(ROOT,'data'))return {isDirectory:()=>true};
   if(file===path.join(ROOT,'_local','sde'))throw Error('NO_LOCAL_SDE');
   if(file===path.join(STATIC,'npcCorporations.jsonl')||
      file===path.join(STATIC,'npcCharacters.jsonl')){
    if(missingSde)throw Error('SDE_NOT_INSTALLED');
    return {isFile:()=>true};
   }
   throw Error('NOT_STOCK:'+file);
  },
  readdirSync(dir){
   if(dir!==path.join(ROOT,'data'))throw Error('INVALID_DIRECTORY');
   return [{name:path.basename(STATIC),isDirectory:()=>true}];
  },
  lstatSync(file){return {isSymbolicLink:()=>false};},
  readFileSync:readFile
 };
 const npcData={
  listNpcProfiles(){events.push(['npc-profiles']);return emptyProfile?[]:[p]},
  buildNpcDefinition(id){events.push(['npc-definition',id]);
   return wrongProfile?{...def,profile:{...p,shipTypeID:40}}:def;}
 };
 const corpSource={
  getNpcCharacterOwnerRecord(id){events.push(['source-character',id]);
   return unknownCharacter?null:{ownerID:id,typeID:1373,ownerName:'Authentic SDE Pilot'};},
  getCorporationRecord(id){events.push(['source-corp',id]);
   return missingNpc?null:{corporationID:id,isNPC:true};},
  isNpcCorporationID:id=>id===CORP
 };
 const stockItems={resolveItemByTypeID:id=>{
  events.push(['stock-type',id]);
  return noPlayerHull?null:{typeID:id,categoryID:wrongCategory?11:6};
 }};
 const deps={
  'node:fs':realFS,'node:path':path,
  './npc/npcData':npcData,
  '../services/corporation/corporationState':corpSource,
  '../services/inventory/itemTypeRegistry':stockItems
 };
 const m={exports:{}};
 function run(){
  vm.runInNewContext(source,{require:name=>{
   if(!(name in deps))throw Error('UNAUTHORIZED_SOURCE_IMPORT:'+name);
   return deps[name];},module:m,exports:m.exports,
   __dirname:'/work/Code/server/src/space',
   Object,Array,Set,Map,Number,Error,JSON},{filename:'pf104.js'});
  return m.exports;
 }
 return {run,events,writes,npcCharacter,p,def,readFile,corpSource,stockItems};
}
const cross=(v)=>JSON.parse(JSON.stringify(v));
test('PF104 only original SDE character+corp+stock player ship becomes a hireable NPC',()=>{
 const f=fixture(),p=f.run();
 a.equal(p.source,'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1');
 a.equal(p.catalog.length,1);
 a.deepEqual(cross(p.catalog[0]),{npcCharacterID:CHAR,employerCorpID:CORP,
  profileID:PROFILE,shipTypeID:SHIP,amountCents:5000000});
 a.deepEqual(cross(p.salaryPolicies[0]),{npcCharacterID:CHAR,employerCorpID:CORP,
  profileID:PROFILE,shipTypeID:SHIP,salaryCents:500000,periodMs:86400000});
});
test('PF104 disabled or uninstalled real JSONL returns no invented NPC',()=>{
 const f=fixture({missingSde:true});
 a.throws(()=>f.run(),/PF104_ORIGINAL_SDE_NPC_CHARACTERS_NOT_INSTALLED/);
});
test('PF104 original SDE character must belong to the profile NPC employer',()=>{
 const f=fixture({wrongCorp:true});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 SDE NPC character owner must exist in actual corporationState',()=>{
 const f=fixture({unknownCharacter:true});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 source NPC corporation must exist in native corporationState',()=>{
 const f=fixture({missingNpc:true});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 forbids fake ship which is not stock item category 6',()=>{
 const f=fixture({wrongCategory:true});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 requires original stock itemTypeRegistry matching hull ID',()=>{
 const f=fixture({noPlayerHull:true});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 profile-hull mismatch never passes original SDE preflight',()=>{
 const f=fixture({wrongProfile:true});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 no compatible original profile is fail closed',()=>{
 const f=fixture({emptyProfile:true});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 original security or CONCORD profile cannot be hired',()=>{
 const f=fixture({profileKind:'concord'});
 a.throws(()=>f.run(),/PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE/);
});
test('PF104 invalid original static SDE is NOT silently skipped',()=>{
 const f=fixture({corruptStatic:true});
 a.throws(()=>f.run(),/SyntaxError/);
});
test('PF104 duplicate NPC identities in stock JSONL are fatal',()=>{
 const f=fixture({duplicates:true});
 a.throws(()=>f.run(),/PF104_ORIGINAL_SDE_DUPLICATE_CHARACTER/);
});
test('PF104 authored policy does not move player items or mutate original money',()=>{
 const f=fixture();f.run();
 a.deepEqual(f.writes,[]);
 a.equal(f.events.some(x=>String(x[0]).includes('write')),false);
});
test('PF104 source authored price and period cannot be set by env or caller',()=>{
 const f=fixture(),p=f.run();
 a.equal(p.catalog[0].amountCents,5000000);
 a.equal(p.salaryPolicies[0].salaryCents,500000);
 a.equal(p.salaryPolicies[0].periodMs,86400000);
});
test('PF104 candidate object and wage arrays are immutable',()=>{
 const p=fixture().run();
 a.equal(Object.isFrozen(p),true);
 a.equal(Object.isFrozen(p.catalog),true);
 a.equal(Object.isFrozen(p.catalog[0]),true);
 a.equal(Object.isFrozen(p.salaryPolicies[0]),true);
});
