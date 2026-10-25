import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compareTables, tableRecords, parseKey, sortedCanonical, TABLES } = require('../scripts/coop-sde-compat-diff.cjs');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-sde-diff-'));
  const baseline = path.join(root, 'baseline');
  const current = path.join(root, 'current');
  fs.mkdirSync(baseline);
  fs.mkdirSync(current);
  return { root, baseline, current, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function write(dir, name, rows) {
  fs.writeFileSync(path.join(dir, name + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

test('canonical JSON hashing ignores object-property order and counts type changes', async () => {
  const f = setup();
  try {
    write(f.baseline, 'types', [{ _key: 34, name: { en: 'Tritanium' }, size: 1 }, { _key: 35, size: 2 }]);
    write(f.current, 'types', [{ size: 1, name: { en: 'Tritanium' }, _key: 34 }, { _key: 36, size: 3 }]);
    const report = await compareTables(f.baseline, f.current, ['types']);
    assert.equal(report.dataStatus, 'COMPARED_NOT_CLIENT_VALIDATED');
    assert.deepEqual(report.tables[0].sampleAddedKeys, ['36']);
    assert.deepEqual(report.tables[0].sampleRemovedKeys, ['35']);
    assert.deepEqual(report.tables[0].sampleChangedKeys, []);
    write(f.current, 'types', [{ _key: 34, name: { en: 'Different' }, size: 1 }]);
    const changed = await compareTables(f.baseline, f.current, ['types']);
    assert.deepEqual(changed.tables[0].sampleChangedKeys, ['34']);
  } finally { f.cleanup(); }
});

test('missing datasets are reported as incomplete, never as empty changes', async () => {
  const f = setup();
  try {
    write(f.baseline, 'types', [{ _key: 34 }]);
    const report = await compareTables(f.baseline, f.current, ['types', 'mapSolarSystems']);
    assert.equal(report.dataStatus, 'INCOMPLETE');
    assert.equal(report.tables[0].status, 'MISSING_DATASET');
    assert.equal(report.tables[0].baselinePresent, true);
    assert.equal(report.tables[0].currentPresent, false);
  } finally { f.cleanup(); }
});

test('duplicate, missing, malformed and invalid JSONL identifiers fail closed', async () => {
  const f = setup();
  try {
    for (const rows of [[{ _key: 34 }, { _key: 34 }], [{ typeID: 34 }], [{ _key: 1.5 }]]) {
      write(f.baseline, 'types', rows);
      await assert.rejects(tableRecords(f.baseline, 'types'), /DUPLICATE_SDE_KEY|MISSING_SDE_KEY|INVALID_SDE_KEY/);
    }
    fs.writeFileSync(path.join(f.baseline, 'types.jsonl'), '{bad}\n');
    await assert.rejects(tableRecords(f.baseline, 'types'), /INVALID_JSON/);
  } finally { f.cleanup(); }
});

test('symlink and unknown tables rejected; source remains byte-identical', async () => {
  const f = setup();
  try {
    write(f.baseline, 'groups', [{ _key: 1 }]);
    fs.symlinkSync(path.join(f.baseline, 'groups.jsonl'), path.join(f.current, 'groups.jsonl'));
    await assert.rejects(tableRecords(f.current, 'groups'), /INVALID_DATA_FILE/);
    await assert.rejects(tableRecords(f.baseline, '../secret'), /UNKNOWN_TABLE/);
    assert.deepEqual(sortedCanonical({ z: 1, a: { y: 2, x: 3 } }), { a: { x: 3, y: 2 }, z: 1 });
    assert.equal(parseKey({ _key: 'abc' }), 'abc');
    assert.ok(TABLES.includes('blueprints'));
    assert.equal(fs.readFileSync(path.join(f.baseline, 'groups.jsonl'), 'utf8'), '{"_key":1}\n');
  } finally { f.cleanup(); }
});
