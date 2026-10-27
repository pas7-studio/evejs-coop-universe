import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Measured on the work stack 2026-10-27 with the read-only admin bridge
// (mining_fleet_diagnose): both fleets were in state `hauling`, every miner reported
// mode GOTO with targetPoint ~1.0e16 m from the system origin, and the miner -> rock
// distance GREW (45 765 m -> 49 487 m in 29 s) while the hauler's follow order closed to
// 4 km and then reopened. `1.0e16` is what the native speed command writes
// (movementStopSpeedCommands: targetPoint = position + direction * 1.0e16) for a
// full-throttle straight line, and the state machine returns BEFORE the per-miner loop
// while a fleet is hauling - so nothing ever re-aimed the miners.
const root = path.dirname(fileURLToPath(import.meta.url));
const fork = path.join('C:', 'Games', 'EveCoop', 'upstream-evejs', 'Code', 'server', 'src',
  'services', 'mining', 'miningNpcOperations.js');

test('a fleet that is not mining parks its miners instead of abandoning them', {skip: !fs.existsSync(fork)}, () => {
  const source = fs.readFileSync(fork, 'utf8');
  for (const state of ['hauling', 'loaded'])
    assert.ok(source.includes(`parkFleetMiners(scene, fleetRecord, "${state}");`),
      `the ${state} state must park its miners before it returns`);
});

test('a runaway full-throttle order is stopped and named', {skip: !fs.existsSync(fork)}, () => {
  const source = fs.readFileSync(fork, 'utf8');
  assert.ok(source.includes('function stopRunawayFullThrottle('));
  assert.ok(source.includes('gap > 1e9'), 'the straight-line target is recognised by distance');
  assert.ok(source.includes('toFiniteNumber(entity.speedFraction, 0) > 0'),
    'a positive speed fraction is the other half of the same native order');
  assert.ok(source.includes('RUNAWAY_ORDER_STOPPED'), 'the stop must be observable');
  assert.ok(source.includes('living-mining-miners-parked'), 'parking must be observable');
});

test('the approach starts from a clean state, so a warp is not flown at a ghost point', {skip: !fs.existsSync(fork)}, () => {
  const source = fs.readFileSync(fork, 'utf8');
  const approach = source.indexOf('function syncMiningApproachOrder(');
  const stop = source.indexOf('stopRunawayFullThrottle(scene, entity, "mining-approach");');
  const orbit = source.indexOf('return scene.orbitShipEntity(', approach);
  assert.ok(approach > 0 && stop > approach, 'the stop belongs inside the approach');
  assert.ok(orbit > stop, 'the stop must happen before a new movement order is issued');
});
