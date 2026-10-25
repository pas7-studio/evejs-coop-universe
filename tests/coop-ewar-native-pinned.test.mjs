import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {Script} from 'node:vm';
const require=createRequire(import.meta.url);
const {patchEwarDogma,targets}=require('../scripts/coop-ewar-dogma-patch.cjs');
const {auditCodeRoot}=require('../scripts/coop-ewar-native-audit.cjs');
const codeRoot=process.env.EVEJS_COOP_CODE_PATH || process.env.EVEJS_CODE_PATH || '';
const hasCode=codeRoot && existsSync(resolve(codeRoot,'server/src/space/modules/hostileModuleRuntime.js'));
test('actual pinned native EWAR module source accepts opt-in patch and byte-exact rollback',
  {skip:hasCode?false:'pinned EveJS Code tree unavailable in this environment'},()=>{
    for(const file of Object.keys(targets)){
      const source=readFileSync(resolve(codeRoot,file),'utf8');
      const patched=patchEwarDogma(source,file);
      assert.notEqual(patched,source);
      new Script(patched,{filename:file});
      assert.equal(patchEwarDogma(patched,file),patched);
      assert.equal(patchEwarDogma(patched,file,{remove:true}),source);
    }
});
test('all five pinned native role families and NPC authority contracts are present',
 {skip:hasCode?false:'pinned EveJS Code tree unavailable in this environment'},()=>{
  const result=auditCodeRoot(codeRoot);
  assert.equal(result.status,'SOURCE_ONLY_PRESENT',JSON.stringify(result.files.filter(x=>x.missing.length)));
  assert.equal(result.liveGameplayVerified,false);
 });
