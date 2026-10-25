import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-native-npc-fire-debit-patch.cjs");

// Small syntax-valid fixture preserving each exact pinned source anchor.
// Full-size pinned runtime is verified separately using the same transformer.
const source=[
 'function consumeTurretAmmoCharge(attackerEntity,moduleItem,chargeItem,whenMs,quantity){',
 ' const consumeQuantity=1;',
 ' const previousQuantity=5;',
 '  const nextQuantity = Math.max(0, previousQuantity - consumeQuantity);',
 '    if (Array.isArray(attackerEntity.nativeCargoItems)) {',
 '      attackerEntity.nativeCargoItems = [];',
 '    }',
 ' return nextQuantity;',
 '}',
 'function executeTurretCycle(scene, attackerEntity, effectState, cycleBoundaryMs){',
 ' const resolvedWeaponSnapshot={chargeMode:"stack"};',
 ' const chargeOptionalTurretWeapon=false;',
 ' const activeTurretEntries=[];',
 '  const shotResult = resolveTurretShot({});',
 ' for(const entry of activeTurretEntries){',
 '  const currentModuleItem=entry.moduleItem;',
 '  const currentChargeItem=entry.chargeItem;',
 '    const chargeResult = resolvedWeaponSnapshot.chargeMode === "crystal"',
 '      ? applyCrystalVolatilityDamage(',
 '        scene,',
 '        attackerEntity,',
 '        currentModuleItem,',
 '        currentChargeItem,',
 '        cycleBoundaryMs,',
 '      )',
 '      : consumeTurretAmmoCharge(',
 '        attackerEntity,',
 '        currentModuleItem,',
 '        currentChargeItem,',
 '        cycleBoundaryMs,',
 '      );',
 ' }',
 ' return shotResult;',
 '}',
 'function executeMissileCycle(scene,attackerEntity,effectState,cycleBoundaryMs){',
 ' const armedEntries=[];',
 '  const chargeResults = [];',
 ' const groupedAmmoFailure=false;',
 '  if (groupedAmmoFailure && chargeResults.every((entry) => !entry.result || !entry.result.success)) {',
 '  return {success:false};',
 ' }',
 ' return {success:true};',
 '}',
 'function trailingFunction(){return true;}',
].join("\n");
test("pinned source transformer inserts checks without changing baseline function names",()=>{
 const actual=patch(source);
 assert.ok(actual.includes("function consumeTurretAmmoCharge("));
 assert.ok(actual.includes("function executeTurretCycle("));
 assert.ok(actual.includes("function executeMissileCycle("));
 assert.ok(actual.includes('coopNpcFireDebitProof'));
 assert.ok(actual.includes("strictNativeDebitResults"));
 assert.ok(actual.includes("AMMO_WRITE_UNVERIFIED"));
 assert.ok(actual.includes("_coopStrictAmmoLastBoundaryMs"));
 new Function(actual);
});
test("patching twice is idempotent and stripping restores every original byte",()=>{
 const once=patch(source);
 assert.equal(patch(once),once);
 assert.equal(patch(once,{remove:true}),source);
 assert.equal(patch(patch(once,{remove:true})),once);
});
test("only native strict ammo gates execute early debit and missile bank proof",()=>{
 const transformed=patch(source);
 assert.ok(transformed.includes('process.env.EVEJS_COOP_NPC_STRICT_AMMO === "1"'));
 assert.ok(transformed.includes("strictNativeStackDebit"));
 assert.ok(transformed.includes("if (strictNativeStackDebit)"));
 assert.ok(transformed.includes("strictNativeDebitResults.get("));
 assert.ok(transformed.includes("const proof = require(\"./coopNpcFireDebitProof\").verifyBank("));
});
test("source transform refuses unexpected pinned API drift instead of silent patch",()=>{
 assert.throws(()=>patch(source.replace("const shotResult = resolveTurretShot","const shot = resolveTurretShot")),
  /Native ammo patch source drift/);
 assert.throws(()=>patch(source.replace("const nextQuantity = Math.max","const finalQuantity = Math.max")),
  /Native ammo patch source drift/);
});
test("replay guard is present at both authoritative turret and missile boundaries",()=>{
 const transformed=patch(source);
 const method=name=>{
  const a=transformed.indexOf("function "+name+"(");
  const b=transformed.indexOf("\nfunction ",a+10);
  return transformed.slice(a,b);
 };
 for(const name of ["executeTurretCycle","executeMissileCycle"]){
  const part=method(name);
  assert.ok(part.includes("_coopStrictAmmoLastBoundaryMs === cycleBoundaryMs"));
  assert.ok(part.includes('errorMsg: "NATIVE_FIRE_CYCLE_REPLAY"'));
 }
});

