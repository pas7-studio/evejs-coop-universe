'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.env.PF100_NATIVE_WORKTREE;
const pins={
 'Code/server/src/services/chat/sessionRegistry.js':'01892cb8f6e35ef46268eae5f2909fd96c4a2a51',
 'Code/server/src/services/structure/structureLocation.js':'0e12ae00721359d526c4453529c81a16f337df22',
 'Code/server/src/services/character/charService.js':'c1159a66622370cd1fd3f5963cddd5de7fe6a52e',
 'Code/server/src/services/character/characterState.js':'8a002d190899b6cb1e1068a565451e6d1d808401',
 'Code/server/src/services/inventory/itemStore.js':'e992d56ee9cff1911d54247bf46d44d01e5d8060',
 'Code/server/src/space/coopGameStoreAtomic.js':'2b28b48145f3fbc989ce7346384487ee75e52280'
};
for(const [relative,sha] of Object.entries(pins)){
 test('PF100 pin original '+relative,{skip:!root},()=>{
  const file=path.join(root,relative);
  assert.equal(fs.statSync(file).isFile(),true);
  const actual=cp.execFileSync('git',['hash-object',file],{encoding:'utf8'}).trim();
  assert.equal(actual,sha,'Source drift blocks native activation: '+relative);
 });
}
