#!/usr/bin/env node
'use strict';
// COOP-043: offline-output-only public fitting data harvester. Does not mutate EveJS.
const fs=require('node:fs');
const path=require('node:path');
const {loadSde,fromKillmail,buildCatalog}=require('./coop-community-fittings.cjs');
function args(argv) {
  const result={};
  for (let i=0;i<argv.length;i++) {
    const m=argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if(!m) throw Error(`UNKNOWN_ARGUMENT ${argv[i]}`);
    if(m[2]!==undefined) result[m[1]]=m[2];
    else {if(i+1>=argv.length||argv[i+1].startsWith('--')) throw Error(`MISSING_VALUE --${m[1]}`);result[m[1]]=argv[++i];}
  }
  for(const key of Object.keys(result)) if(!['sde','out','cache','per-hull','pages','per-page','max-hulls','min-modules','ships'].includes(key)) throw Error(`UNKNOWN_OPTION ${key}`);
  for(const key of ['sde','out','cache']) if(!result[key]) throw Error(`REQUIRED --${key}`);
  for(const [key,defaultValue,min,max] of [['per-hull',5,3,5],['pages',3,1,6],['per-page',12,1,30],['max-hulls',0,0,1000],['min-modules',2,1,8]]) {
    const n=result[key]===undefined?defaultValue:Number(result[key]);
    if(!Number.isInteger(n)||n<min||n>max) throw Error(`BAD_NUMERIC_OPTION ${key}`);
    result[key]=n;
  }
  return result;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastRequest=0;
async function cachedJson(url,cachePath) {
  if(fs.existsSync(cachePath)) {
    const data=fs.readFileSync(cachePath,'utf8');
    if(data.length>32_000_000) throw Error('CACHE_TOO_LARGE');
    return JSON.parse(data);
  }
  const origin=new URL(url);
  if(origin.protocol!=='https:' || !['zkillboard.com','esi.evetech.net'].includes(origin.hostname)) throw Error('UNTRUSTED_HOST');
  let value;
  for(let attempt=0;attempt<3;attempt++) {
    const remaining=450-(Date.now()-lastRequest);
    if(remaining>0) await pause(remaining);
    lastRequest=Date.now();
    const response=await fetch(url,{headers:{'User-Agent':'EveJS-Coop-FitResearch/1.0 (local co-op)','Accept':'application/json'},signal:AbortSignal.timeout(25000)});
    if(response.status===429 || response.status>=500){if(attempt===2) throw Error(`UPSTREAM_HTTP_${response.status}`);await pause(1500*(attempt+1));continue;}
    if(!response.ok) throw Error(`UPSTREAM_HTTP_${response.status}`);
    const raw=await response.text();
    if(raw.length>16_000_000) throw Error('UPSTREAM_TOO_LARGE');
    value=JSON.parse(raw);break;
  }
  fs.mkdirSync(path.dirname(cachePath),{recursive:true});
  const temp=`${cachePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,cachePath);
  return value;
}
async function harvest(opts) {
  const sde=loadSde(opts.sde);
  let hulls=opts['max-hulls']?sde.ships.slice(0,opts['max-hulls']):sde.ships;
  if(opts.ships){const wanted=new Set(opts.ships.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));hulls=sde.ships.filter(x=>wanted.has(x.shipName.toLowerCase()));if(hulls.length!==wanted.size)throw Error('SHIP_NOT_FOUND_IN_PINNED_SDE');}
  const candidates=[];
  let failures=0;
  for(let h=0;h<hulls.length;h++) {
    const hull=hulls[h];const hashes=new Set();
    for(let page=1;page<=opts.pages && hashes.size<opts['per-hull']*3;page++) {
      let summaries;
      try{summaries=await cachedJson(`https://zkillboard.com/api/losses/shipTypeID/${hull.shipTypeID}/page/${page}/`,path.join(opts.cache,'zkill',`${hull.shipTypeID}-${page}.json`));}
      catch(e){failures++;process.stderr.write(`API_WARN ${hull.shipName}: ${e.message}\n`);break;}
      if(!Array.isArray(summaries)||summaries.length===0) break;
      const ordered=summaries.sort((a,b)=>Number(b?.zkb?.fittedValue||0)-Number(a?.zkb?.fittedValue||0)).slice(0,opts['per-page']);
      for(const summary of ordered) {
        if(hashes.size>=opts['per-hull']*3) break;
        const id=Number(summary?.killmail_id), hash=String(summary?.zkb?.hash||'');
        if(!Number.isSafeInteger(id)||id<=0||!/^[a-f\d]{20,80}$/i.test(hash)) continue;
        let mail;
        try{mail=await cachedJson(`https://esi.evetech.net/latest/killmails/${id}/${hash}/?datasource=tranquility`,path.join(opts.cache,'esi',`${id}.json`));}
        catch(e){failures++;continue;}
        const fit=fromKillmail(hull,summary,mail);
        if(!fit) continue;
        const modules=fit.fitData.filter(x=>[...Array(24)].some((_,n)=>x[1]===11+n)||[92,93,94,95,96,97,98,99,125,126,127,128,129,130,131,132,164,165,166,167,168,169,170,171].includes(x[1])).length;
        if(modules<opts['min-modules']) continue;
        const signature=JSON.stringify(fit.fitData.slice().sort((a,b)=>a[1]-b[1]||a[0]-b[0]));
        if(hashes.has(signature)) continue;
        hashes.add(signature);candidates.push(fit);
      }
    }
    process.stdout.write(`[${h+1}/${hulls.length}] ${hull.shipName}: ${hashes.size} candidates\n`);
  }
  const catalog=buildCatalog(hulls,candidates,sde,opts['per-hull']);
  catalog.summary.apiFailures=failures;
  catalog.summary.dogmaValidated=Boolean(sde.dogma);
  catalog.summary.note='Public combat loss snapshots; verified against pinned SDE dogma but not curated recommendations. Never auto-grant items.';
  const parent=path.dirname(path.resolve(opts.out));fs.mkdirSync(parent,{recursive:true});
  const tmp=`${path.resolve(opts.out)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp,JSON.stringify(catalog,null,2));fs.renameSync(tmp,path.resolve(opts.out));
  process.stdout.write(`CATALOG_WRITTEN ${path.resolve(opts.out)} ${JSON.stringify(catalog.summary)}\n`);
}
if(require.main===module)harvest(args(process.argv.slice(2))).catch(e=>{console.error(`HARVEST_FAILED ${e.message}`);process.exitCode=1;});
module.exports={args,cachedJson,harvest};