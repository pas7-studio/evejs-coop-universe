"use strict";
// Classify the placeholder RemoteSvc handlers: what do they actually return?
//
// The client's views iterate or index these results. A handler that returns `null` where the client
// expects a list can throw inside a tasklet (a broken window), while one that returns an empty list
// just shows nothing. This reads the pinned server source and groups the known placeholders, so
// "unfinished" becomes a list with a reason instead of a feeling.
//
// Usage: node scripts/coop-placeholder-audit.cjs [--fork C:/Games/EveCoop/upstream-evejs]
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const forkIndex = process.argv.indexOf("--fork");
const fork = forkIndex > 0 ? process.argv[forkIndex + 1] : (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs");
const server = path.join(fork, "Code/server/src");

const baseline = JSON.parse(fs.readFileSync(path.join(repo, "docs/client-contracts/baseline.json"), "utf8"));
const stubs = baseline.stubs || [];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(server, []);
const sourceOf = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));

function findHandler(name) {
  const method = `Handle_${name}(`;
  for (const [file, text] of sourceOf) {
    const at = text.indexOf(method);
    if (at < 0) continue;
    // The body ends at the next handler (or 1400 chars), otherwise the final `return` of the next
    // method gets attributed to this one and the verdict is wrong.
    const rest = text.slice(at + method.length);
    const next = rest.indexOf("\n  Handle_");
    const body = next > 0 ? rest.slice(0, next) : rest.slice(0, 1400);
    const returns = [...body.matchAll(/return\s+([^;\n]+)[;]/g)].map((match) => match[1].trim());
    return { file: path.relative(fork, file), returns: returns.slice(0, 4) };
  }
  return null;
}

function classify(returns) {
  if (!returns || returns.length === 0) return "NO_RETURN";
  const last = returns[returns.length - 1];
  if (/^null$/.test(last)) return "NULL";
  if (/buildList\(\s*\[\s*\]\s*\)|\[\s*\]/.test(last)) return "EMPTY_LIST";
  if (/buildDict\(\s*\{\s*\}\s*\)|\{\s*\}/.test(last)) return "EMPTY_DICT";
  if (/^(0|false|"")$/.test(last)) return "SCALAR";
  return "OTHER";
}

const groups = new Map();
for (const stub of stubs) {
  const [service, method] = stub.split(".");
  const handler = findHandler(method);
  const verdict = handler ? classify(handler.returns) : "NO_HANDLER";
  if (!groups.has(verdict)) groups.set(verdict, []);
  groups.get(verdict).push({ stub, file: handler && handler.file, returns: handler && handler.returns });
}

const order = ["NO_HANDLER", "NULL", "OTHER", "SCALAR", "EMPTY_DICT", "EMPTY_LIST", "NO_RETURN"];
for (const verdict of order) {
  const rows = groups.get(verdict);
  if (!rows || rows.length === 0) continue;
  console.log(`${verdict} ${rows.length}`);
  for (const row of rows) {
    console.log(`  ${row.stub}${row.file ? `  <- ${row.file}` : ""}${row.returns && row.returns.length ? `  return ${row.returns[row.returns.length - 1]}` : ""}`);
  }
}
console.log(`TOTAL ${stubs.length}`);
