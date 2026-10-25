import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSde, validateFit, buildCatalog, selectDiverse } = require('../scripts/coop-community-fittings.cjs');
const { validateDogma, profileFit, readJsonl } = require('../scripts/coop-community-fit-dogma.cjs');

const ATTR = { cpu: 50, power: 30, meta: 633, calibration: 1153, rigSize: 1547, groupFitted: 1544, droneBw: 1272 };
const id = key => ({ _key: key });
const attr = (attributeID, value) => ({ attributeID, value });

function sdeFixture({ hullOverrides = {}, modules = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop043-dogma-'));
  const jsonl = (name, rows) => fs.writeFileSync(path.join(dir, name), rows.map(row => JSON.stringify(row)).join('\n'));
  jsonl('groups.jsonl', [
    { ...id(1), categoryID: 6, name: 'Frigate' },
    { ...id(60), categoryID: 7, name: 'Damage Control' },
    { ...id(509), categoryID: 7, name: 'Missile Launcher' },
    { ...id(74), categoryID: 7, name: 'Mining Laser' },
    { ...id(774), categoryID: 7, name: 'Rig Core' },
    { ...id(18), categoryID: 18, name: 'Combat Drone' },
    { ...id(255), categoryID: 16, name: 'Skill' },
  ]);
  jsonl('types.jsonl', [
    { ...id(600), groupID: 1, published: true, name: { en: 'Merlin' } },
    { ...id(201), groupID: 60, published: true, name: { en: 'Damage Control I' } },
    { ...id(202), groupID: 60, published: true, name: { en: 'Damage Control II' } },
    { ...id(203), groupID: 509, published: true, name: { en: 'Light Missile Launcher I' } },
    { ...id(204), groupID: 774, published: true, name: { en: 'Small Rig I' } },
    { ...id(205), groupID: 774, published: true, name: { en: 'Large Rig I' } },
    { ...id(206), groupID: 18, published: true, name: { en: 'Hobgoblin I' }, volume: 5 },
    { ...id(207), groupID: 74, published: true, name: { en: 'Miner II' } },
    { ...id(3300), groupID: 255, published: true, name: { en: 'Missile Launcher Operation' } },
    { ...id(9001), groupID: 60, published: true, name: { en: 'Undocumented Module' } },
  ]);
  jsonl('dogmaAttributes.jsonl', [id(50), id(30)]);
  jsonl('dogmaEffects.jsonl', [id(11), id(12), id(13), id(40), id(42), id(2663)]);
  const hullAttributes = [
    attr(11, 40), attr(12, 3), attr(13, 4), attr(14, 3), attr(48, 180),
    attr(1132, 400), attr(1137, 3), attr(1547, 1), attr(101, 2), attr(102, 2),
    attr(283, 50), attr(1271, 25), attr(38, 150), attr(182, 3300), attr(277, 1),
    ...Object.entries(hullOverrides).map(([key, value]) => attr(Number(key), value)),
  ];
  const effect = (...ids) => ids.map(effectID => ({ effectID, isDefault: false }));
  const moduleRows = [
    { ...id(201), dogmaAttributes: [attr(ATTR.cpu, 25), attr(ATTR.power, 1), attr(ATTR.meta, 0), attr(ATTR.groupFitted, 1), attr(182, 3300), attr(277, 4)], dogmaEffects: effect(11) },
    { ...id(202), dogmaAttributes: [attr(ATTR.cpu, 25), attr(ATTR.power, 1), attr(ATTR.meta, 6)], dogmaEffects: effect(11) },
    { ...id(203), dogmaAttributes: [attr(ATTR.cpu, 21), attr(ATTR.power, 6), attr(ATTR.meta, 0)], dogmaEffects: effect(12, 40) },
    { ...id(204), dogmaAttributes: [attr(ATTR.calibration, 50), attr(ATTR.rigSize, 1), attr(ATTR.meta, 0)], dogmaEffects: effect(2663) },
    { ...id(205), dogmaAttributes: [attr(ATTR.calibration, 120), attr(ATTR.rigSize, 2), attr(ATTR.meta, 0)], dogmaEffects: effect(2663) },
    { ...id(206), dogmaAttributes: [attr(ATTR.droneBw, 5), attr(ATTR.meta, 0)], dogmaEffects: effect(10) },
    { ...id(207), dogmaAttributes: [attr(ATTR.cpu, 60), attr(ATTR.power, 8), attr(ATTR.meta, 0)], dogmaEffects: effect(11) },
    ...Object.entries(modules).map(([key, row]) => ({ ...id(Number(key)), ...row })),
  ];
  jsonl('typeDogma.jsonl', [{ ...id(600), dogmaAttributes: hullAttributes }, ...moduleRows]);
  return dir;
}

const clean = dir => fs.rmSync(dir, { recursive: true, force: true });
const fit = (fitData, shipTypeID = 600) => ({ shipTypeID, shipName: 'Merlin', fitData });

test('pinned-style dogma accepts a real Merlin launcher setup and records live load', () => {
  const dir = sdeFixture();
  try {
    const sde = loadSde(dir);
    assert.ok(sde.dogma, 'dogma data must be loaded from the SDE directory');
    const result = validateFit(fit([[201, 11, 1], [203, 27, 1], [206, 87, 3], [204, 92, 1]]), sde);
    assert.equal(result.ok, true, JSON.stringify(result.reasons));
    assert.equal(result.warning, 'DOGMA_VALIDATED');
    assert.equal(result.dogma.stats.pg, 7);
    assert.equal(result.dogma.stats.launchers, 1);
    assert.equal(result.dogma.needsSkills.length, 0);
    assert.deepEqual(result.dogma.skills, [{ skillTypeID: 3300, level: 4 }]);
    assert.equal(result.profile.tier, 'budget');
  } finally { clean(dir); }
});

test('a module may not occupy a slot kind its own dogma effects forbid', () => {
  const dir = sdeFixture();
  try {
    const sde = loadSde(dir);
    const result = validateFit(fit([[204, 11, 1]]), sde);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'SLOT_KIND_MISMATCH');
    assert.equal(result.detail.slot, 'low');
    assert.deepEqual(result.detail.declared, ['rig']);
  } finally { clean(dir); }
});

