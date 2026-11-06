'use strict';
/**
 * PF88: offline, read-only source coverage inventory for original EveJS.
 * Does NOT patch the engine, install hooks, run CI or authorize activation.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGINAL=Object.freeze([
 {role:'STOCK_INVENTORY',path:'Code/server/src/services/inventory/itemStore.js',
  sha:'e992d56ee9cff1911d54247bf46d44d01e5d8060',
  anchors:['function writeItems(','function updateInventoryItem(',
   'function removeInventoryItem(','function syncCharacterActiveShip(']},
 {role:'STOCK_CHARACTER',path:'Code/server/src/services/character/characterState.js',
  sha:'8a002d190899b6cb1e1068a565451e6d1d808401',
  anchors:['function writeCharacterRecord(','function removeCharacterRecord(']},
 {role:'NATIVE_MINING',path:'Code/server/src/services/mining/miningNpcOperations.js',
  sha:'abccec6f0277a299df2ae441fd599cdfde802d93',
  anchors:['function spawnFleetWing(']},
 {role:'DURABLE_MINING_RECOVERY',path:'Code/server/src/space/coopNativeMiningFleetDurable.js',
  sha:'2162c82ccdc358b47ef622308de26b7345eeaf43',
  anchors:['materializeStoredNativeController']},
 {role:'NATIVE_WAR',path:'Code/server/src/space/coopWarFleetRegistry.js',
  sha:'d8bce76a9d033bf9c33e22b8b9d26852a23c92ed',
  anchors:['coopAtomicNativeRows.transact']},
 {role:'NATIVE_EXPLORATION',path:'Code/server/src/space/coopNpcExpeditionOperations.js',
  sha:'3044d46c1a1486a63b2273367832ef6a5e50760c',
  anchors:['function createNpcExpeditionOperations(']}
]);
const PIN=/^[a-f0-9]{40}$/;
const sha=data=>crypto.createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
function inspectOriginalWriterHooks({forkRoot,sources=ORIGINAL}={}){
 if(typeof forkRoot!=='string'||!path.isAbsolute(forkRoot))
  throw Error('PF88_ABSOLUTE_ORIGINAL_FORK_REQUIRED');
 const root=fs.realpathSync(forkRoot);
 if(root.split(/[\\/]+/).some(p=>
   ['play','prod','production','deploy','deployment'].includes(p.toLowerCase())))
  throw Error('PF88_LIVE_OR_DEPLOYMENT_ROOT_FORBIDDEN');
 const results=[];
 for(const entry of sources){
  if(typeof entry.path!=='string'||entry.path.includes('..')||
     path.isAbsolute(entry.path)||!PIN.test(entry.sha)||
     !Array.isArray(entry.anchors))
   throw Error('PF88_SOURCE_PIN_MANIFEST_INVALID');
  const target=path.join(root,entry.path);
  let body,got;
  try{
   const real=fs.realpathSync(target);
   if(!real.startsWith(root+path.sep))throw Error('PF88_SYMLINK_ESCAPE');
   if(!fs.statSync(real).isFile())throw Error('PF88_NOT_FILE');
   body=fs.readFileSync(real);
   got=sha(body);
  }catch(e){
   results.push({role:entry.role,path:entry.path,status:'MISSING_OR_UNREADABLE',
    reason:String(e.code||e.message||e)});continue;
  }
  const text=body.toString('utf8');
  const absent=entry.anchors.filter(a=>!text.includes(a));
  const pinned=got===entry.sha;
  // Static markers alone, even in an executable position, can be forged.
  // These are only CANDIDATES for real-original engine review, never authority.
  const marker=text.includes('PF88_RECIPROCAL_ORIGINAL_WRITER_HOOK_V1');
  const candidate=marker&&/checkForeignWriterWithinTransaction\s*\(\s*\{[^}]*\btx\b/.test(text);
  results.push({role:entry.role,path:entry.path,status:!pinned?'SOURCE_PIN_DRIFT':
    absent.length?'ORIGINAL_API_DRIFT':candidate?'CANDIDATE_HOOK_NOT_PROVEN':
    'RECIPROCAL_HOOK_NOT_INSTALLED',gitBlob:got,expectedBlob:entry.sha,
    missingOriginalAnchors:absent,candidateHook:!!candidate});
 }
 const blockers=results.filter(x=>x.status!=='CANDIDATE_HOOK_NOT_PROVEN')
  .map(x=>x.role+':'+x.status);
 blockers.push('PF88_ORIGINAL_RUNTIME_HOOK_PROVENANCE_NOT_VERIFIED');
 blockers.push('PF88_SHARED_DB_WRITER_COVERAGE_NOT_VERIFIED');
 blockers.push('PF88_TWO_CLIENT_GAMEPLAY_NOT_RUN');
 return Object.freeze({version:1,kind:'PF88_ORIGINAL_RECIPROCAL_WRITER_AUDIT',
  status:'BLOCKED_FOR_ACTIVATION',featureEnabled:false,sourceOnly:true,
  nativeFilesReviewed:results.length,results,blockers,
  gameplayProven:false,releaseAuthority:false});
}
if(require.main===module){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--fork-root')
   throw Error('PF88_USAGE: node inspect-original-writer-hooks.cjs --fork-root ABSOLUTE_PATH');
  const report=inspectOriginalWriterHooks({forkRoot:process.argv[3]});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  process.exitCode=2; // Never authorize activation based on static source alone.
 }catch(e){
  process.stderr.write(String(e.message||e)+'\n');
  process.exitCode=2;
 }
}
module.exports={inspectOriginalWriterHooks,ORIGINAL};
