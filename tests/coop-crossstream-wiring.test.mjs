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
  // The module list lives in scripts/overlay-spec.cjs and the installer re-exports it.
  assert.ok(installer.names.includes("coopPlayerCombatWitness"));
  assert.ok(installer.specs.some(s=>s.file==="server/src/space/combat/killmailTracker.js"));
  const spec=installer.specs.find(s=>s.file==="server/src/space/combat/killmailTracker.js");
  assert.ok(spec);
  assert.ok(fs.existsSync(path.join(root,"integration/coopPlayerCombatWitness.cjs")));
  assert.match(code,/coop-player-damage-native-patch\.cjs/);
});
test("pinned native hook is exactly reversible through transactional installer transform",()=>{
  // killmailTracker.js carries two hook sites now: the damage witness inside
  // noteDamage, and the FW structure-killmail call before the ledger is deleted.
  const text=[
    "function noteDamage(attackerEntity, targetEntity, appliedDamage, options = {}) {",
    "  const ledger = { attackers: {}, damageTaken: 0 };",
    "  const attackerKey = String(1), currentEntry = {}, damageAmount = 12, whenMs = 123;",
    "  function toFiniteNumber(a,b) { return Number.isFinite(a) ? a : b; }",
    "  ledger.attackers[attackerKey] = currentEntry;",
    "  ledger.damageTaken = toFiniteNumber(ledger.damageTaken, 0) + damageAmount;",
    "  ledger.lastUpdatedAtMs = whenMs;",
    "}",
    "function recordKillmailFromDestruction(targetEntity, destroyResult, options = {}) {",
    "  const ledgerKey = String(targetEntity && targetEntity.id);",
    "  const record = ledgersByVictim.get(ledgerKey);",
    "  ledgersByVictim.delete(ledgerKey);",
    "  return record;",
    "}"
  ].join("\n");
  const spec=installer.specs.find(s=>s.file==="server/src/space/combat/killmailTracker.js");
  // The installer composes two hooks onto this file: the damage witness, then the FW
  // structure-killmail call. State that composition exactly instead of pretending one
  // patch function equals the whole transform.
  const structure=require("../scripts/coop-war-structure-killmail-patch.cjs");
  assert.equal(installer.transform(text,spec,false),structure.patch(hook.patch(text)));
  const patched=installer.transform(text,spec,false);
  assert.equal(installer.transform(patched,spec,false),patched);
  assert.equal(installer.transform(patched,spec,true),text);
  assert.throws(()=>installer.transform("wrong source",spec,false),/UNKNOWN_PINNED/);
});
test("cross-stream QA is connected to local manual verifier, never remote CI",()=>{
  const verifier=read("scripts/Verify-Local-Coop.ps1");
  // The verifier discovers tests/*.test.mjs instead of keeping a hand-written
  // list, so a new test can never be silently skipped. Assert the discovery
  // mechanism and that each required test really exists on disk.
  assert.match(verifier,/Get-ChildItem[^\r\n]*-Filter '\*\.test\.mjs'/);
  assert.match(verifier,/-notlike 'upstream-\*'/);
  assert.doesNotMatch(verifier,/GitHub Actions|Actions workflow|workflow-runs/);
  for(const name of ["coop-native-snapshot","coop-reliability-gates","coop-actionable-intel",
    "coop-raid-beacon","coop-pve-chain","coop-player-combat-witness","coop-duo-contribution-report",
    "coop-crossstream-wiring","coop-runtime-probe-ack"])
    assert.ok(fs.existsSync(path.join(root,"tests",name+".test.mjs")),name);
  const config=read("scripts/Deploy-Coop-RuntimeProbe.ps1");
  assert.match(config,/EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE: '1'/);
  assert.match(read("integration/coopWorldSignals.cjs"),/notifyRaid/);
  assert.match(read("integration/coopPlayerCombatWitness.cjs"),/written!==true/);
});
