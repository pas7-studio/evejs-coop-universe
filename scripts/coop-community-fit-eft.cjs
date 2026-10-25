#!/usr/bin/env node
'use strict';
// COOP-043: EFT parser for permissioned local files and published EVE Workbench data.
const fs=require('node:fs');
const path=require('node:path');
const {loadSde,validateFit,buildCatalog}=require('./coop-community-fittings.cjs');
const {effectSet}=require('./coop-community-fit-dogma.cjs');
const EFFECT_SUBSYSTEM=3772, EFFECT_SERVICE_SLOT=6306, SUBSYSTEM_CATEGORY_ID=32;
const FAMILIES=[[11,18],[19,26],[27,34],[92,99],[125,132],[164,171]];
const DUMMY_LINE=/^\[empty\s+(low|med|medium|high|hi|rig|subsystem|service)\s+slot\]$/i;
function parseEft(raw,sde,metadata={}) {
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>50000)throw Error('EFT_BAD_SIZE');
  const lines=raw.replace(/^\uFEFF/,'').replace(/\r/g,'').split('\n');
  if(lines.length>500)throw Error('EFT_TOO_MANY_LINES');
  const heading=String(lines.shift()||'').trim().match(/^\[([^,\[\]]+),\s*(.+)\]$/);
  if(!heading)throw Error('EFT_BAD_HEADING');
  const lookup=new Map();
  for(const [typeID,row] of sde.types) {
    if(row.published!==true)continue;
    const name=typeof row.name==='string'?row.name:row?.name?.en;
    if(!name)continue;
    const key=name.toLocaleLowerCase('en-US');
    if(lookup.has(key))lookup.set(key,null);else lookup.set(key,Number(typeID));
  }
  function resolve(name) {
    const id=lookup.get(name.trim().toLocaleLowerCase('en-US'));
    if(!Number.isSafeInteger(id)||id<=0)throw Error(`EFT_UNKNOWN_OR_AMBIGUOUS_ITEM ${name}`);
    return id;
  }
  const shipTypeID=resolve(heading[1]);
  const fitData=[];
  let section=0,offset=0;
  let prevBlank=false;
  for(const line of lines){
    const item=line.trim();
    if(!item){
      // EFT uses one separator for module sections and two for drone/cargo.
      // Preserve empty subsystem/service sections; tolerate extra trailing blanks.
      if(section<7){section++;offset=0;}
      else if(!prevBlank){section=8;}
      prevBlank=true;
      continue;
    }
    prevBlank=false;
    if(item.startsWith('%')&&item.endsWith('%'))continue;
    if(DUMMY_LINE.test(item)){
      if(section>=6)throw Error('EFT_EMPTY_SLOT_IN_BAY');
      const family=DUMMY_LINE.exec(item)[1].toLowerCase();
      const expected=['low','med','high','rig','subsystem','service'][section];
      if(!(family===expected||(family==='medium'&&expected==='med')||(family==='hi'&&expected==='high')))throw Error('EFT_SLOT_SECTION_MISMATCH');
      if(FAMILIES[section][0]+offset>FAMILIES[section][1])throw Error('EFT_TOO_MANY_SLOTS');
      offset++;continue;
    }
    const quantity=item.match(/^(.*?)\s+x(\d+)$/i);
    const base=(quantity?quantity[1]:item).trim();
    const qty=quantity?Number(quantity[2]):1;
    if(!Number.isSafeInteger(qty)||qty<1||qty>100000)throw Error('EFT_BAD_QUANTITY');
    const nextFree=(start,end)=>{for(let f=start;f<=end;f++)if(!fitData.some(x=>Number(x[1])===f))return f;throw Error('EFT_TOO_MANY_SLOTS');};
    if(sde.dogma){
      // With real dogma data the item itself says which slot kind it belongs to. Blank-line
      // section counting is unreliable because empty sections are collapsed by exporters.
      const comma=base.indexOf(',');
      const moduleName=(comma===-1?base:base.slice(0,comma)).replace(/\s+\/offline$/i,'').trim();
      const chargeName=comma===-1?'':base.slice(comma+1).trim();
      const type=resolve(moduleName),row=sde.types.get(type);
      const category=Number(sde.groups.get(Number(row.groupID))?.categoryID);
      const effects=effectSet(sde.dogma,type);
      const families=[['high',27,34,12],['mid',19,26,13],['low',11,18,11],['rig',92,99,2663],['subsystem',125,132,3772],['service',164,171,6306]];
      const family=families.find(entry=>effects.has(entry[3]));
      if(family){
        // A public export sometimes carries a stack size on a module line (spare module in
        // the hold). Fit one and keep the rest as cargo instead of discarding the whole fit.
        fitData.push([type,nextFree(family[1],family[2]),1]);
        if(qty>1)fitData.push([type,5,qty-1]);
      }
      else if(category===18)fitData.push([type,87,qty]);
      else if(category===87)fitData.push([type,158,qty]);
      else if(category===SUBSYSTEM_CATEGORY_ID)fitData.push([type,nextFree(125,132),qty]);
      else fitData.push([type,5,qty]);
      if(chargeName&&family)fitData.push([resolve(chargeName),5,1]);
    }else if(section<4){
      const comma=base.indexOf(',');
      const moduleName=(comma===-1?base:base.slice(0,comma)).replace(/\s+\/offline$/i,'').trim();
      const chargeName=comma===-1?'':base.slice(comma+1).trim();
      const [start,end]=FAMILIES[section];
      if(start+offset>end)throw Error('EFT_TOO_MANY_SLOTS');
      if(qty!==1)throw Error('EFT_MODULE_QUANTITY_NOT_ONE');
      fitData.push([resolve(moduleName),start+offset,1]);offset++;
      if(chargeName)fitData.push([resolve(chargeName),5,1]);
    }else{
      // After the rig section the position is no longer reliable: EVE Workbench and the
      // native client collapse empty subsystem/service sections, so drones, fighters,
      // cargo and subsystem modules all appear here. Classify by real SDE data.
      const type=resolve(base),row=sde.types.get(type);
      const category=Number(sde.groups.get(Number(row.groupID))?.categoryID);
      const effects=sde.dogma?effectSet(sde.dogma,type):new Set();
      const nextFree=(start,end)=>{for(let f=start;f<=end;f++)if(!fitData.some(x=>Number(x[1])===f))return f;throw Error('EFT_TOO_MANY_SLOTS');};
      if(effects.has(EFFECT_SERVICE_SLOT))fitData.push([type,nextFree(164,171),1]);
      else if(effects.has(EFFECT_SUBSYSTEM))fitData.push([type,nextFree(125,132),1]);
      else if(category===18)fitData.push([type,87,qty]);
      else if(category===87)fitData.push([type,158,qty]);
      else if(category===SUBSYSTEM_CATEGORY_ID)fitData.push([type,nextFree(125,132),qty]);
      else fitData.push([type,5,qty]);
    }
  }
  const kind=metadata.kind||'permissioned-eft';
  if(!['permissioned-eft','public-workbench'].includes(kind))throw Error('EFT_UNSUPPORTED_SOURCE');
  if(typeof metadata.sourceURL!=='string'||!metadata.sourceURL.startsWith('https://')||
     typeof metadata.author!=='string'||!metadata.author.trim())throw Error('EFT_ATTRIBUTION_REQUIRED');
  if(kind==='permissioned-eft'&&!(typeof metadata.permission==='string'&&metadata.permission.trim()))throw Error('EFT_PERMISSION_REQUIRED');
  const fit={shipTypeID,shipName:heading[1].trim(),name:heading[2].trim(),fitData,
    source:{kind,url:metadata.sourceURL,author:metadata.author,permission:metadata.permission}};
  const check=validateFit(fit,sde);
  if(!check.ok){
    const error=Error(`EFT_INVALID_FIT ${check.reason} ${JSON.stringify(check.detail||{})}`);
    error.fit=fit;error.stats=check.stats;error.reasons=check.reasons;
    throw error;
  }
  fit.fitData=check.fitData;
  return fit;
}
function args(argv){
  const o={};for(let i=0;i<argv.length;i++){
    const m=argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if(!m)throw Error(`UNKNOWN_ARG ${argv[i]}`);
    if(m[2]===undefined&&(i+1>=argv.length||argv[i+1].startsWith('--')))throw Error(`MISSING_VALUE --${m[1]}`);
    o[m[1]]=m[2]===undefined?argv[++i]:m[2];
  }
  for(const k of Object.keys(o))if(!['sde','manifest','out','per-hull'].includes(k))throw Error(`BAD_OPTION ${k}`);
  for(const k of ['sde','manifest','out'])if(!o[k])throw Error(`REQUIRED --${k}`);
  o['per-hull']=o['per-hull']?Number(o['per-hull']):5;
  if(!Number.isInteger(o['per-hull'])||o['per-hull']<3||o['per-hull']>5)throw Error('BAD_PER_HULL');
  return o;
}
function run(o){
  const sde=loadSde(path.resolve(o.sde));
  const manifestPath=path.resolve(o.manifest);
  if(fs.statSync(manifestPath).size>200000)throw Error('MANIFEST_TOO_LARGE');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(!Array.isArray(manifest.entries)||manifest.entries.length>3000)throw Error('MANIFEST_INVALID');
  const candidates=[],failures=[],root=path.dirname(manifestPath);
  for(const [i,entry] of manifest.entries.entries()){
    try{
      if(typeof entry.file!=='string'||!/^[-a-zA-Z0-9_. /]+\.eft$/.test(entry.file))throw Error('BAD_RELATIVE_PATH');
      const file=path.resolve(root,entry.file);
      if(!file.startsWith(root+path.sep))throw Error('PATH_OUTSIDE_MANIFEST_DIR');
      if(!entry.sourceURL||!entry.author||!entry.permission)throw Error('ATTRIBUTION_OR_PERMISSION_MISSING');
      candidates.push(parseEft(fs.readFileSync(file,'utf8'),sde,entry));
    }catch(e){failures.push({entry:i,file:entry.file,reason:e.message});}
  }
  const catalog=buildCatalog(sde.ships,candidates,sde,o['per-hull']);
  catalog.source='permissioned-eft';catalog.summary.importFailures=failures.length;
  catalog.summary.dogmaValidated=false;catalog.importFailures=failures;
  fs.mkdirSync(path.dirname(path.resolve(o.out)),{recursive:true});
  fs.writeFileSync(path.resolve(o.out),JSON.stringify(catalog,null,2));
  console.log(JSON.stringify({output:path.resolve(o.out),summary:catalog.summary,failed:failures.slice(0,30)},null,2));
}
if(require.main===module){try{run(args(process.argv.slice(2)));}catch(e){console.error(`EFT_IMPORT_FAILED ${e.message}`);process.exitCode=1;}}
module.exports={parseEft,args,run};