import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const audit = require('../scripts/coop-factory-audit.cjs');

// The loop needs a buyer. The seeded market has no ore orders in these systems, so the
// honest alternative is a real industrial consumer - and this audit says precisely
// whether one can exist yet, without writing a single row.
function store(t, {facilities = [], blueprints = null, jobs = null, wallets = []} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-factory-audit-'));
  const db = new DatabaseSync(path.join(dir, 'gamestore.sqlite'));
  db.exec('CREATE TABLE "industryFacilityState" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  db.exec('CREATE TABLE "industryBlueprintState" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  db.exec('CREATE TABLE "industryJobs" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  db.exec('CREATE TABLE "corporationRuntime" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  const put = (table, key, value) =>
    db.prepare('INSERT INTO "' + table + '" (key,json) VALUES(?,?)').run(key, JSON.stringify(value));
  for (const facility of facilities) put('industryFacilityState', 'facility\u001f' + facility.stationID, facility);
  if (blueprints) put('industryBlueprintState', 'records', {records: blueprints});
  if (jobs) put('industryJobs', 'jobs', jobs);
  for (const wallet of wallets) put('corporationRuntime', 'corporations\u001f' + wallet.corporationID, wallet);
  t.after(() => { db.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  return db;
}

test('an empty world is reported as not ready, with every missing piece named', (t) => {
  const db = store(t, {wallets: [{corporationID: 1000129, divisions: {1000: {balance: 0}}}]});
  const report = audit.audit({db, candidateStations: [60000358]});
  assert.equal(report.status, 'FACTORY_NOT_READY');
  assert.deepEqual(report.stations[0].problems, ['FACILITY_UNKNOWN', 'NO_BLUEPRINT'],
   'without the native lookup a facility is UNKNOWN, never assumed missing');
  assert.equal(report.blueprints, 0);
  assert.equal(report.jobs, 0);
  assert.equal(report.fundedCorporations, 0);
  assert.match(audit.format(report), /a registered blueprint and a funded NPC corporation/);
});

test('a world with an online manufacturing facility, a blueprint and a funded corp is ready', (t) => {
  const db = store(t, {
    facilities: [{stationID: 60000358, online: true, activities: {1: [[], []]}}],
    blueprints: {bp1: {runs: 10}},
    wallets: [{corporationID: 1000129, divisions: {1000: {balance: 250000000}}}],
  });
  const report = audit.audit({db, candidateStations: [60000358], minimumISK: 1000});
  assert.equal(report.status, 'FACTORY_READY');
  assert.deepEqual(report.stations[0].problems, []);
  assert.equal(report.blueprints, 1);
  assert.equal(report.fundedCorporations, 1);
  assert.equal(report.richest.corporationID, 1000129);
  assert.equal(report.richest.isk, 250000000);
  assert.match(audit.format(report), /READY/);
});

test('an offline facility or one without manufacturing is named exactly', (t) => {
  const db = store(t, {
    facilities: [{stationID: 60000358, online: false, activities: {1: [[]]}},
      {stationID: 60000682, online: true, activities: {5: true}}],
    blueprints: {bp1: {}},
  });
  const report = audit.audit({db, candidateStations: [60000358, 60000682]});
  assert.deepEqual(report.stations[0].problems, ['FACILITY_OFFLINE']);
  assert.deepEqual(report.stations[1].problems, ['NO_MANUFACTURING_ACTIVITY']);
  assert.equal(report.status, 'FACTORY_NOT_READY');
});

test('a wallet that cannot be proven never counts as funded', (t) => {
  const db = store(t, {
    wallets: [{corporationID: 1000129, divisions: {1000: {balance: 'nope'}}}],
  });
  const report = audit.audit({db, candidateStations: [], minimumISK: 1});
  assert.equal(report.fundedCorporations, 0);
  assert.equal(report.richest, null);
});

test('the audit never writes: the tables are untouched afterwards', (t) => {
  const db = store(t, {facilities: [{stationID: 60000358, online: true, activities: {1: true}}]});
  const before = db.prepare('SELECT count(*) AS c FROM "industryFacilityState"').get().c;
  audit.audit({db, candidateStations: [60000358]});
  const after = db.prepare('SELECT count(*) AS c FROM "industryFacilityState"').get().c;
  assert.equal(after, before);
});

// The native facility payload keeps activities as OBJECTS keyed "1" (manufacturing),
// "3", "4", "5" - not booleans. Reading them as flags reported NO_MANUFACTURING_ACTIVITY
// for three stations that really can manufacture.
test('a facility whose "1" activity exists is a manufacturing facility', (t) => {
  const db = store(t, {
    facilities: [{stationID: 60000358, online: true, activities: {'1': [[], [], [[0.04]]]}}],
    blueprints: {bp: {}},
  });
  const report = audit.audit({db, candidateStations: [60000358]});
  assert.deepEqual(report.stations[0].problems, []);
  assert.equal(report.status, 'FACTORY_READY');
});
