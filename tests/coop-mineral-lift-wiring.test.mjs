import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The mineral leg is one block inside a very large function, so its wiring is
// asserted structurally: a wrong order here is silent at build time and only
// shows up live as "loaded is not defined" on every station arrival, which is
// exactly what aborted the sale of a real haul once.
const root = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(root, '..', 'integration', 'coopVirtualWorldRuntime.cjs'), 'utf8');

test('the lift is declared before the telemetry that reads it', () => {
  const declared = source.indexOf('let loaded=null;');
  const read = source.indexOf('if(loaded&&loaded.status!=="LIFTED")');
  assert.ok(declared > 0, 'let loaded=null must exist');
  assert.ok(read > declared, 'telemetry must read a hoisted loaded');
});

test('minerals are loaded only after a merchant identity really exists', () => {
  const adoption = source.indexOf('return {status:"NOT_SOLD",reason:"HAULER_NOT_NAMED"}');
  const lift = source.indexOf('ensureMineralLift()?.lift');
  assert.ok(adoption > 0 && lift > 0);
  assert.ok(lift > adoption, 'cargo must never be loaded onto a ship that cannot sell it');
});

test('the lift runs once per arrival and only when its own flag is on', () => {
  const calls = source.split('ensureMineralLift()?.lift').length - 1;
  assert.equal(calls, 1);
  assert.match(source,
    /if\(process\.env\.EVEJS_COOP_NPC_MINERAL_LIFT==="1"&&\s*!arrivalSales\.has\(Number\(stationID\)/);
});

test('the sale keeps the lifted mineral types even when the allowlist lacks them', () => {
  const block = source.slice(source.indexOf('ensureMineralLift()?.lift'),
    source.indexOf('const trader=ensureMarketTrader();', source.indexOf('ensureMineralLift()?.lift')));
  assert.match(block, /sellTypes\.push\(typeID\)/);
});

test('the caller ore list can never filter out the minerals this arrival loaded', () => {
  // The arrival passes the ore types it carries, so a plain allowlist filter dropped
  // the just-lifted minerals and left them aboard (measured: 9 stacks stayed put while
  // the ore sold). The lifted types must bypass that filter explicitly.
  const wanted = source.indexOf('const wanted=[...new Set(sellTypes.filter');
  assert.ok(wanted > 0);
  const clause = source.slice(wanted, source.indexOf('const job=', wanted));
  assert.match(clause, /liftedTypes\.has\(Number\(typeID\)\)\|\|/);
  const decl = source.indexOf('const liftedTypes=new Set();');
  assert.ok(decl > 0 && decl < wanted, 'the set must exist before the wanted filter');
  assert.match(source, /liftedTypes\.add\(typeID\)/);
});

test('mineral cargo a previous arrival left in the hold is still sold', () => {
  const decl = source.indexOf('const liftedTypes=new Set();');
  const scan = source.indexOf('MINERAL_LIFT_CARGO_TAG.test', decl);
  const wanted = source.indexOf('const wanted=[...new Set(sellTypes.filter', decl);
  assert.ok(scan > decl && scan < wanted, 'the hold must be scanned before the sale filter');
  assert.ok(source.includes('listNativeCargoForEntity(Number(haulerID))'));
  assert.ok(source.includes('const MINERAL_LIFT_CARGO_TAG=/^coop-mineral-lift:v1:/;'));
});
