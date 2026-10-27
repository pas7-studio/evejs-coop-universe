// The alliance authority guard must stay reusable and default OFF.
//
// Engine: Code/server/src/space/coopStructureAllianceGuard.js
// Archived copy under test: integration/coopStructureAllianceGuard.cjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const FLAG = "EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD";
const { create } = require("../integration/coopStructureAllianceGuard.cjs");

const withFlag = (value, fn) => {
  const previous = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG]; else process.env[FLAG] = value;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env[FLAG]; else process.env[FLAG] = previous;
  }
};

test("flag OFF is a no-op: neither the authority nor the readers are consulted", () => {
  let consulted = 0;
  const guard = create({
    admit: () => { consulted++; return { ok: false }; },
    readers: () => { consulted++; return {}; },
    deny: () => { consulted++; },
  });
  withFlag(undefined, () => assert.equal(guard.enforce("UpdateAlliance", {}, {}), undefined));
  withFlag("0", () => assert.equal(guard.enforce("UpdateAlliance", {}, {}), undefined));
  assert.equal(consulted, 0);
});

test("flag ON denies a non-authoritative caller through the native deny path", () => {
  const guard = create({
    admit: () => ({ ok: false, reason: "NO_NATIVE_MEMBER" }),
    readers: () => ({ readCharacter: () => null }),
    deny: (verdict) => { throw Object.assign(new Error("CrpAccessDenied"), { verdict }); },
  });
  withFlag("1", () => assert.throws(() => guard.enforce("UpdateAlliance", { characterID: 1 }, {}), (err) => {
    assert.match(err.message, /CrpAccessDenied/);
    assert.equal(err.verdict.reason, "NO_NATIVE_MEMBER");
    return true;
  }));
});

test("flag ON allows an authoritative caller and forwards action, session and args", () => {
  const seen = [];
  const guard = create({
    admit: (call) => { seen.push(call); return { ok: true }; },
    readers: () => ({ readCharacter: () => ({ characterID: 9 }) }),
    deny: () => { throw new Error("must not deny"); },
  });
  const session = { characterID: 9 };
  const args = { allianceID: 7 };
  withFlag("1", () => assert.equal(guard.enforce("SetRelationship", session, args), undefined));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].action, "SetRelationship");
  assert.equal(seen[0].session, session);
  assert.equal(seen[0].args, args);
  assert.equal(seen[0].readCharacter().characterID, 9);
});

test("a binder with a missing part is rejected at construction", () => {
  assert.throws(() => create(), /admit/);
  assert.throws(() => create({ admit: () => ({ ok: true }) }), /readers/);
  assert.throws(() => create({ admit: () => ({ ok: true }), readers: () => ({}) }), /deny/);
});
