#!/usr/bin/env node
'use strict';
// Combine permissioned EFT and public combat-loss research into a native catalog.
const fs=require('node:fs');const path=require('node:path');
const {loadSde,PIN,validateFit,fitHash,selectDiverse,sourcePriority}=require('./coop-community-fittings.cjs');
function merge(sde, catalogs, perHull=5) {
  if(!Number.isInteger(perHull)||perHull<3||perHull>5)throw Error('BAD_PER_HULL');
  const byHull=new Map();const rejected=[];
  for(const catalog of catalogs) {
    if(catalog?.schema!==1||catalog?.sdePin!==PIN||!Array.isArray(catalog.records))throw Error('CATALOG_BAD_VERSION');
    for(const record of catalog.records) {
      const check=validateFit(record,sde);
      if(!check.ok||JSON.stringify(check.fitData)!==JSON.stringify(record.fitData)){rejected.push({shipTypeID:record?.shipTypeID,reason:check.reason||'NON_CANONICAL'});continue;}
      const source=record.provenance||{};
      if(!['public-killmail','permissioned-eft','public-workbench'].includes(source.kind)||!String(source.url||'').startsWith('https://')){rejected.push({shipTypeID:record.shipTypeID,reason:'UNTRUSTED_PROVENANCE'});continue;}
      if(source.kind==='permissioned-eft'&&(!source.author||!source.permission)){rejected.push({shipTypeID:record.shipTypeID,reason:'MISSING_PERMISSION'});continue;}
      const id=fitHash(record.shipTypeID,record.fitData);
      if(!String(record.description).startsWith('COOP043#'+id.slice(0,16))){rejected.push({shipTypeID:record.shipTypeID,reason:'HASH_MISMATCH'});continue;}
      const hullID=Number(record.shipTypeID);
      if(!byHull.has(hullID))byHull.set(hullID,new Map());
      const variants=byHull.get(hullID);
      if(!variants.has(id)||sourcePriority(source.kind)>sourcePriority(variants.get(id).provenance.kind))variants.set(id,record);
    }
  }
  const records=[],coverage=[];
  for(const ship of sde.ships){
    const all=[...(byHull.get(ship.shipTypeID)?.values()||[])].sort((a,b)=>sourcePriority(b.provenance.kind)-sourcePriority(a.provenance.kind) || a.name.localeCompare(b.name));
    const fits=selectDiverse(all,perHull);
    coverage.push({shipTypeID:ship.shipTypeID,shipName:ship.shipName,variants:fits.length,target:perHull,available:all.length,
      roles:fits.map(f=>f.role&&f.tier?`${f.role}:${f.tier}`:null),
      reason:all.length===0?(rejected.filter(x=>Number(x.shipTypeID)===ship.shipTypeID).map(x=>x.reason)[0]||'NO_PUBLIC_FIT_FOUND'):(all.length<3?`TARGET_NOT_MET_ONLY_${all.length}_VALID`:undefined)});
    records.push(...fits);
  }
  return {schema:1,sdePin:PIN,source:'mixed-permissioned-eft-and-killmail',records,coverage,rejected,
    summary:{hulls:sde.ships.length,fits:records.length,withAtLeast3:coverage.filter(x=>x.variants>=3).length,
      withFive:coverage.filter(x=>x.variants>=5).length,zero:coverage.filter(x=>x.variants===0).length,
      dogmaValidated:Boolean(sde.dogma)}};
}
function run(argv){
  if(argv.length<7||argv[0]!=='--sde'||argv[2]!=='--out'||argv[4]!=='--per-hull')throw Error('USAGE --sde PATH --out PATH --per-hull 3..5 CATALOG1.json [CATALOG2.json ...]');
  const sde=loadSde(path.resolve(argv[1])),out=path.resolve(argv[3]),limit=Number(argv[5]);
  const catalogs=argv.slice(6).map(p=>{if(fs.statSync(p).size>10_000_000)throw Error('INPUT_TOO_LARGE');return JSON.parse(fs.readFileSync(p,'utf8'));});
  const result=merge(sde,catalogs,limit);
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2));
  console.log(JSON.stringify({output:out,summary:result.summary,rejected:result.rejected.length},null,2));
}
if(require.main===module){try{run(process.argv.slice(2));}catch(e){console.error(`MERGE_FAILED ${e.message}`);process.exitCode=1;}}
module.exports={merge,run};