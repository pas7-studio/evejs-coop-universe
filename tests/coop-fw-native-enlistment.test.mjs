import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
const require=createRequire(import.meta.url);
const G=require('../integration/coopFwEnlistmentGate.cjs');
const P=require('../scripts/coop-fw-native-enlistment-patch.cjs');
const SESSION={characterID:90000001,corporationID:98000001};
const CHAR={characterID:SESSION.characterID,corporationID:SESSION.corporationID,directFactionID:null,directEnlistmentCooldownTimestamp:'0'};
const CORP={corporationID:SESSION.corporationID,ceoID:90000005,isNPC:false};
const pass=(over={})=>G.validateDirect({session:SESSION,characterID:SESSION.characterID,factionID:500001,
 character:CHAR,corporation:CORP,corpRuntime:{fw:{allowedEnlistmentFactions:[500001,500002,500003,500004,500010,500011]}},standing:0,
 nowFiletime:135000000000000000n,...over});
const deny=(result,reason)=>{assert.equal(result.ok,false);assert.equal(result.error,reason);};
test('six documented native militia factions only; others fail closed',()=>{
 for(const factionID of G.DIRECT_FACTIONS) assert.equal(pass({factionID}).ok,true);
 for(const factionID of [0,-1,1,500005,500012,500028,999999,NaN,500001.5,'500001'])
  deny(pass({factionID}),'FW_UNSUPPORTED_MILITIA_FACTION');
});
test('raw standings 0 eligible, negative rejected, effective-standing or invalid receipt never substituted',()=>{
 assert.equal(pass({standing:0}).ok,true);
 assert.equal(pass({standing:10}).ok,true);
 for(const standing of [-0.001,-10,NaN,Infinity,'0',null])deny(pass({standing}),'FW_RAW_FACTION_STANDING_TOO_LOW');
});
test('cooldown is exact bigint FileTime (24h, no JS number overflow)',()=>{
 const now=135000000000000000n;
 assert.equal(pass({character:{...CHAR,directEnlistmentCooldownTimestamp:String(now)},nowFiletime:now}).ok,true);
 deny(pass({character:{...CHAR,directEnlistmentCooldownTimestamp:String(now+1n)},nowFiletime:now}),'FW_DIRECT_ENLISTMENT_COOLDOWN_ACTIVE');
 deny(pass({character:{...CHAR,directEnlistmentCooldownTimestamp:'not-a-date'}}),'FW_COOLDOWN_UNVERIFIABLE');
 deny(pass({nowFiletime:0}),'FW_COOLDOWN_UNVERIFIABLE');
});
test('re-enlist another militia without retiring is rejected; same faction is idempotent',()=>{
 deny(pass({character:{...CHAR,directFactionID:500003}}),'FW_RETIRE_BEFORE_REENLIST');
 assert.equal(pass({character:{...CHAR,directFactionID:500001}}).ok,true);
});
test('authoritative session/character/corporation matches required',()=>{
 deny(pass({session:{...SESSION,characterID:111}}),'FW_CHARACTER_CORPORATION_MISMATCH');
 deny(pass({characterID:0}),'FW_CHARACTER_CORPORATION_MISMATCH');
 deny(pass({corporation:{...CORP,corporationID:9811001}}),'FW_CHARACTER_CORPORATION_MISMATCH');
 deny(pass({character:{...CHAR,corporationID:9811001}}),'FW_CHARACTER_CORPORATION_MISMATCH');
 deny(pass({session:{...SESSION,corporationID:0}}),'FW_CHARACTER_CORPORATION_MISMATCH');
});
test('player corp Direct Enlistment requires explicit faction authorisation; NPC corps do not manage a whitelist',()=>{
 assert.equal(pass({corpRuntime:{fw:{allowedEnlistmentFactions:[500001]}}}).ok,true);
 deny(pass({corpRuntime:{fw:{allowedEnlistmentFactions:[500004]}}}),'FW_CORP_ENLISTMENT_FACTION_DENIED');
 deny(pass({corpRuntime:{fw:{allowedEnlistmentFactions:'500001'}}}),'FW_CORP_ENLISTMENT_POLICY_UNVERIFIABLE');
 deny(pass({corpRuntime:{fw:{allowedEnlistmentFactions:[]}}}),'FW_CORP_ENLISTMENT_FACTION_DENIED');
 deny(pass({corpRuntime:null}),'FW_CORP_ENLISTMENT_FACTION_DENIED');
 assert.equal(pass({corporation:{...CORP,isNPC:true},corpRuntime:null}).ok,true);
});
test('retirement only with a genuinely directly enlisted character',()=>{
 assert.equal(G.validateRetire({session:SESSION,characterID:SESSION.characterID,character:{...CHAR,directFactionID:500002}}).ok,true);
 deny(G.validateRetire({session:SESSION,characterID:SESSION.characterID,character:CHAR}),'FW_NOT_DIRECTLY_ENLISTED');
 deny(G.validateRetire({session:{...SESSION,characterID:42},characterID:SESSION.characterID,character:CHAR}),'FW_CHARACTER_NOT_FOUND');
});
const pol=(over={})=>G.validateCorpPolicy({session:SESSION,corporation:CORP,
 member:{characterID:SESSION.characterID,corporationID:SESSION.corporationID,roles:'1'},factions:[500001,500010],...over});
