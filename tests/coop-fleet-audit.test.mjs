import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const audit = require('../scripts/coop-fleet-audit.cjs');

// The store is the only truth about which hull a role got. A "hauler" that spawned
// as a mining hull cannot carry the ore the miners produce, and that is invisible in
// every event except the transfer refusal.
function store(t, actors){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-fleet-audit-'));
  const db = new DatabaseSync(path.join(dir, 'gamestore.sqlite'));
  db.exec('CREATE TABLE "npcEntities" (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO "npcEntities"(key,json) VALUES(?,?)');
  for (const actor of actors) {
    insert.run('entities\u001f' + actor.entityID, JSON.stringify(actor));
  }
  t.after(() => { db.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  return db;
}

const actor = (entityID, role, profileID, itemName) => ({
  entityID, systemID: 30000144, typeID: 1, itemName, profileID,
  operatorKind: 'coop-mining-30000144-1-' + role,
});

test('a slot with a real hauler profile is OK', (t)=>{
  const db = store(t, [
    actor(1, 'miner', 'ore_mining_skiff', 'Mining Skiff'),
    actor(2, 'hauler', 'ore_mining_badger_hauler', 'Badger'),
  ]);
  const slots = audit.verdict(audit.readActors(db));
  assert.equal(slots.length, 1);
  assert.equal(slots[0].status, 'OK');
  assert.match(audit.format(slots), /FLEET_COMPOSITION_OK/);
});

test('the live failure is reported as a re-composition, not as OK', (t)=>{
  const db = store(t, [
    actor(1, 'miner', 'ore_mining_hulk', 'Mining Hulk'),
    actor(2, 'hauler', 'ore_mining_venture', 'Mining Venture'),
  ]);
  const slots = audit.verdict(audit.readActors(db));
  assert.equal(slots[0].status, 'RECOMPOSE');
  assert.deepEqual(slots[0].problems, ['HAULER_IS_A_MINING_HULL:ore_mining_venture']);
  assert.match(audit.format(slots), /FLEET_RECOMPOSE_NEEDED/);
});

test('a slot with no hauler at all is reported', (t)=>{
  const db = store(t, [actor(1, 'miner', 'ore_mining_skiff', 'Mining Skiff')]);
  const slots = audit.verdict(audit.readActors(db));
  assert.equal(slots[0].status, 'RECOMPOSE');
  assert.ok(slots[0].problems.includes('NO_HAULER'));
});

test('non-fleet entities are ignored', (t)=>{
  const db = store(t, [
    {entityID: 9, typeID: 1, itemName: 'Random', profileID: 'generic_hostile', operatorKind: null},
  ]);
  assert.deepEqual(audit.readActors(db), []);
});
