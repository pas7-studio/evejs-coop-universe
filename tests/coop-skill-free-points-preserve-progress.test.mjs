import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Live 2026-11-04: character 140000005 had 20 minutes left on Caldari Cruiser V
// (skill type 3336, rank 8, 2700 SP/min at the current rate). Injecting a skill
// injector made the client show 8.9 hours. applyFreeSkillPointsInternal read the
// PERSISTED skill record (which only advances when a level finishes, so it still sat
// at the level-4 threshold, 362 032 SP), added the injected points and reset
// activeStartTime, so the ~1.43M SP already earned inside level 5 were dropped.
// The fix persists the live projection first (rebaseActiveTrainingProgress), then
// applies the free points on top of it.
//
// The numbers below are recomputed here with the same CCP formulas the server uses
// (skillTrainingMath.getSkillPointsForLevel / FILETIME_TICKS_PER_MINUTE), so this
// file stays a pure import-free test.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const runtimeSource = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/services/skills/training/skillQueueRuntime.js"), "utf8");
const actionsSource = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/space/coopAdminBridgeActions.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/space/coopAdminBridge.js"), "utf8");

const TICKS_PER_MINUTE = 600_000_000;
const SP_PER_MINUTE = 2700;
const skillPointsForLevel = (rank, level) =>
  level <= 0 ? 0 : Math.ceil(rank * 250 * 2 ** (2.5 * (level - 1)));
const durationMinutes = (remainingSP, rate) => Math.floor((remainingSP / rate) * TICKS_PER_MINUTE) / TICKS_PER_MINUTE;

const LEVEL_5 = skillPointsForLevel(8, 5);
const LEVEL_4 = skillPointsForLevel(8, 4);

test("free skill points are applied on top of the live projection, not the level threshold", () => {
  const body = runtimeSource.slice(
    runtimeSource.indexOf("function applyFreeSkillPointsInternal"),
    runtimeSource.indexOf("function applyFreeSkillPoints("),
  );
  const rebase = body.indexOf("rebaseActiveTrainingProgress(numericCharacterID");
  const baseMap = body.indexOf("getCharacterBaseSkillMap(numericCharacterID)");
  assert.ok(rebase > 0, "applyFreeSkillPointsInternal must rebase first");
  assert.ok(baseMap > 0);
  assert.ok(rebase < baseMap, "the rebase has to persist the earned SP before the map is read");
});

test("the live numbers: preserved points leave 20 minutes, a restart leaves 8.9 hours", () => {
  const earnedBeforeInjector = LEVEL_5 - 20 * SP_PER_MINUTE;
  assert.equal(earnedBeforeInjector, 1_994_000);
  assert.equal(LEVEL_4, 362_039);
  assert.equal(Math.round(durationMinutes(LEVEL_5 - earnedBeforeInjector, SP_PER_MINUTE)), 20);
  // After the bug the server persisted the level-4 threshold plus the 199 000 injected
  // points (561 039) and restarted the clock: 550 minutes = 9.2 hours, the "9 годин"
  // the client showed.
  const restartedFrom = LEVEL_4 + 199_000;
  assert.equal(restartedFrom, 561_039);
  assert.equal(Math.round(durationMinutes(LEVEL_5 - restartedFrom, SP_PER_MINUTE) / 60), 9);
});

test("the operator restore tool exists and cannot grant a level", () => {
  assert.match(actionsSource, /"skill_restore_points"/);
  assert.match(actionsSource, /function restoreSkillPoints/);
  assert.match(actionsSource, /LEVEL_BOUNDARY_REFUSED/);
  assert.match(bridgeSource, /action === "skill_restore_points"/);
});
