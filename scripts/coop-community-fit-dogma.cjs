'use strict';
// COOP-043. Real SDE/Dogma validation for community fitting records.
// No client modification, no game writes, Node builtins only.
// Design rules:
//  - a published module must exist in typeDogma, otherwise the native client cannot fit it;
//  - a module may only occupy a slot kind its own dogma effects declare;
//  - hull slot counts, rig size, calibration, hardpoints and drone bay are hard limits;
//  - CPU/Powergrid overflow up to +25% is accepted as "fits with all-V fitting skills"
//    (CPU Management / Power Grid Upgrades are +5%/level), anything above is impossible.
const fs = require('node:fs');
const path = require('node:path');

const ATTR = {
  cpuOutput: 48, powerOutput: 11, cpu: 50, power: 30,
  calibrationCapacity: 1132, calibrationCost: 1153, rigSize: 1547,
  hiSlots: 14, medSlots: 13, lowSlots: 12, rigSlots: 1137,
  subsystemSlots: 1366, serviceSlots: 2056,
  turretHardpoints: 102, launcherHardpoints: 101,
  droneCapacity: 283, droneBandwidth: 1271, droneBandwidthUsed: 1272,
  maxGroupFitted: 1544, metaLevel: 633, capacity: 38,
  requiredSkill: [[182, 277], [183, 278], [184, 279], [1285, 1286], [1289, 1287], [1290, 1288]],
};
const EFFECT = { loPower: 11, hiPower: 12, medPower: 13, launcherFitted: 40, turretFitted: 42, rigSlot: 2663, subSystem: 3772, serviceSlot: 6306 };
const SLOT_EFFECT_KIND = new Map([[11, 'low'], [12, 'high'], [13, 'mid'], [2663, 'rig'], [3772, 'subsystem'], [6306, 'service']]);
// EVE flag ranges; flag 5 cargo / 87 drone bay / 158 fighter bay are not module slots.
const FLAG_RANGES = [
  ['low', 11, 18], ['mid', 19, 26], ['high', 27, 34], ['rig', 92, 99],
  ['subsystem', 125, 132], ['service', 164, 171], ['drone', 87, 87], ['cargo', 5, 5], ['fighter', 158, 158],
];
const SLOT_FLAG_RANGES = FLAG_RANGES.filter(r => !['drone', 'cargo', 'fighter'].includes(r[0]));
const SKILL_CATEGORY_ID = 16;
const MODULE_CATEGORY_ID = 7;
const DRONE_CATEGORY_ID = 18;
const MAX_SKILL_CPU_PG_BONUS = 0.25;   // CPU Management V / Power Grid Upgrades V
const MAX_IMPLANT_CPU_PG_BONUS = 0.05; // best-case CPU/PG fitting implant (+5%)
// Group names drive the player-visible role label; first match wins.
const ROLE_RULES = [
  [/mining|ore |harvest|gas cloud|ice harvester|mercoxit/i, 'mining'],
  [/logistics|remote shield|remote armor|remote hull|remote capacitor/i, 'logistics'],
  [/warp disrupt|warp scrambl|stasis web|target jam|ecm|sensor damp|tracking disrupt|target painter|energy neutral|energy nosferatu|capacitor warfare/i, 'ewar'],
  [/probe|scan|analyzer|cloak|survey|salvag/i, 'exploration'],
  [/cargo expander|haul|industrial|ore hold/i, 'hauling'],
];
const text = value => String(value == null ? '' : value);
const typeName = row => typeof row?.name === 'string' ? row.name : (row?.name?.en || '');
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

// Streaming JSONL reader: the pinned pinned SDE types.jsonl is ~144 MB, so a whole-file
// string is neither safe nor portable. Caps stay in place to fail loudly on wrong SDEs.
function readJsonl(file, limit = 400000) {
  const fd = fs.openSync(file, 'r');
  const items = new Map();
  let rowCount = 0;
  try {
    const size = fs.fstatSync(fd).size;
    if (size > 1_000_000_000) throw Error('SDE_FILE_TOO_LARGE');
    const chunk = Buffer.allocUnsafe(1 << 22);
    let carry = '';
    const push = line => {
      const body = line.trim();
      if (!body) return;
      const row = JSON.parse(body);
      const id = Number(row._key ?? row.typeID ?? row.groupID);
      if (positive(id)) items.set(id, row);
      if (++rowCount > limit) throw Error('SDE_ROW_LIMIT');
    };
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!read) break;
      const parts = (carry + chunk.toString('utf8', 0, read)).split('\n');
      carry = parts.pop();
      for (const part of parts) push(part);
    }
    if (carry) push(carry);
  } finally {
    fs.closeSync(fd);
  }
  return items;
}