test('rig size, calibration, hardpoint and slot-count limits are enforced', () => {
  const dir = sdeFixture();
  try {
    const sde = loadSde(dir);
    assert.equal(validateFit(fit([[205, 92, 1]]), sde).reason, 'RIG_SIZE_MISMATCH');
    const calib = validateFit(fit([[204, 92, 1], [204, 93, 1], [204, 94, 1], [204, 95, 1]]), sde);
    assert.equal(calib.ok, false);
    assert.ok(['SLOT_COUNT_EXCEEDED', 'CALIBRATION_EXCEEDED'].includes(calib.reason));
    const turrets = sdeFixture({});
    try {
      const hardpoints = validateFit(fit([[203, 27, 1], [203, 28, 1], [203, 29, 1]]), loadSde(turrets));
      assert.equal(hardpoints.reason, 'HARDPOINT_LAUNCHER_EXCEEDED');
    } finally { clean(turrets); }
    const twoSlot = sdeFixture({ hullOverrides: { 14: 2 } });
    try {
      const overSlots = validateFit(fit([[203, 27, 1], [203, 28, 1], [203, 29, 1]]), loadSde(twoSlot));
      assert.equal(overSlots.reason, 'SLOT_COUNT_EXCEEDED');
      assert.equal(overSlots.detail.capacity, 2);
    } finally { clean(twoSlot); }
  } finally { clean(dir); }
});

test('powergrid overflow is allowed only inside the all-V skill envelope', () => {
  const dir = sdeFixture({ hullOverrides: { 11: 20 } });
  try {
    const sde = loadSde(dir);
    const tight = validateFit(fit([[207, 11, 1]]), sde); // 8 PG of 20: fine
    assert.equal(tight.ok, true);
    const near = sdeFixture({ hullOverrides: { 11: 6 } });
    try {
      const stretched = validateFit(fit([[207, 11, 1]]), loadSde(near)); // 8 of 6 -> +33%
      assert.equal(stretched.reason, 'PG_IMPOSSIBLE');
      const skillFit = validateFit(fit([[203, 27, 1]]), loadSde(near)); // 6 of 6
      assert.equal(skillFit.ok, true);
    } finally { clean(near); }
  } finally { clean(dir); }
});

