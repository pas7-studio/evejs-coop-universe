"use strict";
// ALIFE-1 evidence reader: answer "what did the NPCs do, and what proves it?"
// from one append-only coop-events.jsonl. Read-only, no gameplay state.
const fs = require("node:fs");

const LIFE = /^(living|alife|virtual)-/;
const PLAYER = /^(coop-party|disconnect|undock|space-arrival)/;

function parse(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, ""))
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function label(row) {
  return (
    row.pilotID ||
    (row.haulerID ? `hauler:${row.haulerID}` : "") ||
    (row.entityID ? `entity:${row.entityID}` : "") ||
    (row.shipID ? `ship:${row.shipID}` : "")
  );
}

function blockerKey(row) {
  return [row.module || "?", row.status || "?", row.reason || ""]
    .filter(Boolean)
    .join(" / ");
}

function summarize(rows, { top = 8, since = "" } = {}) {
  const fresh = since ? rows.filter((row) => String(row.at || "") >= since) : rows;
  const events = new Map();
  const blockers = new Map();
  const actors = new Map();
  const trades = [];
  const deliveries = [];
  let first = "";
  let last = "";
  for (const row of fresh) {
    const name = String(row.event || "?");
    events.set(name, (events.get(name) || 0) + 1);
    if (row.at) {
      if (!first || String(row.at) < first) first = String(row.at);
      if (!last || String(row.at) > last) last = String(row.at);
    }
    if (name === "alife-blocker" || /blocked|repair-required/.test(name)) {
      const key = blockerKey(row);
      const entry = blockers.get(key) || { count: 0, first: row.at, last: row.at };
      entry.count += 1;
      entry.last = row.at || entry.last;
      blockers.set(key, entry);
    }
    const who = label(row);
    if (who) actors.set(who, (actors.get(who) || 0) + 1);
    if (name === "living-native-market-trade") trades.push(row);
    if (name === "living-npc-station-delivered" || name === "living-hauler-delivered") deliveries.push(row);
  }
  const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total: fresh.length,
    first,
    last,
    events: sorted(events).slice(0, top),
    blockers: sorted(new Map([...blockers].map(([key, value]) => [key, value.count])))
      .slice(0, top)
      .map(([key, count]) => ({ key, count, ...blockers.get(key) })),
    actors: sorted(actors).slice(0, top),
    trades,
    deliveries,
    lifeEvents: fresh.filter((row) => LIFE.test(String(row.event || ""))).length,
    playerEvents: fresh.filter((row) => PLAYER.test(String(row.event || ""))).length,
  };
}

function report(summary, { title = "ALIFE audit" } = {}) {
  const lines = [];
  lines.push(`${title}: ${summary.total} events (${summary.first || "?"} .. ${summary.last || "?"})`);
  lines.push(`life=${summary.lifeEvents} player=${summary.playerEvents} trades=${summary.trades.length} deliveries=${summary.deliveries.length}`);
  lines.push("");
  lines.push("events");
  for (const [name, count] of summary.events) lines.push(`  ${String(count).padStart(5)}  ${name}`);
  lines.push("");
  lines.push("blockers (module / status / reason)");
  if (!summary.blockers.length) lines.push("  none");
  for (const blocker of summary.blockers) {
    lines.push(`  ${String(blocker.count).padStart(5)}  ${blocker.key}`);
    lines.push(`         first=${blocker.first || "?"} last=${blocker.last || "?"}`);
  }
  lines.push("");
  lines.push("top actors");
  if (!summary.actors.length) lines.push("  none");
  for (const [who, count] of summary.actors) lines.push(`  ${String(count).padStart(5)}  ${who}`);
  for (const trade of summary.trades) {
    lines.push(`TRADE ${JSON.stringify(trade).slice(0, 240)}`);
  }
  for (const delivery of summary.deliveries) {
    lines.push(`DELIVERY ${JSON.stringify(delivery).slice(0, 240)}`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error("usage: node scripts/alife-audit.cjs <coop-events.jsonl> [--since ISO] [--top N]");
    process.exit(2);
  }
  const sinceFlag = process.argv.indexOf("--since");
  const topFlag = process.argv.indexOf("--top");
  const since = sinceFlag > 0 ? String(process.argv[sinceFlag + 1] || "") : "";
  const top = topFlag > 0 ? Math.max(1, Number(process.argv[topFlag + 1]) || 8) : 8;
  const rows = parse(fs.readFileSync(file, "utf8"));
  console.log(report(summarize(rows, { since, top })));
}

module.exports = { parse, summarize, report, blockerKey };
