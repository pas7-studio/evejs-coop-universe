// FW-102: the mobilisation diagnostic and the mobilisation phase must share ONE factory.
//
// Measured on the play stack 2026-10-30: the phase kept ticking
// (`living-native-war-skip phase=mobilization reason=NO_MOBILIZED_SHIP:OBSERVED`) while
// `war_diagnose` - the single read-only action whose job is to explain an empty side -
// answered `MOBILIZER_NOT_INITIALIZED`, because the instance was created lazily inside the
// phase and the diagnostic only looked at the variable. The per-side rejection reasons
// were therefore unreachable exactly when they were needed: a stalled front with an empty
// fleet registry and no way to see which native gate refused the real hull.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, "..", "integration", "coopVirtualWorldRuntime.cjs"), "utf8");

function body(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in the runtime`);
  let depth = 0;
  let index = source.indexOf("{", start);
  const from = index;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(from, index + 1);
}

test("the mobiliser is constructed in exactly one place", () => {
  const sites = source.match(/createWarMobilizer\(\{/g) || [];
  assert.equal(sites.length, 1, "a second construction site would drift from the phase");
  assert.match(body("warMobilizerInstance"), /createWarMobilizer\(\{/);
});

test("the phase and the diagnostic both go through the shared factory", () => {
  assert.match(body("advanceNativeWarMobilization"), /warMobilizerInstance\(registry,guard\)/);
  const diagnose = body("diagnoseMobilization");
  assert.match(diagnose, /warMobilizerInstance\(registry,guard\)/,
    "the diagnose must create the instance instead of answering NOT_INITIALIZED");
  assert.doesNotMatch(diagnose, /if\(!warMobilizer\)return \{status:"MOBILIZER_NOT_INITIALIZED"\}/);
  assert.match(diagnose, /dryRun:true/, "a diagnostic may only dry-run: no write, no order");
});

test("an idle tick publishes the per-side report it already computed", () => {
  const phase = body("advanceNativeWarMobilization");
  assert.match(phase, /living-native-war-mobilization-idle/);
  assert.match(phase, /result\.campaigns/,
    "the report the mobiliser returns is the only record of which gate refused a hull");
  assert.match(phase, /rejected/);
});
