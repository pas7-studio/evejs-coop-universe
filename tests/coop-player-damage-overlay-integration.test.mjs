import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const installer=require("../scripts/patch-evejs-coop.cjs");
const helper=require("../scripts/coop-player-damage-native-patch.cjs");
const target="server/src/space/combat/killmailTracker.js";
const spec=installer.specs.find(x=>x.file===target);
const source=[
 "function noteDamage(attackerEntity, targetEntity, appliedDamage, options = {}) {",
 " const damageAmount = Number(appliedDamage);",
 " const attackerKey = \"test\";",
 " const currentEntry = {damageDone:damageAmount};",
 " const ledger = {attackers:{},damageTaken:0};",
 " const whenMs = 12345;",
 " function toFiniteNumber(x, fallback) {return Number.isFinite(x)?x:fallback;}",
 "  ledger.attackers[attackerKey] = currentEntry;",
 "  ledger.damageTaken = toFiniteNumber(ledger.damageTaken, 0) + damageAmount;",
 "  ledger.lastUpdatedAtMs = whenMs;",
 " return ledger;",
 "}"
].join("\n");
test("installer contains exactly one native damage spec and overlay copy name",()=>{
 assert.ok(spec);
 assert.equal(installer.specs.filter(x=>x.file===target).length,1);
 const installerText=fs.readFileSync(path.join(root,"scripts/patch-evejs-coop.cjs"),"utf8");
 assert.match(installerText,/coopPlayerCombatWitness/);
 assert.match(installerText,/coop-player-damage-native-patch\.cjs/);
 assert.ok(fs.existsSync(path.join(root,"integration/coopPlayerCombatWitness.cjs")));
});
test("full transactional transform installs, is repeatable, then removes native hook",()=>{
 const installed=installer.transform(source,spec,false);
 assert.notEqual(installed,source);
 assert.equal(installer.transform(installed,spec,false),installed);
 assert.equal(installer.transform(installed,spec,true),source);
 assert.equal(installer.transform(source,spec,true),source);
});
test("hook fires only when opted into LivingCoop, after native damage ledger update",()=>{
 const installed=installer.transform(source,spec,false);
 function invoke(enabled){
  const calls=[];
  const result=vm.runInNewContext(installed+";noteDamage({}, {}, 4);",{
   process:{env:{EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE:enabled?"1":"0"}},
   require:()=>({note:(_a,_t,damage)=>calls.push(damage)}),
   console
  });
  return {calls,result};
 }
 const enabled=invoke(true);
 assert.deepEqual(enabled.calls,[4]);
 assert.equal(enabled.result.damageTaken,4);
 assert.equal(enabled.result.lastUpdatedAtMs,12345);
 assert.equal(invoke(false).calls.length,0);
});
test("witness failure is contained; native damage ledger remains correct",()=>{
 const installed=installer.transform(source,spec,false);
 const state=vm.runInNewContext(installed+";noteDamage({}, {}, 5);",{
  process:{env:{EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE:"1"}},
  require:()=>{throw Error("telemetry unavailable");},
  console:{warn(){}}
 });
 assert.equal(state.damageTaken,5);
 assert.equal(Object.keys(state.attackers).length,1);
});
test("rejects altered pinned native ledger anchor before any mutation",()=>{
 assert.throws(()=>installer.transform(source.replace("ledger.damageTaken =","ledger.missing ="),spec,false),/UNKNOWN_PINNED_DAMAGE_HOOK_ANCHOR/);
 assert.throws(()=>helper.patch("function noteDamage() {}"),/UNKNOWN_PINNED_KILLMAIL_TRACKER_SOURCE/);
});
test("deploy only opts in when LivingCoop was selected; verifier runs the new tests",()=>{
 const deploy=fs.readFileSync(path.join(root,"scripts/Deploy-Coop-RuntimeProbe.ps1"),"utf8");
 const at=deploy.indexOf('if ($LivingCoop) {');
 const flag=deploy.indexOf('EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE:');
 assert.ok(at>=0&&flag>at);
 assert.equal(deploy.split("EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE:").length-1,1);
 const verifier=fs.readFileSync(path.join(root,"scripts/Verify-Local-Coop.ps1"),"utf8");
 for(const filename of ["coop-player-combat-witness.test.mjs","coop-duo-contribution-report.test.mjs","coop-player-damage-overlay-integration.test.mjs"])
  assert.ok(verifier.includes(filename),filename);
});
test("optional full local upstream source must obey source patch/unpatch parity",t=>{
 const code=process.env.EVEJS_COOP_CODE_PATH;
 const file=code&&path.join(code,target);
 if(!file||!fs.existsSync(file))return t.skip("pinned upstream checkout not accessible in this test runtime");
 const before=fs.readFileSync(file,"utf8");
 const added=installer.transform(before,spec,false);
 assert.equal(installer.transform(added,spec,true),helper.patch(before,{remove:true}));
});
