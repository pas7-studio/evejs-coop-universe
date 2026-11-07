'use strict';
// PF-48: strictly read-only scanner of an authoritative EveJS checkout.
// Source discovery is NOT proof of transactional fencing or permission to enable Personal Fleet.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const EXPECTED = Object.freeze([
  {path:'Code/server/src/space/coopGameStoreAtomic.js', label:'atomic-store', anchors:['BEGIN IMMEDIATE','synchronous = FULL']},
  {path:'Code/server/src/space/npc/nativeNpcStore.js', label:'native-actor-store', anchors:[]},
  {path:'Code/server/src/services/mining/miningNpcOperations.js', label:'stock-mining', anchors:['spawnFleetWing(', 'upsertNativeCargo(']},
  {path:'Code/server/src/space/coopNativeMiningFleetDurable.js', label:'mining-startup-restore', anchors:['coopMiningFleetSlots','materializeStoredNativeController']},
  {path:'Code/server/src/space/coopNativeMiningAtomic.js', label:'ore-settlement', anchors:['miningRuntimeState','npcCargo']},
  {path:'Code/server/src/space/coopNativeHaulTransferAtomic.js', label:'haul-settlement', anchors:['npcCargo']},
  {path:'Code/server/src/space/coopNativeHaulCargo.js', label:'haul-custody', anchors:[]},
  {path:'Code/server/src/space/coopNativeHaulManifest.js', label:'haul-manifest', anchors:[]},
  {path:'Code/server/src/space/coopNativeStationArrival.js', label:'haul-unload', anchors:[]},
  {path:'Code/server/src/space/coopPlayerMiningShiftOrders.js', label:'player-mining-shift', anchors:['transact(']},
  {path:'Code/server/src/space/coopPlayerMiningFleetTick.js', label:'mining-fleet-scheduler', anchors:[]},
  {path:'Code/server/src/space/coopNpcExpeditionDirector.js', label:'exploration-director', anchors:[]},
  {path:'Code/server/src/space/coopNpcExpeditionOperations.js', label:'exploration-writers', anchors:[]},
  {path:'Code/server/src/space/coopNativeGateTransfer.js', label:'native-cross-system-transfer', anchors:[]},
  {path:'Code/server/src/space/coopWarFleetRegistry.js', label:'war-ownership', anchors:['coopAtomicNativeRows.transact']},
  {path:'Code/server/src/space/coopNpcOrderBridge.js', label:'native-order-bridge', anchors:[]},
  {path:'Code/server/src/space/coopNpcOrderArbiter.js', label:'native-order-arbiter', anchors:[]},
]);
const REQUIRED_NATIVE_PF = Object.freeze([
  'Code/server/src/space/coopPersonalFleetMiningQuiescenceAudit.js',
  'Code/server/src/space/coopPersonalFleetMiningShutdownProtocol.js',
  'Code/server/src/space/coopPersonalFleetMiningGameStoreAdapter.js',
]);
const MAX_FILES = 12000, MAX_BYTES_PER_FILE = 2_000_000;
const relevantPath = s => /(?:mining|miner|haul|expedit|explor|fleettick|warp|gatetransfer)/i.test(s);
const sourceSuffix = s => /\.(?:js|cjs)$/i.test(s);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const mutator = /\b(?:nativeNpcStore|nativeStore|store)\.(?:upsertNative\w+|removeNative\w+|allocateCargoID)\s*\(|\b(?:gameStore|db)\.write\s*\(|\b(?:authority|atomic|coopAtomicNativeRows)\.transact\s*\(|\b(?:spawnFleetWing|materializeStoredNativeController|commitScene)\s*\(/g;
const safePath = s => !s.includes('\\') && !s.includes('\0') && s.split('/').every(p => p && p !== '.' && p !== '..');
function listSourceFiles(srcRoot) {
  const result=[], errors=[];
  let scanned=0;
  function descend(dir, rel='') {
    let nodes;
    try {nodes=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'));}
    catch(e){errors.push({code:'DIRECTORY_UNREADABLE',path:rel,detail:e.code||'UNKNOWN'});return;}
    for(const node of nodes){
      const sub=rel ? rel+'/'+node.name : node.name;
      if(!safePath(sub)){errors.push({code:'UNSAFE_PATH',path:sub});continue;}
      const abs=path.join(dir,node.name);
      if(node.isSymbolicLink()){errors.push({code:'SYMLINK_NOT_INSPECTED',path:sub});continue;}
      if(node.isDirectory()){descend(abs,sub);continue;}
      if(!node.isFile()||!sourceSuffix(sub))continue;
      scanned++;
      if(scanned>MAX_FILES){errors.push({code:'SOURCE_COUNT_EXCEEDS_LIMIT',count:scanned});return;}
      let st;
      try{st=fs.statSync(abs);}catch(e){errors.push({code:'FILE_UNREADABLE',path:sub});continue;}
      if(st.size>MAX_BYTES_PER_FILE){errors.push({code:'SOURCE_TOO_LARGE',path:sub,size:st.size});continue;}
      try{const text=fs.readFileSync(abs,'utf8');result.push({path:'Code/server/src/'+sub,source:text,bytes:Buffer.byteLength(text)});}
      catch(e){errors.push({code:'FILE_UNREADABLE',path:sub});}
    }
  }
  descend(srcRoot);
  return {files:result,errors};
}
function nativeRevision(root){
  try {
    const r=spawnSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',timeout:3000,windowsHide:true});
    return r.status===0 && /^[a-f0-9]{40}\s*$/.test(r.stdout) ? r.stdout.trim() : null;
  }catch{return null;}
}
function inspectNativeWriterCoverage({forkRoot,requireGit=true}={}){
  if(typeof forkRoot!=='string'||!forkRoot.trim())throw Error('PF48_FORK_ROOT_REQUIRED');
  const root=path.resolve(forkRoot),srcRoot=path.join(root,'Code','server','src');
  if(!fs.existsSync(srcRoot)||!fs.statSync(srcRoot).isDirectory())throw Error('PF48_NATIVE_SOURCE_ROOT_NOT_FOUND');
  const {files,errors}=listSourceFiles(srcRoot);
  const lookup=new Map(files.map(f=>[f.path,f]));
  const critical=EXPECTED.map(entry=>{
    const f=lookup.get(entry.path);
    if(!f)return {path:entry.path,label:entry.label,status:'MISSING'};
    const absent=entry.anchors.filter(a=>!f.source.includes(a));
    return {path:entry.path,label:entry.label,status:absent.length?'ANCHOR_MISSING':'INSPECTED',
      missingAnchors:absent,sha256:sha256(f.source),bytes:f.bytes};
  });
  const nativePF=REQUIRED_NATIVE_PF.map(p=>({path:p,present:lookup.has(p)}));
  const candidates=[];
  for(const f of files){
    if(!relevantPath(f.path))continue;
    const occurrences=[];mutator.lastIndex=0;
    let match;
    while((match=mutator.exec(f.source))!==null && occurrences.length<48){
      const line=f.source.slice(0,match.index).split('\n').length;
      occurrences.push({line,api:match[0].trim()});
    }
    if(occurrences.length)candidates.push({path:f.path,sourceSha256:sha256(f.source),occurrences});
  }
  candidates.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const revision=nativeRevision(root);
  const entries=files.map(f=>[f.path,sha256(f.source)]).sort((a,b)=>a[0].localeCompare(b[0],'en'));
  const fingerprint=sha256(JSON.stringify(entries));
  const blockers=[];
  if(requireGit&&!revision)blockers.push('GIT_REVISION_UNVERIFIED');
  for(const x of critical)if(x.status!=='INSPECTED')blockers.push('CRITICAL_SOURCE_'+x.status+':'+x.path);
  for(const x of nativePF)if(!x.present)blockers.push('NATIVE_PF_COMPONENT_MISSING:'+x.path);
  for(const x of errors)blockers.push('SOURCE_SCAN_INCOMPLETE:'+x.code+':'+(x.path||''));
  // Static file enumeration CAN NEVER certify that live controllers, delayed
  // callbacks, independent processes or dynamic runtime writers use the gate.
  blockers.push('RUNTIME_WRITER_FENCE_NOT_PROVEN');
  blockers.push('PF43_PF44_PF45_NATIVE_LEASE_AND_AUDIT_NOT_ATTESTED');
  blockers.push('NO_WORK_GAMEPLAY_E2E');
  return Object.freeze({schemaVersion:1,kind:'PF48_NATIVE_SOURCE_INVENTORY',status:'BLOCKED_FOR_ACTIVATION',
    revision,fingerprint,scannedSourceFiles:files.length,critical,nativePF,candidates,
    scanErrors:errors,blockers,sourceOnly:true,gameplayProven:false,
    releaseAuthority:false});
}
module.exports={EXPECTED,REQUIRED_NATIVE_PF,inspectNativeWriterCoverage};