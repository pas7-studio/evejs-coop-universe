import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require = createRequire(import.meta.url);
const living = require('../integration/coopLivingAgentRuntime.cjs');

function tempFile(name) {
  return join(mkdtempSync(join(tmpdir(), 'living-agent-')), name);
}

test('a leg survives a restart with its step, target and ship', () => {
  const file = tempFile('legs.json');
  const store = living.createLegStore({file, log: () => {}});
  store.put({
    legID: '980000000',
    agentID: 140000100,
    shipItemID: 9988400100000,
    fromStationID: 60015260,
    toStationID: 60015262,
    systemID: 30000142,
    step: 'warp',
    stepStartedAtMs: 1,
  });
  store.save();

  const reopened = living.createLegStore({file, log: () => {}});
  const legs = reopened.load();
  const leg = legs.get('980000000');
  assert.equal(leg.step, 'warp');
  assert.equal(leg.toStationID, 60015262);
  assert.equal(leg.shipItemID, 9988400100000);
});

test('an unreadable leg is dropped, never guessed', () => {
  const file = tempFile('legs.json');
  const store = living.createLegStore({file, log: () => {}});
  store.put({legID: 'bad-step', agentID: 1, toStationID: 2, step: 'teleport'});
  store.put({legID: 'no-target', agentID: 1, toStationID: 0, step: 'warp'});
  store.put({legID: 'good', agentID: 1, toStationID: 2, step: 'warp'});
  store.save();
  const legs = living.createLegStore({file, log: () => {}}).load();
  assert.deepEqual([...legs.keys()], ['good']);
});

test('history records departure, incidents and a real duration', () => {
  const file = tempFile('history.json');
  let clock = 1000000;
  const history = living.createHistoryStore({file, now: () => clock});
  history.noteDeparture('980000000');
  history.noteIncident('980000000', 'rewarp', 'no session');
  history.noteIncident('980000000', 'dock-failed', 'ALREADY_DOCKED');
  clock += 23 * 60000;
  assert.equal(history.durationMs('980000000'), 23 * 60000);
  assert.equal(history.incidents('980000000').length, 2);

  // The history outlives the process, so the owner's report stays true.
  const reopened = living.createHistoryStore({file, now: () => clock});
  assert.equal(reopened.incidents('980000000').length, 2);
  assert.equal(reopened.durationMs('980000000'), 23 * 60000);
  reopened.forget('980000000');
  assert.equal(reopened.incidents('980000000').length, 0);
});

test('the leg machine runs one native action per call and advances only on OK', () => {
  const calls = [];
  const ctx = {
    character: {characterID: 140000100, accountId: 9},
    transitions: {
      undockSession: (session) => {
        calls.push(['undock', session.characterID]);
        return {success: true, data: {ship: {itemID: 9988400100000}}};
      },
      dockSession: (session, stationID) => {
        calls.push(['dock', session.characterID, stationID]);
        return {success: true};
      },
    },
    space: {
      warpToPoint: (session, point) => {
        calls.push(['warp', session.characterID, point.x]);
        return {success: true};
      },
    },
  };
  const machine = living.createLegMachine({now: () => 5000, log: () => {}});
  let leg = {legID: '1', agentID: 140000100, fromStationID: 60015260, toStationID: 60015262, step: 'undock'};

  const undocked = machine.stepLeg(leg, ctx, {});
  assert.equal(undocked.observed.status, 'OK');
  assert.equal(undocked.leg.step, 'warp');
  assert.equal(undocked.leg.entityID, 9988400100000);

  const warped = machine.stepLeg(undocked.leg, ctx, {targetPoint: {x: 7, y: 0, z: 0}});
  assert.equal(warped.leg.step, 'arrive');

  // Arrival is never assumed: without scene confirmation the leg stays put.
  const pending = machine.stepLeg(warped.leg, ctx, {arrivalConfirmed: false, targetPoint: {x: 7, y: 0, z: 0}});
  assert.equal(pending.leg.step, 'arrive');
  assert.equal(pending.observed.status, 'REWARP');

  const confirmed = machine.stepLeg(warped.leg, ctx, {arrivalConfirmed: true});
  assert.equal(confirmed.leg.step, 'dock');

  const docked = machine.stepLeg(confirmed.leg, ctx, {});
  assert.equal(docked.leg.step, 'done');
  assert.deepEqual(calls.map((row) => row[0]), ['undock', 'warp', 'warp', 'dock']);
});

test('the hull, not the character row, decides whether an agent is docked', () => {
  assert.equal(living.hullDockedAt({locationID: 60015260, flagID: 4}, 60015260), true);
  assert.equal(living.hullDockedAt({locationID: 60015260, flagID: 0}, 60015260), false);
  assert.equal(living.hullDockedAt({locationID: 30000142, flagID: 4}, 60015260), false);
});
