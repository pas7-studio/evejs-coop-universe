#!/usr/bin/env node
"use strict";
// Acceptance run for the faction-war payout rung.
//
//   node scripts/coop-war-acceptance.cjs [--container evejs-agents-server-1]
//        [--minutes 20] [--json]
//
// The rung that matters is narrow and has never been observed end to end without an
// operator watching: a real native kill, made by a real hull of a funded side, inside a
// live campaign, releasing HELD escrow to that pilot, and crediting exactly those cents to
// the pilot's earned balance. Each step is a separate event, so the tool reports each one
// separately with PASS / PENDING / FAIL and never claims a later step from an earlier one.
//
// It is read-only: it watches the server, it never seeds a hull or moves ISK.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const CONTAINER = option("--container", "evejs-agents-server-1");
const MINUTES = Math.max(1, Number(option("--minutes", "20")) || 20);
const AS_JSON = args.includes("--json");

const CLEAN = { ...process.env };
delete CLEAN.NODE_OPTIONS;
delete CLEAN.VSCODE_INSPECTOR_OPTIONS;
const ex = (argv, opts = {}) => execFileSync(argv[0], argv.slice(1),
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: CLEAN, ...opts });
const sleep = (ms) => execFileSync(process.execPath,
  ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], { env: CLEAN });

function bridge(payload, timeoutMs = 60000) {
  const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const request = JSON.stringify({ id, at: Date.now(), ...payload });
  try {
    ex(["docker", "exec", CONTAINER, "node", "-e",
      `require('fs').appendFileSync('/var/lib/evejs/coop-admin-requests.jsonl', ${JSON.stringify(request + "\n")})`]);
  } catch (_error) { return null; }
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
      } catch (_error) { /* partial line */ }
    }
    sleep(300);
  }
  return null;
}

// Every event this rung needs, read from the server's own log.
function readEvents() {
  try {
    const raw = ex(["docker", "exec", CONTAINER, "node", "-e",
      "try{process.stdout.write(require('fs').readFileSync('/var/lib/evejs/coop-events.jsonl','utf8'))}catch(e){}"]);
    return raw.split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch (_error) { return []; }
    });
  } catch (_error) { return []; }
}

const RUNGS = [
  ["war-opened", (events) => events.filter((e) => e.event === "living-native-war-opened" &&
    (e.campaignIDs || []).length)],
  ["escrow-reserved", (events) => events.filter((e) => e.event === "living-native-war-bounty-reserved" &&
    e.status === "RESERVED")],
  ["assault-begun", (events) => events.filter((e) => e.event === "living-native-war-assault")],
  ["attack-order-accepted", (events) => events.filter((e) => e.event === "living-native-war-attack-orders" &&
    JSON.stringify(e.orders || []).includes("NATIVE_ATTACK_ORDER_ACCEPTED"))],
  ["casualty-recorded", (events) => events.filter((e) => e.event === "living-native-war-casualty" &&
    e.status === "RECORDED")],
  ["attacker-attributed", (events) => events.filter((e) => e.event === "living-native-destruction-attacker" &&
    e.status === "NATIVE_DESTRUCTION_ATTACKER_PROVIDED")],
  ["merit-promoted", (events) => events.filter((e) => e.event === "living-native-war-merit" &&
    e.status === "PROMOTED")],
  ["bounty-paid", (events) => events.filter((e) => e.event === "living-native-war-bounty" &&
    ["PAID", "ALREADY_PAID"].includes(String(e.status)))],
  ["payout-credited", (events) => events.filter((e) => e.event === "living-native-war-bounty" &&
    e.status === "PAID" && Number(e.earnedAfter) > 0)],
];

function snapshot() {
  const events = readEvents();
  const diagnoseResponse = bridge({ action: "war_payout_diagnose" });
  const payout = (diagnoseResponse && (diagnoseResponse.payout || diagnoseResponse.result)) || null;
  const rows = RUNGS.map(([name, pick]) => {
    const hits = pick(events);
    return { rung: name, status: hits.length ? "PASS" : "PENDING", count: hits.length,
      last: hits.length ? { at: hits[hits.length - 1].at,
        detail: describe(name, hits[hits.length - 1]) } : null };
  });
  const paid = rows.find((row) => row.rung === "bounty-paid");
  const credited = rows.find((row) => row.rung === "payout-credited");
  return { rows, payout, verdict: credited.status === "PASS" ? "ACCEPTED"
    : paid.status === "PASS" ? "PAID_NOT_CREDITED" : "NOT_YET" };
}

function describe(name, event) {
  if (name === "bounty-paid") return `pilot=${event.pilotID || ""} cents=${event.amountCents || 0} ` +
    `campaign=${event.campaignID || ""} journal=${event.escrowJournalID || 0}`;
  if (name === "payout-credited") return `pilot=${event.pilotID || ""} ` +
    `earned=${event.earnedBefore || 0}->${event.earnedAfter || 0}`;
  if (name === "attacker-attributed") return `attacker=${event.attackerPilotID || ""} ` +
    `victim=${event.victimPilotID || ""} wreck=${event.wreckID || 0}`;
  if (name === "escrow-reserved") return `faction=${event.factionID || 0} ` +
    `cents=${event.amountCents || 0} campaign=${event.campaignID || ""}`;
  if (name === "war-opened") return `campaigns=${(event.campaignIDs || []).join("|")}`;
  return `at=${event.at || ""}`;
}

const started = Date.now();
const deadline = started + MINUTES * 60 * 1000;
let last = null;
for (;;) {
  last = snapshot();
  if (last.verdict === "ACCEPTED") break;
  if (Date.now() >= deadline) break;
  sleep(30000);
}

if (AS_JSON) {
  console.log(JSON.stringify({ verdict: last.verdict, rungs: last.rows,
    payout: last.payout && { status: last.payout.status, possible: last.payout.payoutPossible,
      blockers: last.payout.blockers } }, null, 2));
} else {
  for (const row of last.rows)
    console.log(`${row.status.padEnd(7)} ${row.rung}${row.last ? ": " + row.last.detail : ""}`);
  if (last.payout) {
    console.log(`\npayout diagnose: ${last.payout.status} possible=${last.payout.payoutPossible}`);
    for (const line of (last.payout.blockers || []).slice(0, 6)) console.log(`  - ${line}`);
  }
  console.log(`\nWAR_PAYOUT_${last.verdict} window=${MINUTES}m`);
}
process.exitCode = last.verdict === "ACCEPTED" ? 0 : 1;
