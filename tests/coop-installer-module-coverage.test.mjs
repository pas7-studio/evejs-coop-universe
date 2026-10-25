import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..");
const integrationDir = join(root, "integration");

function shippedNames() {
  const text = readFileSync(join(root, "scripts", "patch-evejs-coop.cjs"), "utf8");
  const line = text.split("\n").find((row) => row.startsWith("const names=["));
  assert.ok(line, "the installer must declare its module names array");
  return new Set([...line.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]));
}

function localModules() {
  return readdirSync(integrationDir)
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => name.replace(/\.cjs$/, ""));
}

// Modules that genuinely must not be shipped: offline/one-shot helpers that are
// executed as scripts, never required by a runtime overlay module. Anything
// else in integration/ must appear in the overlay list, so "added a module but
// forgot to ship it" stays a test failure instead of a silent deploy hole.
const OFFLINE_ONLY = new Set([
  "coopSkillGrant", // used by scripts/coop-grant-skills.cjs only
  "coopNpcIndustryOfflineAtomic",
  "coopNpcIndustryOfflineDelivery",
  "coopNpcIndustryGameStoreScope",
  "coopNpcIndustryNativeBindings",
  "coopNpcIndustryReady",
  "coopNpcEconomyScheduler",
  "coopNpcNativeEconomyDirector",
  "coopEscortContractSettlement",
  "coopEscortNativeFunds",
]);

test("the installer names only real modules and ships every runtime module", () => {
  const shipped = shippedNames();
  const modules = localModules();
  for (const name of shipped) {
    assert.ok(modules.includes(name), `installer references a non-existent module: ${name}`);
  }
  const unshipped = modules.filter((module) => !shipped.has(module) && !OFFLINE_ONLY.has(module));
  assert.deepEqual(unshipped, [], "runtime modules present in integration/ but never copied into Code");
  for (const name of OFFLINE_ONLY) {
    assert.ok(modules.includes(name), `OFFLINE_ONLY lists a module that no longer exists: ${name}`);
  }
  assert.ok(shipped.size > 50, "the installer must ship the runtime overlay");
});

test("every extension-less require between integration modules is shipped", () => {
  // Node's CJS resolver never tries ".cjs", and the deployed copy is <name>.js,
  // so a module that is required but not shipped fails only at runtime.
  const shipped = shippedNames();
  const modules = localModules();
  const broken = [];
  for (const module of modules) {
    const text = readFileSync(join(integrationDir, module + ".cjs"), "utf8");
    for (const match of text.matchAll(/require\("\.\/([A-Za-z0-9_]+)"\)/g)) {
      const dep = match[1];
      if (!modules.includes(dep)) continue;
      if (!shipped.has(dep)) broken.push(`${module} -> ${dep}`);
    }
  }
  assert.deepEqual(broken, [], "runtime require target missing from the installer");
});
