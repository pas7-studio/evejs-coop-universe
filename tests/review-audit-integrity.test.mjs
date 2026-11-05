import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Finding 4 (independent review of 15c374a): both audit and crosscheck count malformed receipt
// files and then decide success without them. A directory of unreadable receipts reports ok:true.
const root = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const AUDIT = path.join(root, "Code/server/scripts/coop-economy-v2-audit.js");
const CROSSCHECK = path.join(root, "Code/server/scripts/coop-economy-v2-crosscheck.js");

function fixture({ corrupt }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-audit-review-"));
  const receipts = path.join(dir, "receipts");
  fs.mkdirSync(receipts);
  const at = Date.now();
  const state = {
    version: 1, mode: "SHADOW", startedAt: new Date(at - 60000).toISOString(),
    deliveries: 1, replays: 0, proofs: { proven: 1, blocked: 0 },
    stations: { "60000358": { "17470": 100 } },
    receipts: [{ cargoID: 1, itemID: 900000000001, stationID: 60000358, corporationID: 1000129,
      typeID: 17470, quantity: 100, durable: true, phase: "COMMITTED", proof: "STOCK_PROVEN", at: new Date(at).toISOString() }],
  };
  const stateFile = path.join(dir, "shadow.json");
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
  fs.writeFileSync(path.join(receipts, "1.json"), JSON.stringify({
    cargoID: 1, stationID: 60000358, typeID: 17470, quantity: 100, at,
  }), "utf8");
  if (corrupt) fs.writeFileSync(path.join(receipts, "2.json"), "{ torn", "utf8");
  return { dir, receipts, stateFile };
}

const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch (_e) { /* asserted by the caller */ }
  return { status: result.status, json, stderr: result.stderr };
};

test("audit fails when a receipt file cannot be read", () => {
  const box = fixture({ corrupt: true });
  const out = run(AUDIT, ["--state", box.stateFile, "--receipts", box.receipts]);
  assert.ok(out.json, "audit printed no JSON: " + out.stderr);
  assert.equal(out.json.malformedFiles, 1);
  assert.equal(out.json.ok, false, "a corrupt receipt was excluded from a successful audit");
  assert.equal(out.status, 1);
});

test("audit still passes a clean directory", () => {
  const box = fixture({ corrupt: false });
  const out = run(AUDIT, ["--state", box.stateFile, "--receipts", box.receipts]);
  assert.equal(out.json.ok, true, JSON.stringify(out.json));
  assert.equal(out.json.missed, 0);
});

test("crosscheck fails when a receipt file cannot be read", () => {
  const box = fixture({ corrupt: true });
  const out = run(CROSSCHECK, ["--state", box.stateFile, "--receipts", box.receipts]);
  assert.ok(out.json, "crosscheck printed no JSON: " + out.stderr);
  assert.equal(out.json.mode, "crosscheck");
  assert.equal(out.json.counts.malformed, 1);
  assert.equal(out.json.ok, false, "a corrupt receipt was excluded from a successful crosscheck");
  assert.equal(out.status, 1);
});

test("crosscheck still passes a clean directory", () => {
  const box = fixture({ corrupt: false });
  const out = run(CROSSCHECK, ["--state", box.stateFile, "--receipts", box.receipts]);
  assert.equal(out.json.ok, true, JSON.stringify(out.json));
  assert.equal(out.json.counts.matched, 1);
});
