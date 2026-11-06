'use strict';
/**
 * PF90: read-only native ownership and persistence-hazard audit.
 * Never install patch files, start a server, or authorize Personal Fleet.
 * This is a LOCAL WORK diagnosis, not a substitute for stock owner commits.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PINNED=Object.freeze([
 {role:'STOCK_ITEMS_OWNER',path:'Code/server/src/services/inventory/itemStore.js',
  blob:'e992d56ee9cff1911d54247bf46d44d01e5d8060',
  anchors:['function readItems(','function writeItems(','repo.write(ITEMS_TABLE, "/", data, dbOptions);',
   'module.exports.coopInvalidateAfterAtomicRows']},
 {role:'STOCK_CHARACTERS_OWNER',path:'Code/server/src/services/character/characterState.js',
  blob:'8a002d190899b6cb1e1068a565451e6d1d808401',
  anchors:['function writeCharacterRecord(','function activateShipForSession(',
   'repo.write(CHARACTERS_TABLE,','module.exports.coopInvalidateAfterAtomicRows']},
 {role:'GAMESTORE_CACHE_AND_FLUSH',path:'Code/server/src/gameStore/index.js',
  blob:'a982b8a3d607cb9487a65336bcfdcbba929797b5',
  anchors:['function write(table, pth, data, options = {})','const sameReference = cache[table] === data;',
   'scheduleFlush(table);','coopAtomicNativeRows']},
 {role:'GAMESTORE_OWNER_REPOSITORY',path:'Code/server/src/gameStore/tableRepository.js',
  blob:'f3fbd1ed17223f601ba1c145b13fb77bcd98c27f',
  anchors:['function createTableRepository(','store.write(table, pathArg, value, opts)']},
 {role:'GAMESTORE_NATIVE_ATOMIC',path:'Code/server/src/space/coopGameStoreAtomic.js',
  blob:'2b28b48145f3fbc989ce7346384487ee75e52280',
  anchors:['BEGIN IMMEDIATE','synchronous = FULL',
   'function createGameStoreAdapter(','invalidateNativeItems("commit")']}
]);
const hash=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const deny=reason=>({status:'BLOCKED',reason});
function inspectOriginalOwners({forkRoot,files=PINNED}={}){
 if(typeof forkRoot!=='string'||!path.isAbsolute(forkRoot))
  throw Error('PF90_ABSOLUTE_NATIVE_ROOT_REQUIRED');
 const root=fs.realpathSync(forkRoot);
 if(root.split(/[\\/]+/).some(p=>['play','prod','production','deploy'].includes(p.toLowerCase())))
  throw Error('PF90_LIVE_ROOT_NOT_ALLOWED');
 const results=[];
 for(const entry of files){
  if(typeof entry.path!=='string'||!entry.path.startsWith('Code/server/src/')||
     entry.path.includes('..')||path.isAbsolute(entry.path)||
     !/^[a-f0-9]{40}$/.test(entry.blob)||!Array.isArray(entry.anchors))
   throw Error('PF90_OWNER_SOURCE_MANIFEST_INVALID');
  let body,digest;
  try{
   const file=fs.realpathSync(path.join(root,entry.path));
   if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())
    throw Error('PF90_UNSAFE_ORIGINAL_SOURCE');
   body=fs.readFileSync(file);
   digest=hash(body);
  }catch(e){
   results.push({role:entry.role,path:entry.path,status:'SOURCE_MISSING_OR_UNREADABLE',
    reason:String(e.code||e.message||e)});continue;
  }
  const source=body.toString('utf8');
  const missing=entry.anchors.filter(a=>!source.includes(a));
  const altered=digest!==entry.blob;
  // These are diagnostic markers only. An installed marker (including a fake
  // source comment) cannot attest runtime single-writer fencing.
  const installed=source.includes('PF90_STOCK_OWNER_SNAPSHOT_ATOMIC_V1');
  results.push({role:entry.role,path:entry.path,blob:digest,
   expectedBlob:entry.blob,status:altered?'SOURCE_PIN_DRIFT':missing.length?
    'ORIGINAL_OWNER_API_DRIFT':installed?'UNVERIFIED_OWNER_HOOK_CANDIDATE':
    'OWNER_HOOK_ABSENT',missingAnchors:missing,hookMarker:installed});
 }
 const byRole=Object.fromEntries(results.map(x=>[x.role,x]));
 const stockOwner=byRole.STOCK_ITEMS_OWNER,
       storage=byRole.GAMESTORE_CACHE_AND_FLUSH,
       character=byRole.STOCK_CHARACTERS_OWNER,
       atomic=byRole.GAMESTORE_NATIVE_ATOMIC;
 const originalPresent=results.every(x=>x.status==='OWNER_HOOK_ABSENT');
 const risks={
  inventoryReadsSharedCache:originalPresent&&!!stockOwner,
  inventoryWritesThroughScheduledCacheFlush:originalPresent&&!!storage,
  characterShipTitleOutsidePFAtomic:originalPresent&&!!character,
  nativeAtomicAdaptorExists:!!atomic&&atomic.status==='OWNER_HOOK_ABSENT'
 };
 const blockers=results.filter(x=>x.status!=='OWNER_HOOK_ABSENT').map(x=>
  x.role+':'+x.status);
 blockers.push('PF90_STOCK_OWNER_COMMIT_AND_CACHE_ROLLBACK_NOT_PROVEN');
 blockers.push('PF90_CHARACTER_ACTIVE_SHIP_WRITER_NOT_ATOMICALLY_FENCED');
 blockers.push('PF90_NATIVE_WORK_TWO_CLIENT_E2E_NOT_RUN');
 return Object.freeze({schemaVersion:1,kind:'PF90_ORIGINAL_SINGLE_WRITER_HAZARD_AUDIT',
  status:'BLOCKED_FOR_ACTIVATION',ownerPaths:results,originalRisks:risks,
  blockers,featureEnabled:false,sourceOnly:true,releaseAuthority:false});
}
if(require.main===module){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--fork-root')
   throw Error('PF90_USAGE: node inspect-original-owner-writes.cjs --fork-root ABSOLUTE_NATIVE_ROOT');
  const report=inspectOriginalOwners({forkRoot:process.argv[3]});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  process.exitCode=2;
 }catch(e){process.stderr.write(String(e.message||e)+'\n');process.exitCode=2;}
}
module.exports={inspectOriginalOwners,PINNED};
