#!/usr/bin/env node
'use strict';
// Public-only EVE Workbench collection; local research output, never game DB writes.
const fs=require('node:fs');
const path=require('node:path');
const {loadSde,buildCatalog,fitHash}=require('./coop-community-fittings.cjs');
const {parseEft}=require('./coop-community-fit-eft.cjs');
const API='https://api.eveworkbench.com';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function args(argv){
  const opts={};
  for(let i=0;i<argv.length;i++){
    const match=argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if(!match)throw Error(`UNKNOWN_ARG ${argv[i]}`);
    if(match[2]===undefined&&(i+1>=argv.length||argv[i+1].startsWith('--')))throw Error(`MISSING_VALUE --${match[1]}`);
    opts[match[1]]=match[2]===undefined?argv[++i]:match[2];
  }
  for(const k of Object.keys(opts))if(!['sde','out','cache','pages','per-hull','ships','max-fits'].includes(k))throw Error(`BAD_OPTION ${k}`);
  for(const k of ['sde','out','cache'])if(!opts[k])throw Error(`REQUIRED --${k}`);
  for(const [k,def,min,max] of [['pages',50,1,500],['per-hull',5,3,5],['max-fits',2000,1,10000]]){
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
async function loadJson(url,cacheFile){
  const u=new URL(url);
  if(u.origin!==API||!(/^\/v1\/fits\/public$/.test(u.pathname)||/^\/v1\/fits\/[a-f0-9-]{36}\/eft$/i.test(u.pathname)))throw Error('UNTRUSTED_ENDPOINT');
  if(fs.existsSync(cacheFile)){
    const raw=fs.readFileSync(cacheFile,'utf8');if(raw.length>2000000)throw Error('CACHE_TOO_LARGE');return JSON.parse(raw);
  }
  let data;
  for(let attempt=0;attempt<3;attempt++){
    await sleep(Math.max(0,550-(Date.now()-last)));last=Date.now();
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
  if(!data||data.error===true||!Array.isArray(data.fits))throw Error('WORKBENCH_LIST_SCHEMA_CHANGED');
  return {fits:data.fits,pages:Number(data.numberOfPages)||1};
}
async function collect(opts){
  const sde=loadSde(path.resolve(opts.sde));
  const hulls=selectHulls(sde,opts.ships);
  const selected=new Set(hulls.map(h=>h.shipTypeID));
  const successes=new Map(), seenSignatures=new Map(), failures=[];
  let pagesRead=0,seen=0;
  for(let page=1;page<=opts.pages;page++){
    const raw=await loadJson(`${API}/v1/fits/public?page=${page}`,path.join(opts.cache,'pages',`${page}.json`));
    const response=validatePublicPage(raw);pagesRead++;
    if(!response.fits.length)break;
    for(const info of response.fits){
      if(seen>=opts['max-fits'])break;
      const shipID=Number(info?.shipId),id=String(info?.id||'');
      if(!selected.has(shipID)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))continue;
      const existing=successes.get(shipID)||[];
      if(existing.length>=opts['per-hull'])continue;
      seen++;
      try{
        const data=await loadJson(`${API}/v1/fits/${id}/eft`,path.join(opts.cache,'eft',`${id}.json`));
        if(data?.error===true||typeof data?.eft!=='string')throw Error('WORKBENCH_EFT_SCHEMA_CHANGED');
        const fit=parseEft(data.eft,sde,{kind:'public-workbench',sourceURL:`https://eveworkbench.com/fit/${id}`,author:String(info.characterName||'Anonymous author')});
        if(fit.shipTypeID!==shipID)throw Error('WORKBENCH_HULL_MISMATCH');
        const signature=fitHash(shipID,fit.fitData);
        const signatures=seenSignatures.get(shipID)||new Set();
        if(signatures.has(signature))continue;
        signatures.add(signature);seenSignatures.set(shipID,signatures);
        existing.push(fit);successes.set(shipID,existing);
      }catch(e){failures.push({fitID:id,shipTypeID:shipID,reason:e.message});}
    }
    process.stdout.write(`WORKBENCH_PAGE ${page}/${response.pages} selected=${seen} valid=${[...successes.values()].reduce((n,a)=>n+a.length,0)}\n`);
    if(page>=response.pages||seen>=opts['max-fits']||hulls.every(h=>(successes.get(h.shipTypeID)||[]).length>=opts['per-hull']))break;
  }
  const candidates=[...successes.values()].flat();
  const catalog=buildCatalog(hulls,candidates,sde,opts['per-hull']);
  catalog.source='public-eveworkbench';
  catalog.summary.pagesRead=pagesRead;
  catalog.summary.importFailures=failures.length;
  catalog.summary.dogmaValidated=false;
  catalog.importFailures=failures;
  fs.mkdirSync(path.dirname(path.resolve(opts.out)),{recursive:true});
  const tmp=path.resolve(opts.out)+'.tmp-'+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(catalog,null,2));fs.renameSync(tmp,path.resolve(opts.out));
  process.stdout.write(`WORKBENCH_CATALOG ${path.resolve(opts.out)} ${JSON.stringify(catalog.summary)}\n`);
  return catalog;
}
if(require.main===module)collect(args(process.argv.slice(2))).catch(e=>{console.error(`WORKBENCH_FAILED ${e.message}`);process.exitCode=1;});
module.exports={args,selectHulls,validatePublicPage,collect};