#!/usr/bin/env node
"use strict";
// Smoke runner: drive an MCP server over stdio exactly like a client would.
//   node mcp/smoke.cjs server server_status "events --event living-hauler-loaded"
//   node mcp/smoke.cjs client client_status overview_tabs
// Arguments in the form "toolName key=value key2=value2" are passed as arguments.
const { spawn } = require("node:child_process");
const path = require("node:path");

const [target, ...raw] = process.argv.slice(2);
if (!target) {
  console.error("usage: node mcp/smoke.cjs <server|client> <tool[:key=value,...]> ...");
  process.exit(2);
}
const entry = path.join(__dirname, target === "client" ? "client-mcp.cjs" : "server-mcp.cjs");

function parseCall(spec) {
  const [name, rest] = spec.split(/\s+/);
  const args = {};
  if (rest) {
    for (const pair of rest.split(",")) {
      const [key, ...value] = pair.split("=");
      if (!key) continue;
      const joined = value.join("=");
      args[key] = joined === "true" ? true : joined === "false" ? false : /^-?\d+$/.test(joined) ? Number(joined) : joined;
    }
  }
  return { name, args };
}

const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
let buffer = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      const frame = JSON.parse(line);
      const done = pending.get(frame.id);
      if (done) {
        pending.delete(frame.id);
        done(frame);
      }
    }
    index = buffer.indexOf("\n");
  }
});

let id = 0;
const send = (method, params) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

(async () => {
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  for (const spec of raw) {
    const { name, args } = parseCall(spec);
    const frame = await send("tools/call", { name, arguments: args });
    const text = (frame.result?.content || []).map((item) => item.text).join("\n");
    console.log(`\n=== ${name}${frame.result?.isError ? " (error)" : ""} ===\n${text}`);
  }
  child.kill();
})();
