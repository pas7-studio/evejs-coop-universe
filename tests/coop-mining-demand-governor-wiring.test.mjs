import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The throttle is one line inside a large stock file, so its wiring is asserted
// structurally: a wrong anchor silently disables production control, which is
// exactly the kind of "quiet no-op" this repository keeps paying for.
const root = path.dirname(fileURLToPath(import.meta.url));
const spec = fs.readFileSync(path.join(root, '..', 'scripts', 'overlay-spec.cjs'), 'utf8');

test('the governor module is installed by the overlay', () => {
  assert.ok(spec.includes('"coopMiningDemandGovernor"'));
});

test('the governor gate is anchored on the native fleet think, not on a guess', () => {
  const at = spec.indexOf('coopMiningDemandGovernor").serverGovernor().hold');
  assert.ok(at > 0, 'the tick gate line must exist');
  const entry = spec.slice(spec.lastIndexOf('{anchor:', at), at);
  assert.match(entry, /anchor:"  fleetRecord\.nextThinkAtMs = now \+ thinkIntervalMs;"/);
  assert.match(entry, /after:true/);
  assert.match(entry, /process\.env\.EVEJS_COOP_MINING_DEMAND_GOVERNOR === "1"/);
});

test('a live station trip is never throttled away', () => {
  const at = spec.indexOf('coopMiningDemandGovernor").serverGovernor().hold');
  const line = spec.slice(at - 260, at + 260);
  assert.match(line, /!fleetRecord\.coopStationArrival/);
});

test('only a fleet that is actually mining is throttled', () => {
  // A fleet already carrying ore must still haul and sell it; the gate must read
  // the native state instead of blocking every tick.
  const at = spec.indexOf('coopMiningDemandGovernor").serverGovernor().hold');
  const line = spec.slice(at - 260, at + 60);
  assert.match(line, /String\(fleetRecord\.state \|\| ""\) === "mining"/);
});

test('a governor failure can never stop the stock mining tick', () => {
  const at = spec.indexOf('coopMiningDemandGovernor").serverGovernor().hold');
  const line = spec.slice(at, at + 320);
  assert.match(line, /catch \(_coopDemandError\)/);
  assert.match(line, /console\.warn\("\[CoopMiningDemandGovernor\]"/);
});
