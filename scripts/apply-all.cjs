#!/usr/bin/env node
"use strict";
// Apply the overlay AND the L1 patch series in the right order.
//
// Why this exists: `patch-evejs-coop.cjs --apply` restores the pinned stock files
// before installing the overlay, so every direct L1 edit silently disappears. That
// cost a whole optimisation round: the NPC store fix was live, the next --apply
// reverted it, and the server went back to ~97% of a core while the profile still
// looked fixed.
//
// This wrapper is the only safe way to deploy from now on:
//   node scripts/apply-all.cjs --code-path <Code>
//
// It is idempotent: a patch that is already present is skipped, never doubled.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { code: result.status, out: (result.stdout || "") + (result.stderr || "") };
}

function main() {
  const args = process.argv.slice(2);
  const codeIndex = args.indexOf("--code-path");
  const codePath = codeIndex >= 0 ? args[codeIndex + 1] : "C:\\Games\\EveCoop\\upstream-evejs\\Code";
  const repoRoot = path.resolve(__dirname, "..");
  const patchDir = path.join(repoRoot, "patches", "upstream");

  const overlay = run(process.execPath, [path.join(repoRoot, "scripts", "patch-evejs-coop.cjs"), "--code-path", codePath, "--apply"]);
  const installed = /"status":\s*"INSTALLED"/.test(overlay.out) || overlay.code === 0;
  console.log("[apply-all] overlay:", installed ? "INSTALLED" : "FAILED");
  if (!installed) {
    console.log(overlay.out.slice(-800));
    process.exit(1);
  }

  const checkoutRoot = path.dirname(codePath); // <checkout>/Code -> <checkout>
  const patches = fs.readdirSync(patchDir).filter((name) => name.endsWith(".patch")).sort();
  let applied = 0;
  let skipped = 0;
  for (const name of patches) {
    const file = path.join(patchDir, name);
    // Patches are written against the Code/ root, so git apply needs the prefix.
    const already = run("git", ["-C", checkoutRoot, "apply", "--directory=Code", "--reverse", "--check", file]);
    if (already.code === 0) {
      skipped += 1;
      console.log("[apply-all] present ", name);
      continue;
    }
    const result = run("git", ["-C", checkoutRoot, "apply", "--directory=Code", file]);
    if (result.code !== 0) {
      console.log("[apply-all] FAILED  ", name, result.out.trim().split("\n").slice(0, 3).join(" | "));
      process.exit(2);
    }
    applied += 1;
    console.log("[apply-all] applied ", name);
  }
  console.log(`[apply-all] L1 patches: applied=${applied} alreadyPresent=${skipped} total=${patches.length}`);

  const check = run(process.execPath, [path.join(repoRoot, "scripts", "patch-evejs-coop.cjs"), "--code-path", codePath, "--check"]);
  const ok = /OVERLAY_OK/.test(check.out);
  console.log("[apply-all] overlay check:", ok ? "OVERLAY_OK" : "DRIFT");
  process.exit(ok ? 0 : 3);
}

main();
