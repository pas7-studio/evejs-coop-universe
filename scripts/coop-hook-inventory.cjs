"use strict";
// Inventory of every mechanism that edits the pinned EveJS checkout.
//
// The deploy path currently has three of them: L1 patches, the declarative
// overlay spec, and a pile of hand-written coop-*-patch.cjs transformers that
// scripts/patch-evejs-coop.cjs wires in one by one. The last group edits stock
// files with bespoke string surgery, so a file touched only by them is invisible
// to `--check` and to review. This tool makes the pile countable and refuses to
// let it grow: the recorded baseline may only go down.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");
const BASELINE = path.join(ROOT, "docs", "coop-hook-inventory.json");
const ORCHESTRATOR = path.join(SCRIPTS, "patch-evejs-coop.cjs");
const SPEC = path.join(SCRIPTS, "overlay-spec.cjs");

function legacyFiles() {
  return fs
    .readdirSync(SCRIPTS)
    .filter((name) => /^coop-.*-patch\.cjs$/.test(name))
    .sort();
}

function wiredModules() {
  const text = fs.readFileSync(ORCHESTRATOR, "utf8");
  const found = new Set();
  for (const match of text.matchAll(/require\("\.\/(coop-[^"]+-patch\.cjs)"\)/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

function specTargets() {
  const spec = require(SPEC);
  const files = new Map();
  for (const block of spec.specs || []) {
    const entries = Array.isArray(block.patches) ? block.patches.length : 0;
    if (entries > 0) files.set(block.file, entries);
  }
  return files;
}

function legacyTargets(file) {
  const text = fs.readFileSync(path.join(SCRIPTS, file), "utf8");
  const targets = new Set();
  for (const match of text.matchAll(/"(server\/src\/[^"]+)"/g)) {
    targets.add(match[1]);
  }
  return [...targets];
}

function inventory() {
  const legacy = legacyFiles();
  const wired = wiredModules();
  const spec = specTargets();
  const overlap = [];
  for (const file of legacy) {
    const shared = legacyTargets(file).filter((target) => spec.has(target));
    if (shared.length > 0) overlap.push({ file, shared: shared.sort() });
  }
  return {
    legacyFiles: legacy.length,
    wiredModules: wired.length,
    specFiles: spec.size,
    specEntries: [...spec.values()].reduce((sum, value) => sum + value, 0),
    overlap: overlap.length,
    overlaps: overlap,
  };
}

function main(argv) {
  const args = argv.slice(2);
  const current = inventory();
  const line =
    "HOOKS legacy=" + current.legacyFiles +
    " wired=" + current.wiredModules +
    " specFiles=" + current.specFiles +
    " specEntries=" + current.specEntries +
    " overlap=" + current.overlap;
  if (args.includes("--baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify({ version: 1, ...current }, null, 1) + "\n");
    console.log("HOOKS_BASELINE_WRITTEN " + line);
    return 0;
  }
  console.log(line);
  for (const entry of current.overlaps.slice(0, 10)) {
    console.log("  overlap", entry.file, entry.shared.join(","));
  }
  if (!args.includes("--check")) return 0;
  if (!fs.existsSync(BASELINE)) {
    console.log("HOOKS_NO_BASELINE run with --baseline");
    return 1;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  let failed = false;
  if (current.legacyFiles > baseline.legacyFiles) {
    console.log("HOOKS_GREW legacy " + baseline.legacyFiles + " -> " + current.legacyFiles);
    failed = true;
  }
  if (current.wiredModules > baseline.wiredModules) {
    console.log("HOOKS_GREW wired " + baseline.wiredModules + " -> " + current.wiredModules);
    failed = true;
  }
  if (!failed) {
    console.log(
      "HOOKS_OK legacy " + current.legacyFiles + "/" + baseline.legacyFiles +
      " wired " + current.wiredModules + "/" + baseline.wiredModules +
      " spec " + current.specEntries,
    );
  }
  return failed ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv);
module.exports = { inventory };
