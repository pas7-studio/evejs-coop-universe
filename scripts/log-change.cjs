"use strict";
// Append one traceable entry to docs/WORKLOG.md for a real commit.
//
// Rule (AGENTS.md): every change we make gets an entry — what, where, why,
// when and which commit. The entry is generated from git, never hand-typed,
// so the hash, files and UTC time cannot drift from reality.
//
// Usage:
//   node scripts/log-change.cjs --layer L2 --why "..." --evidence "..." [--sha <rev>] [--dry-run]
//   node scripts/log-change.cjs --check          # format + duplicate audit
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const WORKLOG = path.join(ROOT, "docs", "WORKLOG.md");
const LAYERS = new Set(["L1", "L2", "L3", "DOCS", "TEST", "OPS"]);

function die(message) {
  console.error("[WORKLOG] " + message);
  process.exit(2);
}
function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}
function parseArgs(argv) {
  const args = { dryRun: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--layer") args.layer = argv[++i];
    else if (token === "--why") args.why = argv[++i];
    else if (token === "--evidence") args.evidence = argv[++i];
    else if (token === "--sha") args.sha = argv[++i];
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--check") args.check = true;
    else die("Unknown argument: " + token);
  }
  return args;
}
function readWorklog() {
  return fs.existsSync(WORKLOG) ? fs.readFileSync(WORKLOG, "utf8") : "";
}
const ENTRY = /^### (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) · ([0-9a-f]{7,40}) · (L1|L2|L3|DOCS|TEST|OPS) · (.+)$/gm;
function entries(text) {
  const found = [];
  let match;
  ENTRY.lastIndex = 0;
  while ((match = ENTRY.exec(text)) !== null) {
    found.push({ at: match[1], sha: match[2], layer: match[3], title: match[4] });
  }
  return found;
}
function audit(text) {
  const seen = new Set();
  for (const entry of entries(text)) {
    const key = entry.sha.slice(0, 7);
    if (seen.has(key)) return "DUPLICATE_SHA:" + key;
    seen.add(key);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(entry.at)) return "BAD_TIMESTAMP:" + key;
    if (!LAYERS.has(entry.layer)) return "BAD_LAYER:" + key;
  }
  return "OK entries=" + seen.size;
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = readWorklog();
  if (args.check) {
    const result = audit(text);
    console.log("[WORKLOG] " + result);
    if (result !== "OK" && !result.startsWith("OK ")) process.exit(1);
    return;
  }
  if (!args.layer || !LAYERS.has(args.layer)) die("--layer must be one of " + [...LAYERS].join(","));
  if (!args.why) die("--why is required: a change without a reason is not traceable");
  const sha = git(["rev-parse", args.sha || "HEAD"]);
  const short = sha.slice(0, 7);
  if (text.includes("· " + short + " ·")) die("Commit " + short + " is already logged");
  const at = new Date(git(["show", "-s", "--format=%cI", sha])).toISOString().replace(/\.\d{3}Z$/, "Z").slice(0, 16) + "Z";
  const subject = git(["show", "-s", "--format=%s", sha]);
  const files = git(["show", "--name-only", "--format=", sha]).split("\n").filter(Boolean);
  const body = git(["show", "-s", "--format=%b", sha]);
  const dirty = git(["status", "--porcelain"]);
  if (dirty) die("Worktree is dirty: commit first, then log, so the entry matches the commit");
  const entry = [
    "### " + at + " · " + short + " · " + args.layer + " · " + subject,
    "",
    "Why: " + args.why,
    body ? "Detail: " + body.replace(/\s+/g, " ").slice(0, 400) : null,
    "Where: " + files.join(", ").slice(0, 900),
    "Evidence: " + (args.evidence || "NOT_RECORDED"),
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
  if (args.dryRun) {
    console.log(entry);
    return;
  }
  fs.appendFileSync(WORKLOG, (text.endsWith("\n") || text === "" ? "" : "\n") + entry);
  console.log("[WORKLOG] APPENDED " + short);
}
main();