test('drone bay, cargo, stack and single-module group limits are enforced', () => {
  const dir = sdeFixture();
  try {
    const sde = loadSde(dir);
    assert.equal(validateFit(fit([[201, 11, 1], [206, 87, 11]]), sde).reason, 'DRONE_BAY_EXCEEDED');
    assert.equal(validateFit(fit([[201, 11, 1], [201, 12, 1]]), sde).reason, 'GROUP_LIMIT_EXCEEDED');
    const noDogma = validateFit(fit([[9001, 11, 1]]), sde);
    assert.equal(noDogma.reason, 'NO_DOGMA_DATA');
  } finally { clean(dir); }
});

test('profileFit labels real ship purpose and tier without inventing PvP claims', () => {
  const dir = sdeFixture();
  try {
    const sde = loadSde(dir);
    assert.deepEqual(profileFit([[207, 11, 1]], sde), { role: 'mining', tier: 'budget', rigCount: 0, bucket: 'mining:budget' });
    const advanced = profileFit([[201, 11, 1], [202, 12, 1], [204, 92, 1]], sde);
    assert.equal(advanced.tier, 'standard');
    assert.equal(advanced.rigCount, 1);
    assert.equal(advanced.bucket, 'combat:standard');
  } finally { clean(dir); }
});

test('diverse selection prefers distinct role/tier buckets over near duplicates', () => {
  const mk = (bucket, slots, signature) => {
    const [role, tier] = bucket.split(':');
    return { source: { kind: 'public-workbench' }, slots, signature, profile: { role, tier, bucket } };
  };
  const picked = selectDiverse([mk('combat:budget', 8, 'a'), mk('combat:budget', 7, 'b'), mk('mining:budget', 5, 'c'), mk('combat:standard', 8, 'd')], 3);
  assert.deepEqual(picked.map(x => x.signature).sort(), ['a', 'c', 'd']);
});

test('streaming SDE reader handles a real-size types file beyond the old 50 MB limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop043-big-'));
  try {
    const padding = 'x'.repeat(60000);
    const rows = [];
    for (let i = 1; i <= 900; i++) rows.push(JSON.stringify({ _key: i, groupID: 1, published: true, name: { en: `Hull ${i}` }, junk: padding }));
    const file = path.join(dir, 'types.jsonl');
    fs.writeFileSync(file, rows.join('\n'));
    assert.ok(fs.statSync(file).size > 50_000_000, 'fixture must exceed the previous 50 MB guard');
    const parsed = readJsonl(file);
    assert.equal(parsed.size, 900);
    assert.equal(parsed.get(1).name.en, 'Hull 1');
  } finally { clean(dir); }
});

test('catalog reports which hulls stayed uncovered and why', () => {
  const dir = sdeFixture();
  try {
    const sde = loadSde(dir);
    const record = { shipTypeID: 600, shipName: 'Merlin', fitData: [[201, 11, 1], [204, 92, 1]], source: { kind: 'public-workbench', url: 'https://eveworkbench.com/fit/x', author: 'Pilot' } };
    const broken = { ...record, fitData: [[204, 11, 1]] };
    const catalog = buildCatalog([{ shipTypeID: 600, shipName: 'Merlin' }], [record, broken], sde, 5);
    assert.equal(catalog.records.length, 1);
    assert.equal(catalog.summary.dogmaValidated, true);
    assert.equal(catalog.invalid[0].reason, 'SLOT_KIND_MISMATCH');
    assert.equal(catalog.coverage[0].available, 1);
    assert.equal(catalog.coverage[0].reason, 'TARGET_NOT_MET_ONLY_1_VALID');
    assert.match(catalog.records[0].name, /^\[EWB\] Combat budget: /);
  } finally { clean(dir); }
});
