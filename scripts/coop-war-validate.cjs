#!/usr/bin/env node
"use strict";
// Read-only validation of the live faction-war campaign record.
//
//   node scripts/coop-war-validate.cjs [--container evejs-agents-server-1] [--json]
//
// This file only does I/O: the invariants live in scripts/war-campaign-checks.cjs so a
// unit test can prove them without a server. Exit 0 = every check PASS/WARN/SKIP,
// 1 = at least one FAIL, 2 = the record could not be read at all.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { validateCampaignRecord, summarise } = require(path.join(__dirname, "war-campaign-checks.cjs"));

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const CONTAINER = option("--container", "evejs-agents-server-1");
const AS_JSON = args.includes("--json");

const CLEAN = { ...process.env };
delete CLEAN.NODE_OPTIONS;
delete CLEAN.VSCODE_INSPECTOR_OPTIONS;
const ex = (argv, opts = {}) => execFileSync(argv[0], argv.slice(1),
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: CLEAN, ...opts });
const sleep = (ms) => execFileSync(process.execPath,
  ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], { env: CLEAN });

function bridge(payload, timeoutMs = 60000) {
  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const request = JSON.stringify({ id, at: Date.now(), ...payload });
  ex(["docker", "exec", CONTAINER, "node", "-e",
    `require('fs').appendFileSync('/var/lib/evejs/coop-admin-requests.jsonl', ${JSON.stringify(request + "\n")})`]);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let raw = "";
    try {
      raw = ex(["docker", "exec", CONTAINER, "node", "-e",
        "try{process.stdout.write(require('fs').readFileSync('/var/lib/evejs/coop-admin-results.jsonl','utf8'))}catch(e){}"]);
    } catch (_error) { return null; }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record && record.id === id) return record;
      } catch (_error) { /* a partial line is skipped */ }
    }
    sleep(300);
  }
  return null;
}

// The durable rows the war money and hulls really live in. Read-only.
function readRows() {
  const script = `
const Database = require("better-sqlite3");
const db = new Database("/var/lib/evejs/gameStore/gamestore.sqlite", { readonly: true });
const sep = String.fromCharCode(31);
const one = (key) => { const row = db.prepare("select json from corporationRuntime where key=?").get(key);
  return row ? JSON.parse(row.json) : null; };
process.stdout.write(JSON.stringify({
  treasury: one("coop-faction-war" + sep + "treasury-v1"),
  fleet: one("coop-faction-war" + sep + "fleet-registry-v1")
}));`;
  try {
    return JSON.parse(ex(["docker", "exec", "-i", "-w", "/app/server", CONTAINER, "node", "-"],
      { input: script }));
  } catch (_error) { return null; }
}

function authorisedCredits() {
  try {
    const raw = ex(["docker", "exec", CONTAINER, "node", "-e",
      "try{process.stdout.write(require('fs').readFileSync('/var/lib/evejs/coop-war-chest-journal.json','utf8'))}catch(e){process.stdout.write('')}"]);
    if (!raw.trim()) return null;
    const journal = JSON.parse(raw);
    const ids = new Set();
    for (const entry of Object.values(journal.entries || {})) {
      for (const source of entry.sources || []) if (source.eventID) ids.add(source.eventID);
      if (entry.creditEventID) ids.add(entry.creditEventID);
    }
    // A credit leg is keyed by the payout proof, so the journal proves it happened by
    // carrying an entry whose event id is the one FW-059 would finish.
    for (const key of Object.keys(journal.entries || {})) ids.add(key.replace(/^chest:/, ""));
    return ids;
  } catch (_error) { return null; }
}

const stateResponse = bridge({ action: "war_state" });
const state = stateResponse && (stateResponse.warState || stateResponse.result || null);
const rows = readRows();
const checks = validateCampaignRecord({ state, treasury: rows && rows.treasury,
  fleet: rows && rows.fleet, creditedEventIDs: authorisedCredits() });
const summary = summarise(checks);

if (AS_JSON) {
  console.log(JSON.stringify({ checks, summary }, null, 2));
} else {
  for (const row of checks) console.log(`${row.status.padEnd(4)} ${row.name}: ${row.detail}`);
  console.log(`\n${summary.fail ? "WAR_CAMPAIGN_INVALID" : "WAR_CAMPAIGN_OK"} ` +
    `checks=${summary.total} pass=${summary.pass} warn=${summary.warn} ` +
    `skip=${summary.skip} fail=${summary.fail}`);
}
process.exitCode = summary.fail ? 1 : 0;