function loadDogma(dir) {
  const files = ['typeDogma.jsonl', 'dogmaAttributes.jsonl', 'dogmaEffects.jsonl'];
  if (!files.every(name => fs.existsSync(path.join(dir, name)))) return null;
  return {
    typeDogma: readJsonl(path.join(dir, 'typeDogma.jsonl')),
    attributes: readJsonl(path.join(dir, 'dogmaAttributes.jsonl')),
    effects: readJsonl(path.join(dir, 'dogmaEffects.jsonl')),
  };
}

function attrMap(dogma, typeID) {
  const row = dogma.typeDogma.get(Number(typeID));
  const map = new Map();
  if (row && Array.isArray(row.dogmaAttributes)) {
    for (const entry of row.dogmaAttributes) map.set(Number(entry.attributeID), Number(entry.value));
  }
  return map;
}
function effectSet(dogma, typeID) {
  const row = dogma.typeDogma.get(Number(typeID));
  return new Set((Array.isArray(row?.dogmaEffects) ? row.dogmaEffects : []).map(entry => Number(entry.effectID)));
}
function flagSlotKind(flag) {
  for (const [kind, min, max] of FLAG_RANGES) if (flag >= min && flag <= max) return { kind, index: flag - min };
  return null;
}
function slotCapacity(hullAttrs, kind) {
  const map = {
    low: ATTR.lowSlots, mid: ATTR.medSlots, high: ATTR.hiSlots, rig: ATTR.rigSlots,
    subsystem: ATTR.subsystemSlots, service: ATTR.serviceSlots,
  };
  const value = hullAttrs.get(map[kind]);
  return Number.isFinite(value) ? value : null;
}

