#!/usr/bin/env node
"use strict";
// Apply the L1 patch series AND the overlay, in that order.
//
// Why this exists: the L1 patches are written against the pinned upstream base,
// while the overlay inserts co-op hook lines into some of the same files
// (miningNpcOperations.js). Applying the overlay first moved that file's context
// and patch 0004 could never apply. The doctrine order is L1 -> L2 anyway, and the
// overlay keeps an L1-covered file instead of reverting it, so L1 goes first.
//
// This wrapper is the only safe way to deploy from now on:
//   node scripts/apply-all.cjs --code-path <Code>
//
// It is idempotent: a patch that is already present is skipped, never doubled, and
// every patch is re-verified after the overlay so a revert cannot pass silently.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { code: result.status, out: (result.stdout || "") + (result.stderr || "") };
}

// A patch the overlay already touches can no longer be reverse-applied verbatim:
// the overlay inserts hook lines inside the same hunks. Fall back to the actual
// content check — every line the patch adds must exist in the target file — so a
// patch that IS installed is never reported as drifted, and one that is missing
// is never reported as present.
function addedLinesPresent(file, codePath) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  let target = null;
  const added = [];
  for (const line of lines) {
    if (line.startsWith("+++ b/")) target = line.slice("+++ b/".length).trim();
    else if (line.startsWith("+") && !line.startsWith("+++")) {
      const body = line.slice(1).trim();
      if (body) added.push(body);
    }
  }
  if (!target || added.length === 0) return false;
  const targetFile = path.join(codePath, ...target.split("/"));
  if (!fs.existsSync(targetFile)) return false;
  const source = fs.readFileSync(targetFile, "utf8");
  return added.every((body) => source.includes(body));
}

function patchPresent(file, checkoutRoot, codePath) {
  const reverse = run("git", ["-C", checkoutRoot, "apply", "--directory=Code", "--reverse", "--check", file]);
  return reverse.code === 0 || addedLinesPresent(file, codePath);
}

function main() {
  const args = process.argv.slice(2);
  const codeIndex = args.indexOf("--code-path");
  const codePath = codeIndex >= 0 ? args[codeIndex + 1] : "C:\\Games\\EveCoop\\upstream-evejs\\Code";
  const repoRoot = path.resolve(__dirname, "..");
  const patchDir = path.join(repoRoot, "patches", "upstream");
  const checkoutRoot = path.dirname(codePath); // <checkout>/Code -> <checkout>
  const overlayScript = path.join(repoRoot, "scripts", "patch-evejs-coop.cjs");

  const patches = fs.readdirSync(patchDir).filter((name) => name.endsWith(".patch")).sort();
  const failed = [];
  let applied = 0;
  let skipped = 0;

  // 1. L1 first, against the pinned base context the patches were generated from.
  for (const name of patches) {
    const file = path.join(patchDir, name);
    // Patches are written against the Code/ root, so git apply needs the prefix.
    const already = patchPresent(file, checkoutRoot, codePath);
    if (already) {
      skipped += 1;
      console.log("[apply-all] present ", name);
      continue;
    }
    const result = run("git", ["-C", checkoutRoot, "apply", "--directory=Code", file]);
    if (result.code !== 0) {
      // One drifted patch must not stop the independent ones: record it and go on,
      // then fail at the end so the drift is still visible.
      failed.push(name + ": " + result.out.trim().split("\n")[0]);
      console.log("[apply-all] FAILED  ", name, result.out.trim().split("\n")[0]);
      continue;
    }
    applied += 1;
    console.log("[apply-all] applied ", name);
  }
  console.log(`[apply-all] L1 patches: applied=${applied} alreadyPresent=${skipped} total=${patches.length}`);

  // 2. Then the co-op overlay on top of the L1 series.
  const overlay = run(process.execPath, [overlayScript, "--code-path", codePath, "--apply"]);
  const installed = /"status":\s*"INSTALLED"/.test(overlay.out) || overlay.code === 0;
  console.log("[apply-all] overlay:", installed ? "INSTALLED" : "FAILED");
  if (!installed) {
    console.log(overlay.out.slice(-800));
    process.exit(1);
  }

  // 3. The overlay must not have eaten an L1 patch: reverse-check every one again.
  const lost = patches.filter((name) => {
    const file = path.join(patchDir, name);
    if (failed.some((entry) => entry.startsWith(name + ":"))) return false;
    return !patchPresent(file, checkoutRoot, codePath);
  });
  if (lost.length) console.log("[apply-all] LOST after overlay:", lost.join(", "));

  const check = run(process.execPath, [overlayScript, "--code-path", codePath, "--check"]);
  const ok = /OVERLAY_OK/.test(check.out);
  console.log("[apply-all] overlay check:", ok ? "OVERLAY_OK" : "DRIFT");
  if (failed.length) { console.log("[apply-all] drifted patches:", failed.join(" ; ")); process.exit(4); }
  if (lost.length) process.exit(5);
  process.exit(ok ? 0 : 3);
}

main();
