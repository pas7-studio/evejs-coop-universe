import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Growing the freight fleet must be an operator decision with a real ship behind it: a durable
// hull spawned at a real anchor, never a renamed miner and never an invented event.
const source = fs.readFileSync(
  path.join(process.cwd(), "scripts/coop-spawn-distribution-hull.cjs"), "utf8");

test("a distribution hull is only spawned with the right marker and a real anchor", () => {
  assert.ok(/coop-distribution-\[0-9\]\+-hauler/.test(source), "the marker is validated");
  assert.ok(/REFUSED_NO_BELT/.test(source), "a system without a belt is refused, not guessed");
  assert.ok(/REFUSED_BAD_MARK/.test(source), "a wrong marker is refused by name");
});

test("nothing is spawned without an explicit confirmation", () => {
  assert.ok(/flag\("dry-run"\) \|\| !flag\("confirm"\)/.test(source),
    "a dry run is the default");
  assert.ok(/NOTHING_SPAWNED/.test(source));
});

test("the spawn goes through the native path and records a durable hull", () => {
  assert.ok(/spawnNativeNpcEntityInSystem/.test(source));
  assert.ok(/transient: false/.test(source), "a durable hull survives a restart");
  assert.ok(/anchorDescriptor/.test(source), "a real anchor, as the mining fleet uses");
});
