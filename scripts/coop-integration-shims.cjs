#!/usr/bin/env node
"use strict";
// Repo mirror plugin: integration/*.cjs are the deployed engine modules renamed
// to .cjs, but they call require("./sibling") exactly as the engine's .js tree
// does. Node's CJS resolver never tries a .cjs extension, so every such call
// throws MODULE_NOT_FOUND in the repo unless a .js shim exists next to it. When
// that throw sits inside a `try{...}catch{pause(STATUS)}` the failure is silent:
// the test sees a plausible status instead of the module it meant to exercise.
//
// This tool makes that class of gap visible and cheap to close:
//   node scripts/coop-integration-shims.cjs --check   # list missing shims
//   node scripts/coop-integration-shims.cjs --write   # create the missing ones
// The check is pinned by tests/coop-integration-shims.test.mjs.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "integration");
const HEADER = [
  '"use strict";',
  "// Repo-test shim: integration/*.cjs call require(\"./%NAME%\") without an extension,",
  "// and the overlay installs every module as <name>.js in server/src/space.",
  "module.exports = require(\"./%NAME%.cjs\");",
  "",
].join("\n");

function requested() {
  // name -> the modules that require it without an extension
  const need = new Map();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".cjs"))) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/require\((["'])(\.\/[A-Za-z0-9_]+)\1\)/g)) {
      const name = match[2].slice(2);
      if (!fs.existsSync(path.join(dir, `${name}.cjs`))) continue;
      if (!need.has(name)) need.set(name, new Set());
      need.get(name).add(file.replace(/\.cjs$/, ""));
    }
  }
  return need;
}

function missing() {
  const gap = [];
  for (const [name, users] of requested()) {
    if (!fs.existsSync(path.join(dir, `${name}.js`))) gap.push({name, users: [...users]});
  }
  return gap.sort((a, b) => a.name.localeCompare(b.name));
}

function write() {
  const created = [];
  for (const {name} of missing()) {
    fs.writeFileSync(path.join(dir, `${name}.js`), HEADER.split("%NAME%").join(name));
    created.push(name);
  }
  return created;
}

function correct() {
  // A shim must forward to the same module object, never a divergent copy.
  const wrong = [];
  for (const [name] of requested()) {
    const shim = path.join(dir, `${name}.js`);
    if (!fs.existsSync(shim)) continue;
    if (require(shim) !== require(path.join(dir, `${name}.cjs`))) wrong.push(name);
  }
  return wrong;
}

const arg = process.argv[2];
if (arg === "--write") {
  const created = write();
  console.log(`shims written: ${created.length}`);
  for (const name of created) console.log("  " + name);
} else if (arg === "--check" || arg === undefined) {
  const gap = missing(), wrong = correct();
  if (!gap.length && !wrong.length) console.log("SHIMS_OK");
  else {
    for (const {name, users} of gap) console.log(`MISSING ${name} <- ${users.join(", ")}`);
    for (const name of wrong) console.log(`DIVERGENT ${name}.js`);
    process.exitCode = 1;
  }
} else {
  console.error("usage: node scripts/coop-integration-shims.cjs [--check|--write]");
  process.exitCode = 64;
}

module.exports = {missing, write, correct};