test('corp policy changes restricted to actual CEO or persisted Director',()=>{
 assert.equal(pol().ok,true);
 assert.equal(pol({corporation:{...CORP,ceoID:SESSION.characterID},member:null}).ok,true);
 deny(pol({member:null}),'FW_CORP_DIRECTOR_REQUIRED');
 deny(pol({member:{characterID:SESSION.characterID,corporationID:SESSION.corporationID,roles:'2048'}}),'FW_CORP_DIRECTOR_REQUIRED');
 deny(pol({member:{characterID:SESSION.characterID,corporationID:111,roles:'1'}}),'FW_CORP_DIRECTOR_REQUIRED');
 assert.equal(pol({member:{characterID:SESSION.characterID,corporationID:SESSION.corporationID,roles:'9007199254740993'}}).ok,true);
});
test('NPC corp, invalid list, spoofed session and duplicate faction cannot alter corp policy',()=>{
 deny(pol({corporation:{...CORP,isNPC:true}}),'FW_CORP_OWNER_NOT_AUTHORIZED');
 deny(pol({session:{...SESSION,corporationID:111}}),'FW_CORP_OWNER_NOT_AUTHORIZED');
 for(const factions of [[500001,500001],[500012],['500001'],[500001,500002,500003,500004,500010,500011,500001],null])
  deny(pol({factions}),'FW_CORP_FACTION_LIST_INVALID');
});
test('FileTime/mask strict parsing cannot silently grant roles or bypass cooldown',()=>{
 assert.equal(G.parseFiletime('135000000000000001'),135000000000000001n);
 assert.equal(G.parseFiletime('bogus'),null);
 assert.equal(G.parseFiletime(-1),null);
 assert.equal(G.parseMask('1'),1n);
 assert.equal(G.parseMask('9007199254740993'),9007199254740993n);
 assert.equal(G.parseMask(Number.MAX_SAFE_INTEGER+1),null);
 assert.equal(G.parseMask('bogus'),null);
});
test('bridge rejects before native updates, uses real lazy source getters and throws client-visible message',()=>{
 const deps={characterState:{getCharacterRecord:()=>CHAR},corporationState:{getCorporationRecord:()=>CORP},
  corpRuntime:{getCorporationRuntime:()=>({fw:{allowedEnlistmentFactions:[500002]}}),getCorporationMember:()=>({characterID:SESSION.characterID,corporationID:SESSION.corporationID,roles:'1'})},
  standings:{getCharacterRawStanding:()=>0},time:{currentFileTime:()=>135000000000000000n},
  errors:{throwWrappedUserError:(_type,obj)=>{throw Error('CLIENT:'+obj.notify)}}};
 assert.throws(()=>G.assertDirect(SESSION,SESSION.characterID,500001,deps),/CLIENT:.*FW_CORP_ENLISTMENT_FACTION_DENIED/);
 deps.corpRuntime.getCorporationRuntime=()=>({fw:{allowedEnlistmentFactions:[500001]}});
 assert.equal(G.assertDirect(SESSION,SESSION.characterID,500001,deps),true);
 assert.throws(()=>G.assertRetire(SESSION,SESSION.characterID,deps),/CLIENT:.*FW_NOT_DIRECTLY_ENLISTED/);
 assert.equal(G.assertCorpPolicy(SESSION,[500001],deps),true);
});
const fixture=`const marker=1;
class FwCharacterEnlistmentMgrService {
  Handle_SetMyCorpAllowedEnlistmentFactions(args, session) {
    const factions = args[0];
    updateCorporationRuntime(corporationID, (runtime) => { return runtime; });
    return buildList(factions);
  }
  Handle_GetMyDirectEnlistmentCooldownTimestamp(args, session) { return null; }
  Handle_CreateMyDirectEnlistment(args, session) {
    const factionID=500001;
    const characterID=90000001;
    updateCharacterRecord(characterID, (record) => ({...record}));
    pushWarFactionSessionChange(session, factionID);
  }
  Handle_RemoveMyDirectEnlistment(args, session) {
    const characterID=90000001;
    const corpFactionID=500003;
    updateCharacterRecord(characterID, (record) => ({...record}));
    pushWarFactionSessionChange(session, corpFactionID);
  }
}
module.exports = FwCharacterEnlistmentMgrService;
`;
test('six native one-line guards: pinned transform reversible, idempotent, LF/CRLF exact',()=>{
 for(const src of [fixture,fixture.replaceAll('\n','\r\n')]){
  const next=P.patchFwNative(src,P.FILE);
  assert.notEqual(next,src);
  assert.equal((next.match(/EVEJS_COOP_NATIVE_FW_ENLISTMENT_GUARD/g)||[]).length,6);
  assert.equal(P.patchFwNative(next,P.FILE),next);
  assert.equal(P.patchFwNative(next,P.FILE,{remove:true}),src);
  assert.equal(P.patchFwNative(src,P.FILE,{remove:true}),src);
  new Script(next);
 }
});
test('drift rejects unknown path, duplicated anchors, altered function, partial hook',()=>{
 assert.throws(()=>P.patchFwNative(fixture,'server/src/services/other.js'),/UNSUPPORTED/);
 assert.throws(()=>P.patchFwNative(fixture.replace('  Handle_CreateMyDirectEnlistment','  Handle_XDirectEnlistment'),P.FILE),/CONTEXT/);
 assert.throws(()=>P.patchFwNative(fixture.replace('    updateCorporationRuntime(corporationID','    updateCorporationRuntime(anotherCorpID'),P.FILE),/ANCHOR/);
 assert.throws(()=>P.patchFwNative(fixture+fixture,P.FILE),/CONTEXT/);
 const partial=P.patchFwNative(fixture,P.FILE).replace('assertDirect(session, characterID, factionID);','assertDirect(session, characterID, factionID)');
 assert.throws(()=>P.patchFwNative(partial,P.FILE),/ANCHOR/);
});