test("native store commit must be verified before changing live cargo cache",()=>{
 const patched=patch(source);
 const block=patched.slice(patched.indexOf("function consumeTurretAmmoCharge("),
  patched.indexOf("\nfunction executeTurretCycle("));
 const preflight=block.indexOf('coopNpcFireDebitProof');
 const writeProof=block.indexOf('AMMO_WRITE_UNVERIFIED');
 const cacheWrite=block.indexOf('if (Array.isArray(attackerEntity.nativeCargoItems))');
 assert.ok(preflight>=0);
 assert.ok(writeProof>preflight);
 assert.ok(cacheWrite>writeProof);
});

test("durable ammo cycle creates PREPARED before native debit and commits before live cargo cache",()=>{
 const transformed=patch(source);
 const segment=transformed.slice(
  transformed.indexOf("function consumeTurretAmmoCharge("),
  transformed.indexOf("\nfunction executeTurretCycle("));
 const pre=segment.indexOf('coopNpcAmmoDebitJournal").begin(');
 const debit=segment.indexOf("const nextQuantity = Math.max");
 const settle=segment.indexOf('coopNpcAmmoDebitJournal").commit(');
 const cache=segment.indexOf("if (Array.isArray(attackerEntity.nativeCargoItems))");
 assert.ok(pre>=0 && debit>pre);
 assert.ok(settle>debit && cache>settle);
 assert.ok(segment.includes('process.env.EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE === "1"'));
});

test("whole-bank journal preflight precedes any turret debit and missile launch",()=>{
 const transformed=patch(source);
 const turret=transformed.slice(transformed.indexOf("function executeTurretCycle("),
  transformed.indexOf("\nfunction executeMissileCycle("));
 const missile=transformed.slice(transformed.indexOf("function executeMissileCycle("),
  transformed.indexOf("\nfunction trailingFunction("));
 const turretBank=turret.indexOf('coopNpcAmmoDebitJournal").preflightBank(');
 const firstTurretDebit=turret.indexOf("if (strictNativeStackDebit) {");
 const missileBank=missile.indexOf('coopNpcAmmoDebitJournal").preflightBank(');
 const firstMissileDebit=missile.indexOf("const chargeResults = []");
 assert.ok(turretBank>=0&&firstTurretDebit>turretBank);
 assert.ok(missileBank>=0&&firstMissileDebit>missileBank);
 assert.equal((turret.match(/\.preflightBank\(/g)||[]).length,1);
 assert.equal((missile.match(/\.preflightBank\(/g)||[]).length,1);
 assert.ok(turret.includes('EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE === "1"'));
 assert.ok(missile.includes('EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE === "1"'));
});

test("atomic native weapon bank executes before turret damage and missile launch",()=>{
 const transformed=patch(source);
 const turret=transformed.slice(transformed.indexOf("function executeTurretCycle("),
  transformed.indexOf("\nfunction executeMissileCycle("));
 const missile=transformed.slice(transformed.indexOf("function executeMissileCycle("),
  transformed.indexOf("\nfunction trailingFunction("));
 const tAtomic=turret.indexOf('coopNpcAmmoBankAtomic").consumeBank({');
 const tDamage=turret.indexOf("const shotResult = resolveTurretShot(");
 const mAtomic=missile.indexOf('coopNpcAmmoBankAtomic").consumeBank({');
 const mCharge=missile.indexOf("const chargeResults = [];");
 assert.ok(tAtomic>=0 && tDamage>tAtomic);
 assert.ok(mAtomic>=0 && mCharge>mAtomic);
 assert.ok(turret.includes('process.env.EVEJS_COOP_NPC_BANK_ATOMIC === "1"'));
 assert.ok(missile.includes('process.env.EVEJS_COOP_NPC_BANK_ATOMIC === "1"'));
 assert.ok(turret.includes("for (const row of bank.results)"));
 assert.ok(missile.includes("coopAtomicMissileResults.get("));
 assert.equal(patch(patch(source),{remove:true}),source);
});
