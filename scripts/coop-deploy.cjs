"use strict";
// One deterministic deploy step for the local co-op world.
//
// The install order is fixed by doctrine: reset every managed stock file to the
// pinned commit, apply the L1 patch series, then install the L2 overlay. Doing it
// by hand is what produced a build with an old hook, a refused overlay and a
// "wait 0" measurement that silently verified nothing: the file still carried the
// previous overlay text, so the installer refused it as drift and the build ran
// anyway.
//
//   node scripts/coop-deploy.cjs --checkout <Code>            # reset + L1 + overlay + verify
//   node scripts/coop-deploy.cjs --checkout <Code> --build    # ... and build + restart
const fs = require("fs");
const path = require("path");
const {execFileSync} = require("child_process");

const ROOT = path.join(__dirname, "..");

function manifestFiles() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "patches", "upstream", "MANIFEST.json"), "utf8"),
  );
  const files = new Set();
  for (const entry of manifest.patches || []) {
    for (const file of entry.files || []) files.add(file);
  }
  return {files, pin: manifest.pin};
}

function overlayFiles() {
  const spec = require(path.join(ROOT, "scripts", "overlay-spec.cjs"));
  const files = new Set();
  for (const block of spec.specs || []) {
    if (Array.isArray(block.patches) && block.patches.length > 0) files.add(block.file);
  }
  return files;
}

// Legacy patch scripts that are not spec blocks also edit stock files. Their targets
// are derived from the scripts themselves, so the reset list can never drift from the
// code that edits those files: an unreset file keeps the previous overlay text, the
// installer refuses it as drift and a deploy stops (measured today on
// sqliteStore.js and marketProxyService.js).
function legacyPatchTargets() {
  const targets = new Set();
  const dir = path.join(ROOT, "scripts");
  for (const name of fs.readdirSync(dir).filter((file) => /-patch\.cjs$/.test(file))) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    for (const match of text.matchAll(/["'](server\/src\/[^"']+\.js)["']/g)) targets.add(match[1]);
  }
  return targets;
}

function managedFiles() {
  const {files} = manifestFiles();
  for (const file of overlayFiles()) files.add(file);
  for (const file of legacyPatchTargets()) files.add(file);
  return [...files].sort();
}

function git(checkout, args) {
  return execFileSync("git", ["-C", checkout, ...args], {encoding: "utf8"});
}

function run(argv) {
  const args = argv.slice(2);
  const index = args.indexOf("--checkout");
  const checkout = index >= 0 ? path.resolve(args[index + 1]) : null;
  if (!checkout) throw new Error("--checkout <path to the EveJS Code directory> is required");
  const report = {reset: [], patches: "", overlay: "", verify: "", build: ""};

  for (const file of managedFiles()) {
    git(checkout, ["checkout", "--", file]);
    report.reset.push(file);
  }

  report.patches = execFileSync(
    "node",
    [path.join(ROOT, "scripts", "apply-upstream-patches.cjs"), "--checkout", checkout, "--check"],
    {encoding: "utf8"},
  );
  report.overlay = execFileSync(
    "node",
    [path.join(ROOT, "scripts", "patch-evejs-coop.cjs"), "--code-path", checkout],
    {encoding: "utf8"},
  );
  report.verify = execFileSync(
    "node",
    [path.join(ROOT, "scripts", "patch-evejs-coop.cjs"), "--check", "--code-path", checkout],
    {encoding: "utf8"},
  );

  const checkOk = /"status":\s*"OVERLAY_OK"/.test(report.verify);
  const patchesOk = /CHECK_OK/.test(report.patches);
  if (!checkOk || !patchesOk) {
    process.stderr.write(
      "[DEPLOY] refused to build: patches=" + (patchesOk ? "CHECK_OK" : "FAILED") +
      " overlay=" + (checkOk ? "OVERLAY_OK" : "NOT_OK") + "\n",
    );
    process.stdout.write(JSON.stringify(report, null, 1) + "\n");
    return 1;
  }

  if (args.includes("--build")) {
    report.build = execFileSync("docker", ["build", "-q", "-t", "evejs-local", "."], {
      cwd: checkout,
      encoding: "utf8",
    });
    execFileSync(
      "docker",
      ["compose", "-p", "evejs", "-f", "compose.yaml", "-f", "compose.coop-probe.yaml", "up", "-d"],
      {cwd: checkout, encoding: "utf8"},
    );
  }

  console.log(
    "[DEPLOY] reset=" + report.reset.length +
    " patches=" + (report.patches.match(/series=\d+/)[0] || "series=?") +
    " overlay=OVERLAY_OK" +
    (report.build ? " build=" + report.build.trim().slice(0, 19) : " build=skipped"),
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv);
  } catch (error) {
    process.stderr.write("[DEPLOY] failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}

module.exports = {managedFiles, manifestFiles, overlayFiles};
