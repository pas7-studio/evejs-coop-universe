'use strict';
/**
 * PF104 — source-authored *selection policy*, sourced only from original
 * EveJS SDE npcCharacters/npcCorporations and stock NPC profiles/hulls.
 * No invented character, ID, hull, cargo, ISK balance or salary payment.
 *
 * This authoring algorithm intentionally provides at most 3 pilot offers
 * from actual matching NPC corporations + actual player-ship item types.
 * Fees/periods are authored constants, never client or environment values.
 * If the authentic installed SDE does not contain compatible records,
 * original WORK startup fails closed (no free/synthetic fallback).
 */
const fs=require('node:fs');
const path=require('node:path');
const npcData=require('./npc/npcData');
const corporations=require('../services/corporation/corporationState');
const items=require('../services/inventory/itemTypeRegistry');
const SOURCE='ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1';
const ROOT=path.resolve(__dirname,'../../..'); // Code/, same source root as corporationState
const MAX=3,MAX_SDE_ROWS=150000;
const HIRE_CENTS=5000000; // Server-authored 50,000 ISK; no wallet mutation here
const DAILY_WAGE_CENTS=500000; // Server-authored 5,000 ISK every 24h
const WAGE_PERIOD_MS=86400000;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const name=x=>typeof x==='string'?x:obj(x)?x.en||'':'';
function genuineStaticFolder(){
 const found=[];
 for(const root of [path.join(ROOT,'data'),path.join(ROOT,'_local','sde')]){
  let dirs=[];
  try{
   if(fs.statSync(root).isDirectory()&&
      /^eve-online-static-data-\d+-jsonl$/i.test(path.basename(root)))
    dirs=[{name:path.basename(root),full:root}];
   else dirs=fs.readdirSync(root,{withFileTypes:true})
    .filter(e=>e.isDirectory()&&
      /^eve-online-static-data-\d+-jsonl$/i.test(e.name))
    .map(e=>({name:e.name,full:path.join(root,e.name)}));
  }catch{continue;}
  for(const dir of dirs){
   const files=['npcCorporations.jsonl','npcCharacters.jsonl']
    .map(x=>path.join(dir.full,x));
   try{
    if(files.every(f=>fs.statSync(f).isFile()&&!fs.lstatSync(f).isSymbolicLink()))
     found.push({...dir,files});
   }catch{}
  }
 }
 found.sort((a,b)=>b.name.localeCompare(a.name));
 return found[0]||null;
}
function rows(file){
 const raw=fs.readFileSync(file,'utf8');
 if(raw.length>30000000)throw Error('PF104_AUTHORED_SDE_TOO_LARGE');
 const lines=raw.split(/\r?\n/).filter(x=>x.trim()!=='');
 if(lines.length<1||lines.length>MAX_SDE_ROWS)
  throw Error('PF104_AUTHORED_SDE_ROW_COUNT_INVALID');
 return lines.map(line=>{
  const v=JSON.parse(line);
  if(!obj(v))throw Error('PF104_AUTHORED_SDE_RECORD_INVALID');
  return v;
 });
}
function author(){
 if(typeof npcData.listNpcProfiles!=='function'||
    typeof npcData.buildNpcDefinition!=='function'||
    typeof corporations.getNpcCharacterOwnerRecord!=='function'||
    typeof corporations.getCorporationRecord!=='function'||
    typeof corporations.isNpcCorporationID!=='function'||
    typeof items.resolveItemByTypeID!=='function')
  throw Error('PF104_ORIGINAL_NATIVE_CATALOG_SERVICES_REQUIRED');
 const dir=genuineStaticFolder();
 if(!dir)throw Error('PF104_ORIGINAL_SDE_NPC_CHARACTERS_NOT_INSTALLED');
 const corpSet=new Set();
 for(const raw of rows(dir.files[0])){
  if(pos(raw._key)){
   if(corpSet.has(raw._key))throw Error('PF104_ORIGINAL_SDE_DUPLICATE_CORP');
   corpSet.add(raw._key);
  }
 }
 const byCorporation=new Map(),seenCharacters=new Set();
 for(const raw of rows(dir.files[1])){
  const id=raw._key,corp=raw.corporationID;
  if(!pos(id)||!pos(corp)||!corpSet.has(corp)||!name(raw.name).trim())
   continue;
  if(seenCharacters.has(id))throw Error('PF104_ORIGINAL_SDE_DUPLICATE_CHARACTER');
  seenCharacters.add(id);
  const owner=corporations.getNpcCharacterOwnerRecord(id);
  if(owner?.ownerID!==id||owner.typeID!==1373||
     typeof owner.ownerName!=='string'||owner.ownerName.trim().length<2||
     owner.ownerName.startsWith('Entity '))continue;
  if(!byCorporation.has(corp))byCorporation.set(corp,[]);
  byCorporation.get(corp).push(id);
 }
 for(const ids of byCorporation.values())ids.sort((a,b)=>a-b);
 const profiles=npcData.listNpcProfiles();
 if(!Array.isArray(profiles)||profiles.length>50000)
  throw Error('PF104_ORIGINAL_PROFILE_TABLE_UNTRUSTED');
 const candidates=[];
 for(const p of profiles){
  if(!obj(p)||!token(p.profileID)||p.entityType!=='npc'||
     !pos(p.shipTypeID)||!pos(p.corporationID)||
     !byCorporation.has(p.corporationID)||!token(p.loadoutID)||
     !token(p.behaviorProfileID))continue;
  let definition,corp,item;
  try{
   definition=npcData.buildNpcDefinition(p.profileID);
   corp=corporations.getCorporationRecord(p.corporationID);
   item=items.resolveItemByTypeID(p.shipTypeID);
  }catch{continue;}
  if(definition?.profile?.profileID!==p.profileID||
     definition.profile.shipTypeID!==p.shipTypeID||
     definition.profile.corporationID!==p.corporationID||
     definition.profile.loadoutID!==p.loadoutID||
     definition.profile.behaviorProfileID!==p.behaviorProfileID||
     definition.loadout?.loadoutID!==p.loadoutID||
     definition.behaviorProfile?.behaviorProfileID!==p.behaviorProfileID||
     !Array.isArray(definition.loadout.modules)||
     !Array.isArray(definition.loadout.charges)||
     item?.typeID!==p.shipTypeID||item.categoryID!==6||
     corp?.corporationID!==p.corporationID||corp.isNPC!==true||
     corporations.isNpcCorporationID(p.corporationID)!==true)continue;
  candidates.push({profileID:p.profileID,shipTypeID:p.shipTypeID,
    employerCorpID:p.corporationID,npcCharacterID:byCorporation.get(p.corporationID)[0]});
 }
 candidates.sort((a,b)=>a.employerCorpID-b.employerCorpID||
  a.npcCharacterID-b.npcCharacterID||a.profileID.localeCompare(b.profileID));
 const used=new Set(),catalog=[],salaryPolicies=[];
 for(const c of candidates){
  if(used.has(c.npcCharacterID))continue;
  used.add(c.npcCharacterID);
  const common={npcCharacterID:c.npcCharacterID,
   employerCorpID:c.employerCorpID,profileID:c.profileID,
   shipTypeID:c.shipTypeID};
  catalog.push(Object.freeze({...common,amountCents:HIRE_CENTS}));
  salaryPolicies.push(Object.freeze({...common,
   salaryCents:DAILY_WAGE_CENTS,periodMs:WAGE_PERIOD_MS}));
  if(catalog.length===MAX)break;
 }
 if(catalog.length<1)throw Error('PF104_NO_REAL_SDE_NPC_WITH_PHYSICAL_SHIP_PROFILE');
 return Object.freeze({source:SOURCE,catalog:Object.freeze(catalog),
  salaryPolicies:Object.freeze(salaryPolicies)});
}
module.exports=author();
