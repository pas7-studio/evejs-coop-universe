#!/usr/bin/env node
'use strict';
// Public-only EVE Workbench collection; local research output, never game DB writes.
const fs=require('node:fs');
const path=require('node:path');
const {loadSde,buildCatalog,fitHash}=require('./coop-community-fittings.cjs');
const {parseEft}=require('./coop-community-fit-eft.cjs');
const API='https://api.eveworkbench.com';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function mapPool(items,limit,fn){
  const out=new Array(items.length);
  let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length||1)},async()=>{
    for(;;){const index=cursor++;if(index>=items.length)return;out[index]=await fn(items[index],index);}
  });
  await Promise.all(workers);
  return out;
}
function args(argv){
  const opts={};
  for(let i=0;i<argv.length;i++){
    const match=argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if(!match)throw Error(`UNKNOWN_ARG ${argv[i]}`);
    if(match[2]===undefined&&(i+1>=argv.length||argv[i+1].startsWith('--')))throw Error(`MISSING_VALUE --${match[1]}`);
    opts[match[1]]=match[2]===undefined?argv[++i]:match[2];
  }
  for(const k of Object.keys(opts))if(!['sde','out','cache','pages','per-hull','ships','max-fits','concurrency','spacing'].includes(k))throw Error(`BAD_OPTION ${k}`);
  for(const k of ['sde','out','cache'])if(!opts[k])throw Error(`REQUIRED --${k}`);
  for(const [k,def,min,max] of [['pages',50,1,500],['per-hull',5,3,5],['max-fits',2000,1,10000],['concurrency',3,1,8],['spacing',150,100,3000]]){
    const n=opts[k]===undefined?def:Number(opts[k]);
    if(!Number.isInteger(n)||n<min||n>max)throw Error(`BAD_INTEGER --${k}`);opts[k]=n;
  }
  return opts;
}
function selectHulls(sde,names){
  if(!names)return sde.ships;
  const wanted=new Set(names.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
  const selected=sde.ships.filter(h=>wanted.has(h.shipName.toLowerCase()));
  if(selected.length!==wanted.size)throw Error('SHIP_NOT_FOUND_IN_PINNED_SDE');
  return selected;
}
let last=0;
let spacing=550;
async function loadJson(url,cacheFile){
  const u=new URL(url);
  if(u.origin!==API||!(/^\/v1\/fits\/public$/.test(u.pathname)||/^\/v1\/fits\/[a-f0-9-]{36}\/eft$/i.test(u.pathname)))throw Error('UNTRUSTED_ENDPOINT');
  if(fs.existsSync(cacheFile)){
    const raw=fs.readFileSync(cacheFile,'utf8');if(raw.length>2000000)throw Error('CACHE_TOO_LARGE');return JSON.parse(raw);
  }
  let data;
  for(let attempt=0;attempt<3;attempt++){
    await sleep(Math.max(0,spacing-(Date.now()-last)));last=Date.now();
    const res=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'EveJS-Coop-Community-Fit-Library/1.0 (public research; attribution)'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(res.status===429||res.status>=500){if(attempt===2)throw Error(`HTTP_${res.status}`);await sleep(1600*(attempt+1));continue;}
    if(!res.ok)throw Error(`HTTP_${res.status}`);
    const body=await res.text();if(body.length>2000000)throw Error('UPSTREAM_TOO_LARGE');
    data=JSON.parse(body);break;
  }
  fs.mkdirSync(path.dirname(cacheFile),{recursive:true});
  const temp=cacheFile+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,cacheFile);
  return data;
}
function validatePublicPage(data){
  // The live API answers with PascalCase keys (Fits/NumberOfPages); the historical
  // fixture shape is camelCase. Both are accepted, anything else fails loudly.
  const fits=data&&(data.fits??data.Fits);
  if(!data||data.error===true||data.Error===true||!Array.isArray(fits))throw Error('WORKBENCH_LIST_SCHEMA_CHANGED');
  return {fits,pages:Number(data.numberOfPages??data.NumberOfPages)||1};
}
async function collect(opts){
  const sde=loadSde(path.resolve(opts.sde));
  const hulls=selectHulls(sde,opts.ships);
  spacing=opts.spacing;
  const selected=new Set(hulls.map(h=>h.shipTypeID));
  const successes=new Map(), seenSignatures=new Map(), failures=[];
  // Collect several candidates per hull so buildCatalog can pick genuinely different
  // (role, tier) variants instead of the first N records of the same setup.
  const candidateCap=Math.min(40,Math.max(opts['per-hull'],opts['per-hull']*4));
  let pagesRead=0,seen=0;
  for(let page=1;page<=opts.pages;page++){
    const raw=await loadJson(`${API}/v1/fits/public?page=${page}`,path.join(opts.cache,'pages',`${page}.json`));
    const response=validatePublicPage(raw);pagesRead++;
    if(!response.fits.length)break;
    const batch=[];
    for(const info of response.fits){
      if(seen>=opts['max-fits'])break;
      const shipID=Number(info?.shipId??info?.ShipId),id=String(info?.id??info?.Id??'');
      if(!selected.has(shipID)||!UUID.test(id))continue;
      if((successes.get(shipID)||[]).length+batch.filter(task=>task.shipID===shipID).length>=candidateCap)continue;
      seen++;batch.push({shipID,id,info});
    }
    // Bounded politeness: a few overlapping requests spaced by opts.spacing, never a flood.
    const fetched=await mapPool(batch,opts.concurrency,async task=>{
      try{
        const data=await loadJson(`${API}/v1/fits/${task.id}/eft`,path.join(opts.cache,'eft',`${task.id}.json`));
        const eft=data?.eft??data?.Eft;
        if(data?.error===true||data?.Error===true||typeof eft!=='string')throw Error('WORKBENCH_EFT_SCHEMA_CHANGED');
        const fit=parseEft(eft,sde,{kind:'public-workbench',sourceURL:`https://eveworkbench.com/fit/${task.id}`,author:String(task.info.characterName??task.info.CharacterName??'Anonymous author')});
        if(fit.shipTypeID!==task.shipID)throw Error('WORKBENCH_HULL_MISMATCH');
        return {...task,fit};
      }catch(e){return {...task,failure:e.message};}
    });
    for(const item of fetched){
      if(!item)continue;
      if(item.failure){failures.push({fitID:item.id,shipTypeID:item.shipID,reason:item.failure});continue;}
      const fit=item.fit;
      const signature=fitHash(item.shipID,fit.fitData);
      const signatures=seenSignatures.get(item.shipID)||new Set();
      if(signatures.has(signature))continue;
      const existing=successes.get(item.shipID)||[];
      if(existing.length>=candidateCap)continue;
      signatures.add(signature);seenSignatures.set(item.shipID,signatures);
      existing.push(fit);successes.set(item.shipID,existing);
    }
    process.stdout.write(`WORKBENCH_PAGE ${page}/${response.pages} selected=${seen} valid=${[...successes.values()].reduce((n,a)=>n+a.length,0)}\n`);
    if(page>=response.pages||seen>=opts['max-fits']||hulls.every(h=>(successes.get(h.shipTypeID)||[]).length>=candidateCap))break;
  }
  const candidates=[...successes.values()].flat();
  const catalog=buildCatalog(hulls,candidates,sde,opts['per-hull']);
  catalog.source='public-eveworkbench';
  catalog.summary.pagesRead=pagesRead;
  catalog.summary.importFailures=failures.length;
  catalog.summary.dogmaValidated=Boolean(sde.dogma);
  catalog.importFailures=failures;
  fs.mkdirSync(path.dirname(path.resolve(opts.out)),{recursive:true});
  const tmp=path.resolve(opts.out)+'.tmp-'+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(catalog,null,2));fs.renameSync(tmp,path.resolve(opts.out));
  process.stdout.write(`WORKBENCH_CATALOG ${path.resolve(opts.out)} ${JSON.stringify(catalog.summary)}\n`);
  return catalog;
}
if(require.main===module)collect(args(process.argv.slice(2))).catch(e=>{console.error(`WORKBENCH_FAILED ${e.message}`);process.exitCode=1;});
module.exports={args,selectHulls,validatePublicPage,collect};