test('native post-write receipts prevent stale session changes after failed character/corp writes',()=>{
 assert.equal(G.verifyPersistedDirect({...CHAR,directFactionID:500001,warFactionID:500001},500001).ok,true);
 deny(G.verifyPersistedDirect(CHAR,500001),'FW_CHARACTER_ENLISTMENT_WRITE_UNCONFIRMED');
 assert.equal(G.verifyPersistedRetire({...CHAR,warFactionID:500003,directEnlistmentCooldownTimestamp:'135000000000000001'},500003,135000000000000000n).ok,true);
 deny(G.verifyPersistedRetire({...CHAR,warFactionID:500003,directEnlistmentCooldownTimestamp:'135000000000000000'},500003,135000000000000000n),'FW_RETIREMENT_COOLDOWN_WRITE_UNCONFIRMED');
 deny(G.verifyPersistedRetire({...CHAR,directFactionID:500001},500003,135000000000000000n),'FW_CHARACTER_RETIREMENT_WRITE_UNCONFIRMED');
 assert.equal(G.verifyPersistedCorpPolicy({fw:{allowedEnlistmentFactions:[500001,500002]}},[500001,500002]).ok,true);
 deny(G.verifyPersistedCorpPolicy({fw:{allowedEnlistmentFactions:[500002,500001]}},[500001,500002]),'FW_CORPORATE_POLICY_WRITE_UNCONFIRMED');
});
