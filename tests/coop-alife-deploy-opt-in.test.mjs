import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const deploy = readFileSync(join(root, "scripts", "Deploy-Coop-RuntimeProbe.ps1"), "utf8");

test("ALIFE deployment is an explicit opt-in with its own switch", () => {
  assert.match(deploy, /\[switch\]\$Alife,/);
  assert.match(deploy, /\[switch\]\$AlifeTrace,/);
  assert.match(deploy, /EVEJS_COOP_ALIFE: '1'/);
  assert.match(deploy, /EVEJS_COOP_ALIFE_TRACE: '1'/);
});

test("ALIFE cannot be deployed without the live co-op base or trace alone", () => {
  assert.match(deploy, /if \(\(\$Alife -or \$AlifeTrace\) -and -not \$LivingCoop\) \{ throw 'ALIFE mode requires -LivingCoop' \}/);
  assert.match(deploy, /if \(\$AlifeTrace -and -not \$Alife\) \{ throw '-AlifeTrace requires -Alife' \}/);
});

test("ALIFE stays off unless the switch is passed", () => {
  // Both writes must live inside `if ($Alife...)` blocks, never at top level.
  const alifeBlock = deploy.slice(deploy.indexOf("if ($Alife)"));
  assert.ok(alifeBlock.startsWith("if ($Alife)"), "the ALIFE env write must be conditional");
  assert.match(alifeBlock.slice(0, 400), /EVEJS_COOP_ALIFE: '1'/);
});
