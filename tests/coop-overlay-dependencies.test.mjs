import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const spec = require("../scripts/overlay-spec.cjs");

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const integration = path.join(repo, "integration");

// The overlay copies a fixed list of modules into the EveJS server. A module
// that another shipped module `require("./coopX")`s but that is missing from
// that list does not fail at build time: it fails inside a live world phase
// ("Cannot find module './coopWarObjectiveDirector'", seen on every world cycle
// on 2026-10-26). This test makes the copy list and the require graph agree.
function shipped(name) {
  return spec.names.includes(name);
}

function ourRequires(name) {
  const file = path.join(integration, name + ".cjs");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const found = [];
  for (const match of text.matchAll(/require\("\.\/(coop[A-Za-z0-9_]+)"\)/g)) {
    const dep = match[1];
    if (fs.existsSync(path.join(integration, dep + ".cjs"))) found.push(dep);
  }
  return found;
}

test("every module shipped by the overlay can resolve the co-op modules it requires", () => {
  const missing = [];
  for (const name of spec.names) {
    for (const dep of ourRequires(name)) {
      if (!shipped(dep)) missing.push(name + " -> " + dep);
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    "add the module to scripts/overlay-spec.cjs names, or it will not exist in the server");
});

test("every name in the copy list is a real file in this repository", () => {
  const absent = spec.names.filter((name) => !fs.existsSync(path.join(integration, name + ".cjs")));
  assert.deepEqual(absent, [], "the installer would silently skip these");
});

test("the copy list has no duplicates", () => {
  const seen = new Set();
  const duplicates = spec.names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
  assert.deepEqual(duplicates, []);
});
