import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {resolveCharacterID,currentTutorialState,supportedEnvironment}=require('../integration/coopNpeSafety.cjs');
const {patch}=require('../scripts/coop-npe-native-state-patch.cjs');
const records=new Map([[1001,{accountId:501}],[1002,{accountId:502}]]);
const session=(account,character)=>({userid:account,characterID:character,charid:character,socket:{destroyed:false}});
const context={getCharacterRecord:id=>records.get(id)||null,getSnapshot:id=>({exists:records.has(id),tutorialState:id===1001?21:22})};
test('selected authenticated character may query own state',()=>{assert.equal(resolveCharacterID([],session(501,1001),context),1001);assert.equal(resolveCharacterID([1001],session(501,1001),context),1001);assert.equal(currentTutorialState([],session(501,1001),context),21)});
test('two characters have independent native tutorial states',()=>assert.equal(currentTutorialState([],session(502,1002),context),22));
test('cross-character forged RPC arg denied',()=>assert.throws(()=>resolveCharacterID([1002],session(501,1001),context),/FOREIGN_CHARACTER/));
test('missing authenticated selected character denied',()=>assert.throws(()=>resolveCharacterID([],{},context),/SELECTED_CHARACTER_REQUIRED/));
test('client alias disagreement denied',()=>assert.throws(()=>resolveCharacterID([],{...session(501,1001),charid:1002},context),/CONFLICT/));
test('account ownership mismatch denied',()=>assert.throws(()=>resolveCharacterID([],session(502,1001),context),/ACCOUNT_CHARACTER_MISMATCH/));
test('disconnected client cannot mutate tutorial state',()=>assert.throws(()=>resolveCharacterID([],{...session(501,1001),socket:{destroyed:true}},context),/DISCONNECTED/));
test('accountless API usage denied',()=>assert.throws(()=>resolveCharacterID([],{...session(501,1001),userid:null},context),/ACCOUNT_REQUIRED/));
test('missing/invalid native tutorial snapshot denied',()=>assert.throws(()=>currentTutorialState([],session(501,1001),{...context,getSnapshot:()=>({exists:false})}),/UNAVAILABLE/));
test('no synthetic starter reward or Starter Space claim',()=>assert.deepEqual(supportedEnvironment({snapshot:{exists:true}}),{nativeTutorialState:true,starterSpaceVerified:false,starterRewardsIssuedByCoop:false}));
const air=`function resolveCharacterID(args, session) {
  const directArg = Array.isArray(args) ? Number(args[0]) : NaN;
  if (Number.isFinite(directArg) && Math.trunc(directArg) > 0) {
    return Math.trunc(directArg);
  }
  return Number(session && (session.charid || session.characterID || 0)) || 0;
}`;
const tutorial=`  Handle_GetCharacterTutorialState() {
    log.debug("[TutorialSvc] GetCharacterTutorialState");
    return 0;
  }`;
const ach=`    return persistedValue ?? true;
      GOLDEN_LOGIN_EVENT_COUNT_ENTRIES,
      GOLDEN_LOGIN_COMPLETED_ACHIEVEMENT_ENTRIES,`;
for(const [file,fixture] of [['server/src/services/npe/airNpeService.js',air],['server/src/services/npe/nesIntroService.js',air],['server/src/services/account/tutorialSvcService.js',tutorial],['server/src/services/character/achievementTrackerMgrService.js',ach]]){
 test(file+' reversible overlay and CRLF',()=>{
  const updated=patch(fixture,file);
  assert.match(updated,/EVEJS_COOP_NPE_NATIVE_SAFETY/);
  assert.equal(patch(updated,file,true),fixture);
  assert.equal(patch(updated,file),updated);
  assert.equal(patch(fixture,file,true),fixture);
  const crlf=fixture.replace(/\n/g,'\r\n');
  assert.equal(patch(patch(crlf,file),file,true),crlf);
  assert.throws(()=>patch(fixture.replace(/return 0|persistedValue|directArg/g,'BROKEN'),file),/COOP38_SOURCE_ANCHOR_MISMATCH/);
 });
}
