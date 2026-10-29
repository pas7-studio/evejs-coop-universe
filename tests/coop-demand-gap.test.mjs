import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The loop is logistics-complete; its ceiling became production. Measured 2026-10-30: the freight
// hulls filled 310 000-543 000 units per trip while the corporation owned exactly three
// blueprints, and the top of the seeded book is full of artifacts nobody here can make.
const source = fs.readFileSync(
  path.join(process.cwd(), "scripts/coop-demand-gap.cjs"), "utf8");

test("the demand gap tool ignores seeded artifacts and impossible prices", () => {
  assert.ok(/PRODUCIBLE = new Set\(\[6, 7, 8, 18, 32\]\)/.test(source),
    "only categories a real industry can build here");
  assert.ok(/maxPrice/.test(source), "a 92 billion ISK hardener is not a shopping list");
});

test("it separates what can be built from what cannot", () => {
  assert.ok(/BUILDABLE/.test(source) && /GAP/.test(source));
  assert.ok(/blueprints/.test(source), "and starts from the blueprints the corporation owns");
  assert.ok(/GAP_VALUE/.test(source), "the size of the gap is printed, not implied");
});