// Returns { ok, reasons[{code,detail}], stats, skills, needsSkills }.
function validateDogma(record, sde) {
  const dogma = sde && sde.dogma;
  if (!dogma) return { ok: true, skipped: 'NO_DOGMA_SDE', reasons: [] };
  const reasons = [];
  const shipTypeID = Number(record.shipTypeID);
  const hullAttrs = attrMap(dogma, shipTypeID);
  if (!hullAttrs.size) {
    return { ok: false, reasons: [{ code: 'MISSING_HULL_DOGMA', detail: { shipTypeID } }], stats: {} };
  }
  const hullRigSize = hullAttrs.get(ATTR.rigSize);
  const cpuCapacity = hullAttrs.get(ATTR.cpuOutput) || 0;
  const pgCapacity = hullAttrs.get(ATTR.powerOutput) || 0;
  const calibrationCapacity = hullAttrs.get(ATTR.calibrationCapacity);
  const turretHardpoints = hullAttrs.get(ATTR.turretHardpoints);
  const launcherHardpoints = hullAttrs.get(ATTR.launcherHardpoints);
  const droneCapacity = hullAttrs.get(ATTR.droneCapacity);
  const droneBandwidth = hullAttrs.get(ATTR.droneBandwidth);
  const cargoCapacity = hullAttrs.get(ATTR.capacity);

  const stats = {
    cpu: 0, cpuCapacity, pg: 0, pgCapacity, calibration: 0, calibrationCapacity,
    cpuEffective: 0, pgEffective: 0,
    turrets: 0, launchers: 0, turretHardpoints, launcherHardpoints,
    dronesVolume: 0, droneCapacity, droneBandwidth: 0, droneBandwidthCapacity: droneBandwidth,
    cargoVolume: 0, cargoCapacity,
    slots: { low: 0, mid: 0, high: 0, rig: 0, subsystem: 0, service: 0 },
    maxMetaLevel: 0,
  };
  const skills = new Map();
  const groupFitted = new Map();
  const unclassified = [];

  for (const entry of record.fitData) {
    const id = Number(entry[0]), flag = Number(entry[1]), quantity = Number(entry[2]);
    const type = sde.types.get(id);
    if (!type) { reasons.push({ code: 'UNKNOWN_ITEM', detail: { itemID: id } }); continue; }
    const slot = flagSlotKind(flag);
    const attrs = attrMap(dogma, id);
    const effects = effectSet(dogma, id);
    for (const [skillAttr, levelAttr] of ATTR.requiredSkill) {
      const skillID = attrs.get(skillAttr);
      if (!skillID) continue;
      const level = Number(attrs.get(levelAttr));
      const skillType = sde.types.get(Number(skillID));
      const categoryID = Number(sde.groups.get(Number(skillType?.groupID))?.categoryID);
      if (!skillType || skillType.published !== true || categoryID !== SKILL_CATEGORY_ID || !(level >= 1 && level <= 5)) {
        reasons.push({ code: 'REQUIRED_SKILL_UNKNOWN', detail: { itemID: id, skillID, level } });
        continue;
      }
      skills.set(Number(skillID), Math.max(skills.get(Number(skillID)) || 0, level));
    }
    if (!slot) continue;
    if (slot.kind === 'drone' || slot.kind === 'cargo' || slot.kind === 'fighter') {
      const volume = Number(type.volume) || 0;
      if (slot.kind === 'drone') {
        stats.dronesVolume += volume * quantity;
        stats.droneBandwidth += (attrs.get(ATTR.droneBandwidthUsed) || 0) * quantity;
      } else if (slot.kind === 'cargo') {
        stats.cargoVolume += volume * quantity;
      }
      continue;
    }
    // A fitted module needs dogma data; without it the native client cannot resolve it.
    if (!attrs.size && !effects.size) { reasons.push({ code: 'NO_DOGMA_DATA', detail: { itemID: id, flag } }); continue; }
    const declared = new Set();
    for (const effectID of effects) {
      const kind = SLOT_EFFECT_KIND.get(effectID);
      if (kind) declared.add(kind);
    }
    if (declared.size && !declared.has(slot.kind)) {
      reasons.push({ code: 'SLOT_KIND_MISMATCH', detail: { itemID: id, item: typeName(type), flag, slot: slot.kind, declared: [...declared] } });
      continue;
    }
    if (!declared.size) unclassified.push({ itemID: id, flag });
    const capacity = slotCapacity(hullAttrs, slot.kind);
    if (capacity != null && slot.index >= capacity) {
      reasons.push({ code: 'SLOT_COUNT_EXCEEDED', detail: { itemID: id, slot: slot.kind, index: slot.index, capacity } });
      continue;
    }
    if (slot.kind === 'subsystem' && !(slotCapacity(hullAttrs, 'subsystem') > 0)) {
      reasons.push({ code: 'SUBSYSTEM_NOT_ALLOWED', detail: { itemID: id } });
      continue;
    }
    if (slot.kind === 'rig') {
      const rigSize = attrs.get(ATTR.rigSize);
      if (rigSize != null && hullRigSize != null && Number(rigSize) !== Number(hullRigSize)) {
        reasons.push({ code: 'RIG_SIZE_MISMATCH', detail: { itemID: id, rigSize, hullRigSize } });
      }
      stats.calibration += attrs.get(ATTR.calibrationCost) || 0;
    }
    stats.cpu += attrs.get(ATTR.cpu) || 0;
    stats.pg += attrs.get(ATTR.power) || 0;
    // Weapon Upgrades V (-25% CPU) and Advanced Weapon Upgrades V (-10% PG) apply to
    // turret/launcher modules; both are standard prerequisites of a fitted combat ship.
    const weapon = effects.has(EFFECT.turretFitted) || effects.has(EFFECT.launcherFitted);
    if (weapon) {
      stats.cpuEffective += (attrs.get(ATTR.cpu) || 0) * 0.75;
      stats.pgEffective += (attrs.get(ATTR.power) || 0) * 0.9;
    } else {
      stats.cpuEffective += attrs.get(ATTR.cpu) || 0;
      stats.pgEffective += attrs.get(ATTR.power) || 0;
    }
    stats.slots[slot.kind] += 1;
    stats.maxMetaLevel = Math.max(stats.maxMetaLevel, Number(attrs.get(ATTR.metaLevel)) || 0);
    if (effects.has(EFFECT.turretFitted)) stats.turrets += 1;
    if (effects.has(EFFECT.launcherFitted)) stats.launchers += 1;
    const groupKey = `${Number(type.groupID)}:${attrs.get(ATTR.maxGroupFitted) || 0}`;
    groupFitted.set(groupKey, (groupFitted.get(groupKey) || 0) + 1);
    if ((attrs.get(ATTR.maxGroupFitted) || 0) === 1 && groupFitted.get(groupKey) > 1) {
      reasons.push({ code: 'GROUP_LIMIT_EXCEEDED', detail: { itemID: id, groupID: Number(type.groupID) } });
    }
  }

  if (calibrationCapacity != null && stats.calibration > Number(calibrationCapacity)) {
    reasons.push({ code: 'CALIBRATION_EXCEEDED', detail: { used: stats.calibration, capacity: calibrationCapacity } });
  }
  if (turretHardpoints != null && stats.turrets > Number(turretHardpoints)) {
    reasons.push({ code: 'HARDPOINT_TURRET_EXCEEDED', detail: { used: stats.turrets, capacity: turretHardpoints } });
  }
  if (launcherHardpoints != null && stats.launchers > Number(launcherHardpoints)) {
    reasons.push({ code: 'HARDPOINT_LAUNCHER_EXCEEDED', detail: { used: stats.launchers, capacity: launcherHardpoints } });
  }
  // Drone bandwidth / max active drones limit how many drones are *launched*, not what the
  // bay may hold, so they are reported but never a fitting rejection (the client controls it).
  if (droneCapacity != null && stats.dronesVolume > Number(droneCapacity)) {
    reasons.push({ code: 'DRONE_BAY_EXCEEDED', detail: { used: stats.dronesVolume, capacity: droneCapacity } });
  }
  if (cargoCapacity != null && stats.cargoVolume > Number(cargoCapacity)) {
    reasons.push({ code: 'CARGO_OVERFLOW', detail: { used: stats.cargoVolume, capacity: cargoCapacity } });
  }
  const limit = (1 + MAX_SKILL_CPU_PG_BONUS) * (1 + MAX_IMPLANT_CPU_PG_BONUS);
  const needsSkills = [];
  const cpuAvailable = cpuCapacity * limit;
  const pgAvailable = pgCapacity * limit;
  if (cpuCapacity > 0 && stats.cpuEffective > cpuAvailable) {
    reasons.push({ code: 'CPU_IMPOSSIBLE', detail: { used: stats.cpuEffective, capacity: cpuAvailable } });
  } else if (cpuCapacity > 0 && stats.cpu > cpuCapacity) {
    needsSkills.push('cpu');
  }
  if (pgCapacity > 0 && stats.pgEffective > pgAvailable) {
    reasons.push({ code: 'PG_IMPOSSIBLE', detail: { used: stats.pgEffective, capacity: pgAvailable } });
  } else if (pgCapacity > 0 && stats.pg > pgCapacity) {
    needsSkills.push('powergrid');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    stats,
    skills: [...skills.entries()].sort((a, b) => a[0] - b[0]).map(([skillTypeID, level]) => ({ skillTypeID, level })),
    needsSkills,
    unclassified,
  };
}

