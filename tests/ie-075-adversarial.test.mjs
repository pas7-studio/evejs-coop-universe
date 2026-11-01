import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();

function run(script, args) {
  const result = spawnSync(process.execPath, [join(fork, "Code/server/scripts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, EVEJS_FORK_ROOT: fork },
    timeout: 300000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    parsed = null;
  }
  return { status: result.status, parsed, stderr: String(result.stderr || "").slice(0, 500) };
}

test("adversarial wave 1: hostile inputs never break an invariant", () => {
  const result = run("coop-economy-adversarial.js", ["--seeds=40"]);
  assert.equal(result.status, 0, JSON.stringify(result.parsed || result.stderr));
  assert.ok(result.parsed, "no JSON summary");
  assert.equal(result.parsed.failures, 0, JSON.stringify(result.parsed.firstFailures));
  assert.ok(result.parsed.checks >= 70, "only " + result.parsed.checks + " checks ran");
});

test("adversarial wave 2: identity conflicts and replayed payloads stay refused", () => {
  const result = run("coop-economy-adversarial-2.js", []);
  assert.equal(result.status, 0, JSON.stringify(result.parsed || result.stderr));
  assert.ok(result.parsed, "no JSON summary");
  assert.equal(result.parsed.failures, 0, JSON.stringify(result.parsed.details));
  assert.ok(result.parsed.checks >= 25, "only " + result.parsed.checks + " checks ran");
});
