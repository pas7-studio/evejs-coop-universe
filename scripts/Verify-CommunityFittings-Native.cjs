#!/usr/bin/env node
'use strict';
// COOP-043 native acceptance probe.
// Loads the REAL upstream fitting store (no reimplementation) against a gamestore.sqlite,
// reads the community payload exactly like the in-game Community Fittings window, marshals
// it with the server's own encoder and reports objective size/shape facts.
// Read-only: the store is opened through the game's own persistence layer.
const fs = require('node:fs');
const path = require('node:path');

const codePath = path.resolve(process.env.EVEJS_CODE_PATH || 'C:/Games/EveCoop/upstream-evejs/Code');
const dataDir = process.env.EVEJS_GAMESTORE_DATA_DIR;
if (!dataDir) { console.error('REQUIRE_EVEJS_GAMESTORE_DATA_DIR'); process.exit(2); }
const dbPath = path.resolve(dataDir, '..', 'gamestore.sqlite');
if (!fs.existsSync(dbPath)) { console.error(`DB_NOT_FOUND ${dbPath}`); process.exit(2); }

const srcRoot = path.join(codePath, 'server', 'src');
const store = require(path.join(srcRoot, '_secondary/fitting/fittingStore'));
const { marshalEncode } = require(path.join(srcRoot, 'network/tcp/utils/marshal'));

// Macho payloads: {type:'dict',entries:[[k,v]]} / {type:'object',args:{...}} / {type:'list',items:[]}
function decode(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.type === 'dict') return new Map((value.entries || []).map(([k, v]) => [k, decode(v)]));
  if (value.type === 'object') return decode(value.args);
  if (value.type === 'list') return (value.items || value.entries || []).map(decode);
  if (value.type === 'tuple') return (value.items || value.entries || []).map(decode);
  return value;
}
function num(map, key) { const v = map instanceof Map ? map.get(key) : undefined; return Number(v); }

const payload = store.getCommunityFittingsResponse();
const entries = Array.isArray(payload?.entries) ? payload.entries : [];
const ids = [];
const byShip = new Map();
const names = new Set();
const signatures = new Set();
const problems = [];
for (const [fittingID, raw] of entries) {
  ids.push(Number(fittingID));
  const record = decode(raw);
  if (!(record instanceof Map)) { problems.push({ fittingID, reason: 'NOT_A_KEYVAL' }); continue; }
  const shipTypeID = num(record, 'shipTypeID');
  byShip.set(shipTypeID, (byShip.get(shipTypeID) || 0) + 1);
  const name = String(record.get('name') ?? '');
  if (!name || name.length > 50) problems.push({ fittingID, reason: 'BAD_NAME', name });
  if (names.has(name)) problems.push({ fittingID, reason: 'DUPLICATE_NAME', name });
  names.add(name);
  const fitData = record.get('fitData');
  const modules = fitData instanceof Map ? [...fitData.entries()] : (Array.isArray(fitData) ? fitData : []);
  if (!modules.length) problems.push({ fittingID, reason: 'EMPTY_FIT_DATA' });
  signatures.add(`${shipTypeID}:${JSON.stringify(modules)}`);
  if (num(record, 'ownerID') !== 1000282) problems.push({ fittingID, reason: 'WRONG_OWNER', ownerID: num(record, 'ownerID') });
}
const bytes = marshalEncode(payload).length;
const ships = [...byShip.entries()].sort((a, b) => b[1] - a[1]);
const withThree = ships.filter(([, n]) => n >= 3).length;
const withFive = ships.filter(([, n]) => n >= 5).length;
const sorted = ids.slice().sort((a, b) => a - b);
const first = sorted[0] ?? null;
const last = sorted[sorted.length - 1] ?? null;
console.log(JSON.stringify({
  dbPath,
  codePath,
  communityFittings: entries.length,
  distinctHulls: ships.length,
  hullsWithAtLeast3: withThree,
  hullsWithAtLeast5: withFive,
  distinctFitSignatures: signatures.size,
  duplicateSignatures: entries.length - signatures.size,
  duplicateNames: problems.filter(p => p.reason === 'DUPLICATE_NAME').length,
  marshalledBytes: bytes,
  compressedEstimateBytes: bytes > 170 ? 'cached-method-call-result compresses above 170 bytes' : 'raw',
  fittingIDRange: [first, last],
  topHulls: ships.slice(0, 10),
  problems: problems.slice(0, 10),
  problemCount: problems.length,
  verdict: entries.length > 0 && problems.length === 0 ? 'NATIVE_PAYLOAD_OK' : (entries.length === 0 ? 'EMPTY_COMMUNITY_STORE' : 'NATIVE_PAYLOAD_PROBLEMS'),
}, null, 2));
