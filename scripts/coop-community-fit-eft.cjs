#!/usr/bin/env node
'use strict';
// COOP-043: safe OFFLINE user-provided, permissioned EFT import. No scraping.
const fs=require('node:fs');
const path=require('node:path');
const {loadSde,validateFit,buildCatalog,fitHash}=require('./coop-community-fittings.cjs');
const FAMILIES=[[11,18],[19,26],[27,34],[92,99],[125,132],[164,171]];
function parseEft(raw,sde,metadata) {
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>50000)throw Error('EFT_BAD_SIZE');
  const lines=raw.replace(/\r/g,'').split('\n');
  if(lines.length>500)throw Error('EFT_TOO_MANY_LINES');
  const heading=lines.shift().trim().match(/^\[([^,\[\]]+),\s*(.+)\]$/);
  if(!heading)throw Error('EFT_BAD_HEADING');
  const lookup=new Map();
  for(const [typeID,row] of sde.types) {
    if(row.published!==true)continue;
    const name=typeof row.name==='string'?row.name:row?.name?.en;
    if(!name)continue;
    if(lookup.has(name))lookup.set(name,null);
    else lookup.set(name,Number(typeID));
  }
  function resolve(name) {
    const id=lookup.get(name);
    if(!Number.isSafeInteger(id)||id<=0)throw Error(`EFT_UNKNOWN_OR_AMBIGUOUS_ITEM ${name}`);
    return id;
  }
  const shipTypeID=resolve(heading[1].trim());
  const fitData=[];let section=0,slotCount=0,occupied=0;
  for(const line of lines) {
    const item=line.trim();
    if(!item){if(occupied || slotCount){section++;occupied=0;slotCount=0;}continue;}
    if(section>7)throw Error('EFT_EXTRA_SECTION');
    if(/^\[empty [^\]]+slot\]$/i.test(item)){slotCount++;continue;}
    if(/^%[^%]+%$/.test(item))continue;
    const quantity=item.match(/^(.*?)\s+x(\d+)$/i);
    const base=(quantity?quantity[1]:item).trim();
    const qty=quantity?Number(quantity[2]):1;
    if(!Number.isSafeInteger(qty)||qty<1||qty>100000)throw Error('EFT_BAD_QUANTITY');
    if(section<6) {
      const mod=base.split(/,\s*/,2);
      const [start,end]=FAMILIES[section];
      if(start+slotCount>end)throw Error('EFT_TOO_MANY_SLOTS');
      fitData.push([resolve(mod[0].trim()),start+slotCount,1]);
      slotCount++;occupied++;
      if(mod[1])fitData.push([resolve(mod[1].trim()),5,1]);
    } else {
      const flag=section===6?87:5;
      fitData.push([resolve(base),flag,qty]);occupied++;
    }
  }
  const fit={shipTypeID,shipName:heading[1].trim(),name:heading[2].trim(),fitData,
    source:{kind:'permissioned-eft',url:metadata.sourceURL,author:metadata.author,permission:metadata.permission}};
  const result=validateFit(fit,sde);
  if(!result.ok)throw Error(`EFT_INVALID_FIT ${result.reason}`);
  fit.fitData=result.fitData;
  return fit;
}
function args(argv) {
  const o={};
  for(let i=0;i<argv.length;i++) {const m=argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);if(!m)throw Error(`UNKNOWN_ARG ${argv[i]}`);o[m[1]]=m[2]===undefined?argv[++i]:m[2];}
  for(const k of Object.keys(o))if(!['sde','manifest','out','per-hull'].includes(k))throw Error(`BAD_OPTION ${k}`);
  for(const k of ['sde','manifest','out'])if(!o[k])throw Error(`REQUIRED --${k}`);
  o['per-hull']=o['per-hull']?Number(o['per-hull']):5;
  if(!Number.isInteger(o['per-hull'])||o['per-hull']<3||o['per-hull']>5)throw Error('BAD_PER_HULL');
  return o;
}
function run(o) {
  const sde=loadSde(path.resolve(o.sde));
  const manifestPath=path.resolve(o.manifest);
  if(fs.statSync(manifestPath).size>200000)throw Error('MANIFEST_TOO_LARGE');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(!Array.isArray(manifest.entries)||manifest.entries.length>3000)throw Error('MANIFEST_INVALID');
  const candidates=[],failures=[],root=path.dirname(manifestPath);
  for(const [i,entry] of manifest.entries.entries()) {
    try {
      if(typeof entry.file!=='string'||!/^[-a-zA-Z0-9_. /]+\.eft$/.test(entry.file))throw Error('BAD_RELATIVE_PATH');
      const file=path.resolve(root,entry.file);
      if(!file.startsWith(root+path.sep))throw Error('PATH_OUTSIDE_MANIFEST_DIR');
      if(typeof entry.sourceURL!=='string'||!/^https:\/\//.test(entry.sourceURL)||!entry.author||!entry.permission)throw Error('ATTRIBUTION_OR_PERMISSION_MISSING');
      candidates.push(parseEft(fs.readFileSync(file,'utf8'),sde,entry));
    }catch(e){failures.push({entry:i,file:entry.file,reason:e.message});}
  }
  const catalog=buildCatalog(sde.ships,candidates,sde,o['per-hull']);
  catalog.source='permissioned-eft';catalog.summary.importFailures=failures.length;
  catalog.summary.dogmaValidated=false;
  catalog.importFailures=failures;
  fs.mkdirSync(path.dirname(path.resolve(o.out)),{recursive:true});
  fs.writeFileSync(path.resolve(o.out),JSON.stringify(catalog,null,2));
  console.log(JSON.stringify({output:path.resolve(o.out),summary:catalog.summary,failed:failures.slice(0,30)},null,2));
}
if(require.main===module){try{run(args(process.argv.slice(2)));}catch(e){console.error(`EFT_IMPORT_FAILED ${e.message}`);process.exitCode=1;}}
module.exports={parseEft,args,run};