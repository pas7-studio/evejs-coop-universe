'use strict';
/** PF86: read-only source pins of ORIGINAL in-process EveJS authorities.
 * No require() of the server, no database, no network, no gameplay, no writes.
 */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const nativeRoot=process.env.PF86_NATIVE_WORKTREE;
if(typeof nativeRoot!=='string'||!path.isAbsolute(nativeRoot))
 throw Error('PF86_ABSOLUTE_ORIGINAL_CHECKOUT_REQUIRED');
const root=fs.realpathSync(nativeRoot);
if(root.split(/[\\/]+/).some(p=>['play','prod','production','deploy','deployment'].includes(p.toLowerCase())))
 throw Error('PF86_PLAY_OR_PROD_PATH_FORBIDDEN');
const sources=Object.freeze([
 ['Code/server/src/gameStore/index.js','a982b8a3d607cb9487a65336bcfdcbba929797b5',
  ['module.exports.coopAtomicNativeRows']],
 ['Code/server/src/space/coopGameStoreAtomic.js','2b28b48145f3fbc989ce7346384487ee75e52280',
  ['createGameStoreAdapter','SERVER_INTERNAL_FLAGGED','isPoisoned']],
 ['Code/server/src/services/inventory/itemStore.js','e992d56ee9cff1911d54247bf46d44d01e5d8060',
  ['function findItemById(', 'function moveShipToSpace(', 'findItemById,','moveShipToSpace,']],
 ['Code/server/src/services/chat/sessionRegistry.js','01892cb8f6e35ef46268eae5f2909fd96c4a2a51',
  ['function getSessions(', 'getSessions,']],
 ['Code/server/src/space/npc/npcRegistry.js','990197ea61d89ddc3f22450840eb047bc548278c',
  ['getControllerByEntityID,']],
 ['Code/server/src/space/npc/nativeNpcStore.js','95724ab4537683e7ee933bc3149d0a891082ce7e',
  ['getNativeEntity,','getNativeController,','listNativeModulesForEntity,','listNativeCargoForEntity,']]
]);
for(const [relative,expected,required] of sources){
 test('PF86 original native provider remains exact: '+relative,()=>{
  const real=fs.realpathSync(path.join(root,relative));
  assert.ok(real.startsWith(root+path.sep),'PF86_SOURCE_PATH_ESCAPE');
  const data=fs.readFileSync(real);
  const actual=crypto.createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
  assert.equal(actual,expected,'PF86_ORIGINAL_PROVIDER_SOURCE_DRIFT: '+relative);
  const text=data.toString('utf8');
  for(const marker of required)
   assert.ok(text.includes(marker),'PF86_ORIGINAL_PROVIDER_API_DRIFT: '+relative+' '+marker);
 });
}
