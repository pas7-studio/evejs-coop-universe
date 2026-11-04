import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// Live failure 2026-11-04 11:59: the friend's client could not scoop his own MTU.
// The server log showed "ERR ship MachoBindObject() toNumber is not defined": the client
// binds sm.GetService('gameui').GetShipAccess() and RealScoop runs as a nested call, so the
// ReferenceError turned the whole bind response into null and the client died with
// "TypeError: 'NoneType' object is not iterable" instead of showing the scoop action.
// mobileTractorUnitRuntime defines toInt/toReal, never toNumber - and node --check cannot
// see a missing function at runtime.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const file = path.join(
  forkRoot,
  "Code/server/src/services/ship/mobileTractorUnitRuntime.js",
);

test("MTU runtime never calls an undefined numeric helper", () => {
  const source = readFileSync(file, "utf8");
  const calls = source
    .split("\n")
    .map((line, index) => ({line, index: index + 1}))
    .filter((entry) => /(?<![A-Za-z_.])toNumber\(/.test(entry.line));
  assert.deepEqual(
    calls.map((entry) => entry.line.trim()),
    [],
    "toNumber is not defined in this module; use toInt/toReal",
  );
});

test("ship-capacity math in the scoop path uses the local helper", () => {
  const source = readFileSync(file, "utf8");
  const at = source.indexOf("const capacity = Math.max(0,");
  assert.ok(at > 0, "the scoop capacity line must exist");
  const statement = source.slice(at, at + 90);
  assert.match(statement, /toReal\(/, "capacity must come from toReal");
});
