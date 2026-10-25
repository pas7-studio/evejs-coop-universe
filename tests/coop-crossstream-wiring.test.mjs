import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const require=createRequire(import.meta.url);
const installer=require("../scripts/patch-evejs-coop.cjs");
const hook=require("../scripts/coop-player-damage-native-patch.cjs");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("combat witness is copied into the same authoritative space module directory",()=>{
  const code=read("scripts/patch-evejs-coop.cjs");
  assert.match(code,/"coopPlayerCombatWitness"\]/);
  assert.match(code,/space\/combat\/killmailTracker\.js/);
  const spec=installer.specs.find(s=>s.file==="server/src/space/combat/killmailTracker.js");
  assert.ok(spec);
  assert.ok(fs.existsSync(path.join(root,"integration/coopPlayerCombatWitness.cjs")));
  assert.match(code,/coop-player-damage-native-patch\.cjs/);
});
test("pinned native hook is exactly reversible through transactional installer transform",()=>{
  const text=[
    "function noteDamage(attackerEntity, targetEntity, appliedDamage, options = {}) {",
    "  const ledger = { attackers: {}, damageTaken: 0 };",
    "  const attackerKey = String(1), currentEntry = {}, damageAmount = 12, whenMs = 123;",
    "  function toFiniteNumber(a,b) { return Number.isFinite(a) ? a : b; }",
    "  ledger.attackers[attackerKey] = currentEntry;",
    "  ledger.damageTaken = toFiniteNumber(ledger.damageTaken, 0) + damageAmount;",
    "  ledger.lastUpdatedAtMs = whenMs;",
    "}"
  ].join("\n");
  const spec=installer.specs.find(s=>s.file==="server/src/space/combat/killmailTracker.js");
  assert.equal(hook.patch(text),installer.transform(text,spec,false));
  const patched=installer.transform(text,spec,false);
  assert.equal(installer.transform(patched,spec,false),patched);
  assert.equal(installer.transform(patched,spec,true),text);
  assert.throws(()=>installer.transform("wrong source",spec,false),/UNKNOWN_PINNED/);
});
test("cross-stream QA is connected to local manual verifier, never remote CI",()=>{
  const verifier=read("scripts/Verify-Local-Coop.ps1");
  for(const name of ["coop-native-snapshot","coop-reliability-gates","coop-actionable-intel",
    "coop-raid-beacon","coop-pve-chain","coop-player-combat-witness","coop-duo-contribution-report",
    "coop-crossstream-wiring","coop-runtime-probe-ack"])
    assert.ok(verifier.includes("tests/"+name+".test.mjs"),name);
  const config=read("scripts/Deploy-Coop-RuntimeProbe.ps1");
  assert.match(config,/EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE: '1'/);
  assert.match(read("integration/coopWorldSignals.cjs"),/notifyRaid/);
  assert.match(read("integration/coopPlayerCombatWitness.cjs"),/written!==true/);
});
