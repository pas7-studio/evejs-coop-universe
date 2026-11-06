import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// MEASURED 2026-11-06 with the live heap sampler on an idle play stack: ruleAppliesToSystem was
// 88 MB of garbage per minute because it rebuilt four scope arrays with map+filter on every call,
// and it runs per rule per system. The normalised scope is cached per rule object and revalidated
// against the rule's own array identities, so an edited rule is never answered from a stale copy.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createRuleScopeCache} = require(
  path.join(forkRoot, "Code/server/src/space/npc/spawnRuleScope.js"));

test("a rule's scope is normalised once and reused", () => {
  const cache = createRuleScopeCache();
  const rule = {regionIDs: [10000002, "0", -5, "10000033"], systemIDs: ["30000144"],
    constellationID: "20000020"};
  const first = cache.scopeFor(rule);
  const second = cache.scopeFor(rule);
  assert.equal(first, second, "the same rule object must reuse the same scope object");
  assert.deepEqual(first.regionIDs, [10000002, 10000033], "non-positive ids are dropped");
  assert.deepEqual(first.systemIDs, [30000144]);
  assert.equal(first.fallbackConstellationID, 20000020);
});

test("replacing one of the rule's arrays recomputes instead of answering stale", () => {
  const cache = createRuleScopeCache();
  const rule = {regionIDs: [1]};
  const before = cache.scopeFor(rule);
  rule.regionIDs = [2, 3];
  const after = cache.scopeFor(rule);
  assert.notEqual(after, before);
  assert.deepEqual(after.regionIDs, [2, 3], "an edited rule must be re-read");
});

test("a rule with no scope arrays still answers empty lists, not undefined", () => {
  const cache = createRuleScopeCache();
  const scope = cache.scopeFor({});
  assert.deepEqual(scope.regionIDs, []);
  assert.deepEqual(scope.constellationIDs, []);
  assert.deepEqual(scope.wormholeClassIDs, []);
  assert.deepEqual(scope.systemIDs, []);
  assert.equal(scope.fallbackSystemID, 0);
});
