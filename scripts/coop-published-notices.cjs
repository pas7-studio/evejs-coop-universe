#!/usr/bin/env node
// Lists the gateway notice types the deployed server can publish, one per line.
//
// Source scan, so it can under-count a type that is built from a template literal - but a notice
// name built at runtime is rare (they are literal in every service seen so far), and the point of
// this file is the opposite direction: what the CLIENT waits for that nobody publishes.
//
// Usage: node scripts/coop-published-notices.cjs > published.txt
const fs = require("fs");
const path = require("path");

const ENGINE = process.env.EVEJS_ENGINE ||
  "C:/Games/EveCoop/upstream-evejs/Code/server/src";
const DIRS = [
  path.join(ENGINE, "_secondary/express"),
];

const found = new Set();
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const source = fs.readFileSync(full, "utf8");
    for (const match of source.matchAll(/"([a-zA-Z_][a-zA-Z0-9_.]*?Notice)"/g)) {
      if (match[1].startsWith("eve")) found.add(match[1]);
    }
  }
}

for (const dir of DIRS) walk(dir);
process.stdout.write([...found].sort().join("\n") + "\n");
process.stderr.write(`PUBLISHED ${found.size}\n`);
