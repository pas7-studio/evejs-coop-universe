"use strict";
// Session state bundle for cloud agents. There is no CI and no shared disk, so
// git is the only transport: this tool renders a small, redacted, size-capped
// view of local reality (tests, overlay, server events, client logs) that a
// cloud session can read for a few KB instead of guessing.
//
//   node scripts/coop-state.cjs --publish --input <bundle.json>
//   node scripts/coop-state.cjs --verify
//
// Raw logs never enter the repository; only counts, tails and hashes do.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const project = path.resolve(__dirname, "..");
const stateDir = path.join(project, "state");
const budgets = {
  nowLines: 40,
  nowBytes: 4096,
  statusBytes: 4096,
  digestLines: 80,
  digestBytes: 6144,
  changelogLine: 200,
  changelogKeep: 100,
  clientTailLines: 20,
  eventTypes: 15
};

// ---------- redaction ----------
const SENSITIVE_PATTERNS = [
  [/[A-Za-z]:\\Users\\[^\\\s"']+/g, "C:\\Users\\<redacted>"],
  [/[A-Za-z]:\\Documents and Settings\\[^\\\s"']+/g, "C:\\Users\\<redacted>"],
  [/\b(?:(?!127\.0\.0\.1|0\.0\.0\.0|255\.255\.255\.255)\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
  [/\b(?![0-9a-f]{40}\b)[A-Za-z0-9+/=_-]{40,}\b/g, "<token>"],
  [/("(?:characterName|ownerName|corporationName|allianceName|pilotName)"\s*:\s*")[^"]*(")/g, "$1PILOT_A$2"],
  [/\b(?:Bearer|token|password|secret)\s*[:=]\s*\S+/gi, "<secret>"]
];
function redact(value, names = []) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const name of names) {
    if (typeof name === "string" && name.trim().length >= 3) text = text.split(name).join("PILOT_A");
  }
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}
function leaks(text) {
  const found = [];
  if (/[A-Za-z]:\\Users\\(?!<redacted>)/.test(text)) found.push("windows-user-path");
  if (/\b(?:(?!127\.0\.0\.1)\d{1,3}\.){3}\d{1,3}\b/.test(text)) found.push("public-ip");
  if (/\b(?![0-9a-f]{40}\b)[A-Za-z0-9+/=_-]{40,}\b/.test(text)) found.push("long-token");
  if (/(?:Bearer|password|secret)\s*[:=]\s*\S+/i.test(text)) found.push("credential");
  return found;
}

// ---------- summaries ----------
function summarizeEvents(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const types = {};
  let firstAt = null, lastAt = null;
  for (const row of list) {
    const type = row && typeof row.event === "string" ? row.event : "unknown";
    types[type] = (types[type] || 0) + 1;
    const at = row && (row.at || row.timestamp || row.ts || row.createdAt);
    if (typeof at === "string") {
      if (!firstAt || at < firstAt) firstAt = at;
      if (!lastAt || at > lastAt) lastAt = at;
    }
  }
  const ranked = Object.entries(types).sort((a, b) => b[1] - a[1]);
  return {
    rows: list.length,
    firstAt,
    lastAt,
    types: Object.fromEntries(ranked.slice(0, budgets.eventTypes)),
    truncatedTypes: Math.max(0, ranked.length - budgets.eventTypes)
  };
}
const CLIENT_KEYWORDS = /(undock|dock|warp|jump|target|lock|module|damage|destroyed|wreck|loot|cargo|ore|fleet|disconnect|reconnect|error|exception)/i;
function summarizeClientLogs(files, names = []) {
  const list = Array.isArray(files) ? files : [];
  return list.map(file => {
    const lines = Array.isArray(file.lines) ? file.lines : [];
    const interesting = lines
      .filter(line => CLIENT_KEYWORDS.test(line))
      .slice(-budgets.clientTailLines)
      .map(line => redact(line, names).slice(0, 240));
    return {
      name: redact(String(file.name || "unknown"), names),
      bytes: Number(file.bytes) || 0,
      lines: Number(file.lines) || lines.length,
      tail: interesting
    };
  });
}

// ---------- roadmap / ledger ----------
function parseRoadmap(text) {
  const tasks = [];
  const pattern = /^###\s+(COOP-\d+)\s*[—–-]\s*(.+?)\s*\[([^\]]+)\]\s*$/gm;
  let match;
  while ((match = pattern.exec(text))) {
    tasks.push({ id: match[1], title: match[2].trim(), status: match[3].trim() });
  }
  return tasks;
}
function buildLedger(roadmapText) {
  const tasks = parseRoadmap(roadmapText);
  const evidenceDir = path.join(project, "docs", "evidence");
  const evidence = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir) : [];
  return {
    generatedFrom: "docs/ROADMAP.md",
    tasks: tasks.map(task => ({
      ...task,
      evidence: evidence.filter(file => file.startsWith(task.id)).map(file => "docs/evidence/" + file)
    }))
  };
}

// ---------- rendering ----------
function shortSha(sha) { return typeof sha === "string" ? sha.slice(0, 8) : "unknown"; }
function gateLines(gates) {
  const order = ["telemetry", "world", "client", "party", "combat", "market"];
  const out = [];
  for (const key of order) if (gates && gates[key]) out.push(`${key} ${gates[key]}`);
  return out.length ? out : ["not recorded"];
}
function renderNow(state) {
  const lines = [];
  lines.push(`# COOP STATE ${state.updatedAt}`);
  lines.push(`rev ${shortSha(state.projectRev)} | pin ${shortSha(state.upstreamPin)} | overlay ${state.overlay.status}`);
  lines.push("");
  lines.push("## TESTS");
  if (state.tests) {
    lines.push(`${state.tests.totals.files} files / ${state.tests.totals.pass} pass / ${state.tests.totals.fail} fail / ${state.tests.totals.skipped} skip | baseline ${state.tests.status}`);
    for (const item of (state.tests.newFailures || []).slice(0, 5)) lines.push(`REGRESSION ${item.file}`);
  } else {
    lines.push("not run in this publish");
  }
  lines.push("");
  lines.push("## GATES");
  for (const line of gateLines(state.gates)) lines.push(line);
  lines.push("");
  lines.push("## LAST RUN");
  lines.push(`runId ${state.runId} | note ${state.note || "-"}`);
  lines.push(`server events ${state.server.rows}${state.server.types ? " (" + Object.keys(state.server.types).slice(0, 5).join(", ") + ")" : ""} | client log files ${state.client.length}`);
  lines.push("");
  lines.push("## NEXT");
  lines.push(state.next || "not stated");
  lines.push("");
  lines.push("## READ");
  lines.push(`state/digests/${state.runId}.md | state/ledger.json`);
  lines.push("docs/DEVELOPMENT_DOCTRINE.md | docs/GAMEPLAY_TESTING.md");
  return lines.join("\n") + "\n";
}
function renderDigest(state) {
  const lines = [];
  lines.push(`# RUN ${state.runId} — ${state.updatedAt}`);
  lines.push(`note: ${state.note || "-"}`);
  lines.push(`next: ${state.next || "-"}`);
  lines.push("");
  lines.push("## TESTS");
  if (state.tests) {
    lines.push(`status ${state.tests.status} | files ${state.tests.totals.files} pass ${state.tests.totals.pass} fail ${state.tests.totals.fail} skip ${state.tests.totals.skipped}`);
    for (const item of (state.tests.newFailures || []).slice(0, 10)) lines.push(`- ${item.file}: ${(item.newFailures || []).join("; ")}`);
  } else lines.push("not run");
  lines.push("");
  lines.push("## OVERLAY");
  lines.push(`status ${state.overlay.status} | pristine ${state.overlay.counts.pristine || 0} patched ${state.overlay.counts.patched || 0} mismatch ${state.overlay.counts.anchorMismatch || 0} | modules current ${state.overlay.counts.moduleCurrent || 0} stale ${state.overlay.counts.moduleStale || 0} missing ${state.overlay.counts.moduleMissing || 0}`);
  for (const problem of (state.overlay.problems || []).slice(0, 8)) lines.push(`- ${problem.target} ${problem.state}`);
  lines.push("");
  lines.push("## SERVER EVENTS");
  if (state.server.error) lines.push(`unavailable: ${state.server.error}`);
  else {
    lines.push(`rows ${state.server.rows} | ${state.server.firstAt || "?"} -> ${state.server.lastAt || "?"}`);
    for (const [type, count] of Object.entries(state.server.types || {})) lines.push(`- ${type} ${count}`);
    if (state.server.truncatedTypes) lines.push(`- (+${state.server.truncatedTypes} more types)`);
  }
  lines.push("");
  lines.push("## CLIENT LOGS");
  if (!state.client.length) lines.push("none found (no authorized client on this machine)");
  for (const file of state.client) {
    lines.push(`### ${file.name} (${file.bytes} bytes, ${file.lines} lines)`);
    for (const line of file.tail) lines.push("  " + line);
  }
  return lines.join("\n") + "\n";
}

// ---------- publish / verify ----------
function gitRev(dir) {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "UNKNOWN";
}
function gitCountBehind(rev) {
  const result = spawnSync("git", ["-C", project, "rev-list", "--count", `${rev}..HEAD`], { encoding: "utf8" });
  return result.status === 0 ? Number(result.stdout.trim()) || 0 : null;
}
// Committing state/ itself must not make the bundle look stale, so staleness
// means "files outside state/ changed after the publish".
function changedSince(rev) {
  const result = spawnSync("git", ["-C", project, "diff", "--name-only", `${rev}..HEAD`, "--", ".", ":!state"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split("\n").map(line => line.trim()).filter(Boolean);
}
function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}
function readStatus() {
  const file = path.join(stateDir, "status.json");
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return null; }
}
// Keep the repository small: only the newest runs stay committed.
function pruneDigests(keep = 10) {
  const dir = path.join(stateDir, "digests");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(name => name.endsWith(".md")).sort();
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    fs.unlinkSync(path.join(dir, name));
  }
}
function publish(input, options = {}) {
  const names = options.names || [];
  const now = new Date();
  const runId = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const pin = require("./patch-evejs-coop.cjs").PIN;
  const previous = readStatus();
  const state = {
    updatedAt: now.toISOString(),
    runId,
    projectRev: gitRev(project),
    upstreamPin: pin,
    note: redact(input.note || "", names).slice(0, budgets.changelogLine),
    next: redact(input.next || "", names).slice(0, budgets.changelogLine),
    tests: input.tests || (previous && previous.tests) || null,
    overlay: input.overlay || { status: "NOT_CHECKED", counts: {}, problems: [] },
    server: input.server ? { ...summarizeEvents(input.server.rows || []), error: input.server.error || null } : { rows: 0, types: {}, error: "not collected" },
    client: summarizeClientLogs(input.client || [], names),
    gates: { ...((previous && previous.gates) || {}), ...(input.gates || {}) }
  };
  const ledger = buildLedger(fs.existsSync(path.join(project, "docs", "ROADMAP.md")) ? fs.readFileSync(path.join(project, "docs", "ROADMAP.md"), "utf8") : "");
  const nowText = renderNow(state);
  const digestText = renderDigest(state);
  const statusText = JSON.stringify({ ...state, ledgerSummary: summarizeLedger(ledger) }, null, 2) + "\n";

  writeFile(path.join(stateDir, "NOW.md"), nowText);
  writeFile(path.join(stateDir, "status.json"), statusText);
  writeFile(path.join(stateDir, "ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  writeFile(path.join(stateDir, "digests", runId + ".md"), digestText);
  pruneDigests();
  const files = ["NOW.md", "status.json", "ledger.json", `digests/${runId}.md`];
  writeFile(path.join(stateDir, "manifest.json"), JSON.stringify({
    updatedAt: state.updatedAt,
    runId,
    files: files.map(relative => {
      const bytes = fs.readFileSync(path.join(stateDir, relative));
      return { path: "state/" + relative, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    })
  }, null, 2) + "\n");
  const changelogFile = path.join(stateDir, "changelog.jsonl");
  const entry = JSON.stringify({
    at: state.updatedAt,
    runId,
    rev: shortSha(state.projectRev),
    note: state.note,
    next: state.next,
    tests: state.tests ? `${state.tests.totals.pass}p/${state.tests.totals.fail}f` : "-",
    overlay: state.overlay.status
  }).slice(0, budgets.changelogLine * 2);
  const prior = fs.existsSync(changelogFile) ? fs.readFileSync(changelogFile, "utf8").split("\n").filter(Boolean) : [];
  writeFile(changelogFile, prior.concat(entry).slice(-budgets.changelogKeep).join("\n") + "\n");
  return { state, nowText, digestText, files: files.map(file => path.join(stateDir, file)) };
}
function summarizeLedger(ledger) {
  const counts = { total: ledger.tasks.length, done: 0, partial: 0, blocked: 0, todo: 0 };
  for (const task of ledger.tasks) {
    const status = task.status.toUpperCase();
    if (status.startsWith("DONE")) counts.done++;
    else if (status.startsWith("PARTIAL")) counts.partial++;
    else if (status.startsWith("BLOCKED")) counts.blocked++;
    else counts.todo++;
  }
  return counts;
}
function verify() {
  const problems = [];
  const read = file => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const now = read(path.join(stateDir, "NOW.md"));
  if (!now) problems.push("state/NOW.md missing: run scripts/Publish-SessionState.ps1");
  else {
    const lines = now.split("\n").length;
    if (lines > budgets.nowLines) problems.push(`state/NOW.md has ${lines} lines (max ${budgets.nowLines})`);
    if (Buffer.byteLength(now) > budgets.nowBytes) problems.push(`state/NOW.md is ${Buffer.byteLength(now)} bytes (max ${budgets.nowBytes})`);
    for (const leak of leaks(now)) problems.push(`state/NOW.md leaks ${leak}`);
  }
  const statusText = read(path.join(stateDir, "status.json"));
  let status = null;
  if (!statusText) problems.push("state/status.json missing");
  else {
    if (Buffer.byteLength(statusText) > budgets.statusBytes) problems.push(`state/status.json is ${Buffer.byteLength(statusText)} bytes (max ${budgets.statusBytes})`);
    for (const leak of leaks(statusText)) problems.push(`state/status.json leaks ${leak}`);
    try { status = JSON.parse(statusText); } catch (error) { problems.push("state/status.json is not valid JSON"); }
  }
  if (status) {
    const head = gitRev(project);
    const changed = changedSince(status.projectRev);
    if (status.projectRev !== head && changed === null) {
      problems.push(`STATE_STALE: cannot compare ${shortSha(status.projectRev)} with HEAD ${shortSha(head)}`);
    } else if (changed && changed.length) {
      const behind = gitCountBehind(status.projectRev);
      problems.push(`STATE_STALE by ${behind === null ? "unknown" : behind} commits: ${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", ..." : ""} changed after the publish`);
    }
  }
  const roadmap = read(path.join(project, "docs", "ROADMAP.md"));
  const ledgerText = read(path.join(stateDir, "ledger.json"));
  if (!ledgerText) problems.push("state/ledger.json missing");
  else if (roadmap) {
    const expected = parseRoadmap(roadmap).map(task => task.id);
    let ledger = null;
    try { ledger = JSON.parse(ledgerText); } catch (error) { problems.push("state/ledger.json is not valid JSON"); }
    if (ledger) {
      const actual = (ledger.tasks || []).map(task => task.id);
      const missing = expected.filter(id => !actual.includes(id));
      const extra = actual.filter(id => !expected.includes(id));
      if (missing.length) problems.push(`ledger missing roadmap ids: ${missing.join(",")}`);
      if (extra.length) problems.push(`ledger has unknown ids: ${extra.join(",")}`);
      if (new Set(actual).size !== actual.length) problems.push("ledger has duplicate ids");
    }
  }
  const digests = path.join(stateDir, "digests");
  if (fs.existsSync(digests)) {
    for (const name of fs.readdirSync(digests)) {
      const text = read(path.join(digests, name));
      if (text.split("\n").length > budgets.digestLines) problems.push(`state/digests/${name} exceeds ${budgets.digestLines} lines`);
      for (const leak of leaks(text)) problems.push(`state/digests/${name} leaks ${leak}`);
    }
  }
  return { status: problems.length ? "STATE_PROBLEMS" : "STATE_OK", problems };
}

module.exports = {
  budgets, redact, leaks, summarizeEvents, summarizeClientLogs, parseRoadmap,
  buildLedger, summarizeLedger, renderNow, renderDigest, publish, verify, changedSince
};

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--verify")) {
      const result = verify();
      console.log(JSON.stringify(result, null, 2));
      if (result.problems.length) process.exitCode = 1;
    } else if (args.includes("--publish")) {
      const at = args.indexOf("--input");
      if (at < 0 || !args[at + 1]) throw Error("Usage: node coop-state.cjs --publish --input <bundle.json> | --verify");
      const input = JSON.parse(fs.readFileSync(args[at + 1], "utf8"));
      const names = Array.isArray(input.redactNames) ? input.redactNames : [];
      const result = publish(input, { names });
      process.stdout.write(result.nowText);
      console.error("[COOP STATE] wrote " + result.files.length + " files");
    } else {
      throw Error("Usage: node coop-state.cjs --publish --input <bundle.json> | --verify");
    }
  } catch (error) {
    console.error("[COOP STATE ERROR]", error.message);
    process.exitCode = 1;
  }
}