// Player-visible role/tier used for coverage diversity and record naming.
function profileFit(fitData, sde) {
  const dogma = sde && sde.dogma;
  const counts = new Map();
  let maxMetaLevel = 0;
  let rigCount = 0;
  for (const entry of fitData) {
    const id = Number(entry[0]), flag = Number(entry[1]);
    const slot = flagSlotKind(flag);
    if (!slot || ['cargo', 'drone'].includes(slot.kind)) continue;
    if (slot.kind === 'rig') rigCount += 1;
    const type = sde.types.get(id);
    const groupName = typeName(sde.groups.get(Number(type?.groupID)));
    for (const [pattern, role] of ROLE_RULES) {
      if (pattern.test(groupName)) { counts.set(role, (counts.get(role) || 0) + 1); break; }
    }
    if (dogma) maxMetaLevel = Math.max(maxMetaLevel, Number(attrMap(dogma, id).get(ATTR.metaLevel)) || 0);
  }
  const role = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'combat';
  const tier = maxMetaLevel <= 4 ? 'budget' : maxMetaLevel <= 7 ? 'standard' : 'advanced';
  return { role, tier, rigCount, bucket: `${role}:${tier}` };
}

module.exports = {
  ATTR, EFFECT, READ_LIMIT: 400000, MAX_SKILL_CPU_PG_BONUS,
  readJsonl, loadDogma, validateDogma, profileFit, attrMap, effectSet, flagSlotKind, slotCapacity,
  MODULE_CATEGORY_ID, DRONE_CATEGORY_ID, SKILL_CATEGORY_ID, SLOT_FLAG_RANGES,
};
