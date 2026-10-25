#!/usr/bin/env node
"use strict";

// Offline, read-only ID/data comparison of TWO extracted CCP JSONL SDEs.
// Does not download/modify either SDE or claim server/client compatibility.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const TABLES = Object.freeze([
  'types', 'groups', 'categories', 'typeDogma', 'dogmaAttributes',
  'dogmaEffects', 'blueprints', 'mapRegions', 'mapConstellations',
  'mapSolarSystems', 'mapStargates', 'mapAsteroidBelts', 'npcStations',
  'factions', 'industryAssemblyLines',
]);

function sortedCanonical(value) {
  if (Array.isArray(value)) return value.map(sortedCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedCanonical(value[key])]));
  }
  return value;
}

function parseKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, '_key')) {
    throw new Error('MISSING_SDE_KEY');
  }
  if (typeof value._key === 'number' && Number.isSafeInteger(value._key)) return String(value._key);
  if (typeof value._key === 'string' && value._key.trim() && value._key.length <= 256) return value._key;
  throw new Error('INVALID_SDE_KEY');
}

function requireRealDirectory(directory) {
  const real = fs.realpathSync(directory);
  if (!fs.statSync(real).isDirectory()) throw new Error(`NOT_DIRECTORY ${directory}`);
  return real;
}

async function tableRecords(directory, name) {
  if (!TABLES.includes(name)) throw new Error(`UNKNOWN_TABLE ${name}`);
  const root = requireRealDirectory(directory);
  const filename = path.join(root, `${name}.jsonl`);
  if (!fs.existsSync(filename)) return null;
  const stats = fs.lstatSync(filename);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`INVALID_DATA_FILE ${filename}`);
  const output = new Map();
  const input = fs.createReadStream(filename, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const line of lines) {
      lineNo++;
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); }
      catch { throw new Error(`INVALID_JSON ${name}.jsonl:${lineNo}`); }
      let key;
      try { key = parseKey(value); }
      catch (error) { throw new Error(`${error.message} ${name}.jsonl:${lineNo}`); }
      if (output.has(key)) throw new Error(`DUPLICATE_SDE_KEY ${name}.jsonl:${lineNo}:${key}`);
      const hash = crypto.createHash('sha256').update(JSON.stringify(sortedCanonical(value))).digest('hex');
      output.set(key, hash);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return output;
}

async function compareTables(baselineDir, currentDir, selected = TABLES) {
  const baselineRoot = requireRealDirectory(baselineDir);
  const currentRoot = requireRealDirectory(currentDir);
  const result = [];
  for (const name of selected) {
    const a = await tableRecords(baselineRoot, name);
    const b = await tableRecords(currentRoot, name);
    if (a === null || b === null) {
      result.push({ name, status: 'MISSING_DATASET', baselinePresent: a !== null, currentPresent: b !== null });
      continue;
    }
    const added = [], removed = [], changed = [];
    for (const [key, hash] of b) {
      if (!a.has(key)) added.push(key);
      else if (a.get(key) !== hash) changed.push(key);
    }
    for (const key of a.keys()) if (!b.has(key)) removed.push(key);
    for (const values of [added, removed, changed]) values.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
    result.push({
      name, status: 'COMPARED', baselineCount: a.size, currentCount: b.size,
      addedCount: added.length, removedCount: removed.length, changedCount: changed.length,
      sampleAddedKeys: added.slice(0, 20), sampleRemovedKeys: removed.slice(0, 20), sampleChangedKeys: changed.slice(0, 20),
    });
  }
  return {
    baselineDir: baselineRoot,
    currentDir: currentRoot,
    dataStatus: result.some(entry => entry.status !== 'COMPARED') ? 'INCOMPLETE' : 'COMPARED_NOT_CLIENT_VALIDATED',
    tables: result,
    warning: 'SDE ID/data deltas do not establish native algorithm, RPC, UI, dogma or 2026 client support.',
  };
}

function argsOf(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!['--baseline-sde', '--current-sde'].includes(arg)) throw new Error(`UNKNOWN_ARGUMENT ${arg}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`MISSING_VALUE ${arg}`);
    options[arg === '--baseline-sde' ? 'baselineDir' : 'currentDir'] = argv[++i];
  }
  if (!options.baselineDir || !options.currentDir) throw new Error('MISSING_SDE_DIRECTORIES');
  return options;
}

if (require.main === module) {
  (async () => {
    try {
      const options = argsOf(process.argv.slice(2));
      const result = await compareTables(options.baselineDir, options.currentDir);
      console.log(JSON.stringify(result, null, 2));
      if (result.dataStatus === 'INCOMPLETE') process.exitCode = 2;
    } catch (error) {
      console.error(`BLOCKED_SDE_COMPARE: ${error.message}`);
      process.exitCode = 2;
    }
  })();
}

module.exports = { TABLES, sortedCanonical, parseKey, tableRecords, compareTables, argsOf };
