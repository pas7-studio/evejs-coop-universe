'use strict';
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=require('node:fs');
const {tmpdir}=require('node:os'),{join,dirname}=require('node:path');
const {spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
const patch=join(__dirname,'../patches/PF50-native-haul-writer.patch');
const root=mkdtempSync(join(tmpdir(),'pf50-patch-'));
const haul='Code/server/src/space/coopNativeHaulTransferAtomic.js';
const isol='Code/server/src/space/coopNativeCargoTransientIsolation.js';
try {
 function fake(path,positions,max){
   const lines=Array.from({length:max},()=> '// untouched original source');
   for(const [i,v] of Object.entries(positions))lines[Number(i)-1]=v;
   mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),lines.join('\n')+'\n');
 }
 fake(haul,{
 23:'function createAtomicHaulMover({gameStore,nativeStore,resolveType,clock=()=>Date.now()}={}){',
 119:'  const remaining=quantity-movedQuantity;',120:'  let destinationID=id;',
 150:'   outcome=authority.transact(["npcCargo"],tx=>{',151:'    const old=tx.get("npcCargo",receiptKey(destinationID));',
 170:'    return proof;',171:'   });',
 198:'   hauler.nativeCargoItems=rebuilt;'
 },218);
 fake(isol,{
 71:'const CONTRACTS=Object.freeze([HAUL_TRANSFER,MINING_CYCLE,MINING_CYCLE_PF,AMMO_BANK]);',
 138:'    error("PF49_OWNERSHIP_ROWS_READ_ONLY");'
 },212);
 for(const a of [['git',['init','-q']],['git',['apply','--check','--unidiff-zero',patch]],['git',['apply','--unidiff-zero',patch]]]){
   const r=spawnSync(a[0],a[1],{cwd:root,encoding:'utf8'});
   assert.equal(r.status,0,`git ${a[1].join(' ')}: ${r.stderr}`);
 }
 const src=readFileSync(join(root,haul),'utf8');
 assert(src.indexOf('beginHaulWrite(')<src.indexOf('let destinationID=id;'));
 assert(src.includes('id,sha(before),movedQuantity,partial')); 
 assert(src.indexOf('assertHaulWriteAuthorized(')<src.indexOf('const old=tx.get('));
 assert(src.indexOf('finishHaulWrite(')>src.indexOf('hauler.nativeCargoItems=rebuilt;'));
 assert(src.includes('pfFence?["npcCargo","corporationRuntime"]:["npcCargo"]'));
 const iso=readFileSync(join(root,isol),'utf8');
 assert(iso.includes('const HAUL_TRANSFER_PF=Object.freeze('));
 assert(iso.includes('PF50_OWNERSHIP_ROWS_READ_ONLY'));
 assert(existsSync(join(root,'Code/server/src/space/coopPersonalFleetHaulTxnGuard.js')));
 console.log('PF50_PATCH_SMOKE_PASS');
} finally {rmSync(root,{recursive:true,force:true})}