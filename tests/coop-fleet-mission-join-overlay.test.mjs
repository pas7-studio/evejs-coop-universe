import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
const require=createRequire(import.meta.url);
const {patch,FILE,HOOK,ANCHOR}=require("../scripts/coop-fleet-mission-join-patch.cjs");
const installer=require("../scripts/patch-evejs-coop.cjs");
test("new L2 module is present, native L1 spec registered, and no stock agent flow replaced",()=>{
 const src=readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 assert.ok(src.includes('"coopFleetMissionJoin"'));
 assert.ok(installer.specs.some(s=>s.file===FILE));
 assert.match(src,/coop-fleet-mission-native-patch\.cjs/);
 assert.match(src,/coop-fleet-mission-join-patch\.cjs/);
 assert.match(HOOK,/EVEJS_COOP_MISSION_JOIN === "1"/);
 assert.match(HOOK,/getMissionRecord,getClientMissionRecord,offerSpecificMission/);
 assert.doesNotMatch(HOOK,/\b(?:applyMissionRewards|grantItemsToCharacterStationHangar|adjustCharacterBalance)\b/);
});
test("Windows operator must explicitly choose EnableMissionJoin; native default is unchanged",()=>{
 const ps=readFileSync(new URL("../scripts/Deploy-Coop-RuntimeProbe.ps1",import.meta.url),"utf8");
 assert.match(ps,/\[switch\]\$EnableMissionJoin/);
 assert.match(ps,/if \(\$EnableMissionJoin -and -not \$LivingCoop\)/);
 assert.match(ps,/if \(\$EnableMissionJoin\)/);
 assert.match(ps,/EVEJS_COOP_MISSION_JOIN: '1'/);
 assert.match(ps,/EVEJS_COOP_ATOMIC_TRADE: '1'/);
 assert.match(ps,/EVEJS_COOP_MARKET_CATALOG: '1'/);
 assert.match(ps,/EVEJS_COOP_NPC_CHATTER: '1'/);
});
test("one-statement native hook is opt-in, idempotent, and byte-exact reversible",()=>{
 const source=['"use strict";','function doAgentAction() {',
 '  if (referredMission) return null;',
 '  if (syncedMission) return null;',
 ANCHOR,'    return offerResult;','}'].join("\n")+"\n";
 const patched=patch(source,FILE);
 assert.ok(patched.indexOf(HOOK)<patched.indexOf(ANCHOR));
 assert.equal(patched.split(HOOK).length,2);
 assert.equal(patch(patched,FILE),patched);
 assert.equal(patch(patched,FILE,true),source);
 assert.equal(patch(source,"unrelated-file.js"),source);
 const crlf=source.replace(/\n/g,"\r\n");
 assert.equal(patch(patch(crlf,FILE),FILE,true),crlf);
});
test("fail closed on unpinned Request Mission native source",()=>{
 assert.throws(()=>patch('const offerResult = somethingElse();',FILE),/UNKNOWN_PINNED/);
 assert.throws(()=>patch([ANCHOR,ANCHOR].join("\n"),FILE),/UNKNOWN_PINNED/);
});
const codePath=process.env.EVEJS_COOP_CODE_PATH||"";
test("full pinned native mission runtime patch including existing shared objective roundtrips byte-exact",
 {skip:!codePath||!existsSync(path.join(codePath,FILE))},()=>{
  const source=readFileSync(path.join(codePath,FILE),"utf8");
  const spec=installer.specs.find(s=>s.file===FILE);
  assert.ok(spec);
  const patched=installer.transform(source,spec,false);
  assert.notEqual(patched,source);
  assert.equal(patched.split(HOOK).length,2);
  assert.equal(installer.transform(patched,spec,false),patched);
  assert.equal(installer.transform(patched,spec,true),source);
 });
