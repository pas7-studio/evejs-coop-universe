"use strict";
// Applies the ATOMIC upstream patch series kept in this repository.
//
// Layers (see docs/UPSTREAM_PATCH_SERIES.md):
//   L1 patches/upstream/*.patch  -> real stock EveJS bugs, applied with git
//   L2 integration/*             -> our gameplay overlay, installed separately
//
// The series is versioned HERE, so this repository always owns the exact set
// of native changes even when upstream never merges them. A private branch in
// the checkout can record the series as ordinary commits.
//
// Usage:
//   node scripts/apply-upstream-patches.cjs --checkout <Code dir> [--check]
//   node scripts/apply-upstream-patches.cjs --checkout <Code dir> --apply
//   node scripts/apply-upstream-patches.cjs --checkout <Code dir> --reverse
//   node scripts/apply-upstream-patches.cjs --checkout <Code dir> --apply \
//        --branch coop/pas7std --commit
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SERIES = path.join(ROOT, "patches", "upstream");
const MANIFEST = path.join(SERIES, "MANIFEST.json");

function die(message) {
  console.error("[PATCHES] " + message);
  process.exit(2);
}
function git(checkout, args, options = {}) {
  return execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  }).trim();
}
function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
function parseArgs(argv) {
  const args = { check: false, apply: false, reverse: false, commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--checkout") args.checkout = argv[++i];
    else if (token === "--branch") args.branch = argv[++i];
    else if (token === "--apply") args.apply = true;
    else if (token === "--reverse") args.reverse = true;
    else if (token === "--check") args.check = true;
    else if (token === "--commit") args.commit = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else die("Unknown argument: " + token);
  }
  if (!args.apply && !args.reverse) args.check = true;
  return args;
}

function loadSeries() {
  if (!fs.existsSync(MANIFEST)) die("MANIFEST.json is missing in patches/upstream");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (!manifest.pin || !Array.isArray(manifest.patches)) die("MANIFEST.json is incomplete");
  const entries = manifest.patches.map((entry) => {
    const file = path.join(SERIES, entry.file);
    if (!fs.existsSync(file)) die("Missing patch file: " + entry.file);
    const buffer = fs.readFileSync(file);
    const digest = sha256(buffer);
    if (digest !== entry.sha256) {
      die("Patch " + entry.file + " does not match MANIFEST.json (edited without updating the manifest)");
    }
    const subject = /^Subject: \[PATCH [^\]]+\] (.+)$/m.exec(buffer.toString("utf8"));
    return { ...entry, path: file, subject: subject ? subject[1] : entry.file, buffer };
  });
  return { manifest, entries };
}

function ensurePin(checkout, manifest) {
  const head = git(checkout, ["rev-parse", "HEAD"]);
  if (head !== manifest.pin) {
    die("Checkout HEAD " + head.slice(0, 12) + " is not the pinned base " + manifest.pin.slice(0, 12));
  }
}

function ensureBranch(checkout, branch, manifest) {
  if (!branch) return;
  const current = git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current === branch) return;
  const exists = git(checkout, ["branch", "--list", branch]);
  if (exists) git(checkout, ["checkout", branch]);
  else git(checkout, ["checkout", "-b", branch, manifest.pin]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("See the header of scripts/apply-upstream-patches.cjs");
    return;
  }
  if (!args.checkout) die("--checkout <path to the EveJS Code directory> is required");
  const checkout = path.resolve(args.checkout);
  if (!fs.existsSync(path.join(checkout, "server"))) die("Not an EveJS checkout: " + checkout);
  const { manifest, entries } = loadSeries();
  ensurePin(checkout, manifest);
  if (args.apply || args.commit) ensureBranch(checkout, args.branch, manifest);

  const order = args.reverse ? entries.slice().reverse() : entries;
  const applied = [];
  for (const entry of order) {
    const flags = args.reverse ? ["--reverse"] : [];
    try {
      git(checkout, ["apply", "--check", ...flags, entry.path]);
    } catch (error) {
      die(
        (args.reverse ? "Cannot reverse " : "Cannot apply ") +
          entry.file +
          "\n" +
          String(error.stderr || error.message).trim(),
      );
    }
    if (!args.apply && !args.reverse) {
      console.log("[PATCHES] OK      " + entry.file);
      continue;
    }
    git(checkout, ["apply", ...flags, entry.path]);
    applied.push(entry);
    console.log("[PATCHES] " + (args.reverse ? "REVERSED " : "APPLIED  ") + entry.file);
    if (args.commit && !args.reverse) {
      const touched = entry.files.map((file) => path.join(checkout, file));
      git(checkout, ["add", "--", ...touched]);
      git(checkout, ["commit", "-m", entry.subject + "\n\nUpstream base: " + manifest.pin]);
      console.log("[PATCHES] COMMITTED " + entry.subject);
    }
  }
  const tail = args.reverse ? applied.length + " reversed" : applied.length + " applied";
  console.log(
    "[PATCHES] " +
      (args.check ? "CHECK_OK " : "DONE ") +
      "series=" +
      entries.length +
      " (" +
      tail +
      ") pin=" +
      manifest.pin.slice(0, 12),
  );
}

main();
