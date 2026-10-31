import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A helper that does not exist is invisible until it is called, and every caller wraps its
// work in a try/catch that reports "nothing to do". Measured 2026-10-31: `num(...)` was used
// inside the factory reserve and the shopping-trip planner of coopLoopTick while the module
// declared no such helper, so every reference threw ReferenceError, the catch turned it into
// null, and the whole input reserve silently answered "nothing is missing" for hours.
const here = path.dirname(fileURLToPath(import.meta.url));
const integration = path.join(here, "..", "integration");

const OWNED = [
  "coopLoopTick.cjs",
  "coopDistributionRun.cjs",
  "coopDistributionPlan.cjs",
  "coopNpcInputSupply.cjs",
  "coopNpcCargoStow.cjs",
  "coopNpcManufacture.cjs",
  "coopNpcMineralLift.cjs",
  "coopPilotPayroll.cjs",
];

// Any declaration shape counts: const/let/var/function, or a parameter/destructured name.
// The check is deliberately textual and narrow - it only guards the two helpers that the
// economy modules share and that have already been lost once.
function declares(source, name) {
  const patterns = [
    new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`),
    new RegExp(`[{,]\\s*${name}\\s*=`),
    new RegExp(`${name}\\s*=\\s*(?:x|\\(|function)`),
    new RegExp(`\\b${name}\\s*:\\s*${name}\\b`),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

function uses(source, name) {
  return new RegExp(`(^|[^\\w$.])${name}\\s*\\(`, "m").test(source);
}

test("the checker really catches an undeclared helper", () => {
  const faulty = "function f(){ try { return num(1); } catch (_error) { return null; } }";
  assert.equal(uses(faulty, "num"), true);
  assert.equal(declares(faulty, "num"), false);
  const fixed = "const num=(x)=>Number(x)||0;\nfunction f(){return num(1);}";
  assert.equal(declares(fixed, "num"), true);
});

test("every economy module declares the helpers it calls", () => {
  const broken = [];
  for (const file of OWNED) {
    const full = path.join(integration, file);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, "utf8");
    for (const helper of ["num", "pos"]) {
      if (uses(source, helper) && !declares(source, helper)) broken.push(`${file}: ${helper}()`);
    }
  }
  assert.deepEqual(broken, [], "a called helper that is never declared throws away real work");
});
