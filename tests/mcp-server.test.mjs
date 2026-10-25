import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { createServer } = require("../mcp/lib/mcpServer.cjs");
const { createServerTools } = require("../mcp/lib/serverTools.cjs");

const EVENTS = [
  { at: "2026-10-25T10:00:00.000Z", event: "living-native-mining-startup-slot", systemID: 30000145, fleetSlot: 1, miners: 2 },
  { at: "2026-10-25T10:01:00.000Z", event: "living-hauler-loaded", systemID: 30000145, haulerID: 7, cargoQuantity: 120 },
  { at: "2026-10-25T10:02:00.000Z", event: "alife-blocker", systemID: 30000145, module: "station-arrival", status: "WARP_COMMAND_FAILED", haulerID: 7 },
  { at: "2026-10-25T10:02:30.000Z", event: "living-npc-station-warp-requested", systemID: 30000145, haulerID: 7 },
  { at: "2026-10-25T10:03:00.000Z", event: "living-npc-station-delivered", systemID: 30000144, oreQuantity: 400 },
].map((row) => JSON.stringify(row)).join("\n");

function fakeExec(calls, { events = EVENTS } = {}) {
  return (argv) => {
    calls.push(argv.join(" "));
    const line = argv.join(" ");
    if (line.includes("ps -a")) {
      return { ok: true, code: 0, stdout: "evejs-server-1\tUp 5 minutes (healthy)\n", stderr: "" };
    }
    if (line.includes("coop-events.jsonl")) return { ok: true, code: 0, stdout: events, stderr: "" };
    if (line.includes("coop-virtual-world.json")) {
      return {
        ok: true, code: 0, stderr: "",
        stdout: JSON.stringify({ pilots: [
          { id: "p1", systemID: 30000145 },
          { id: "p2", systemID: 30000145 },
        ] }),
      };
    }
    if (line.includes("coop-npc-links.json")) {
      return { ok: true, code: 0, stderr: "", stdout: JSON.stringify({ links: { p1: { entityID: 98, durable: true, role: "pirate" } } }) };
    }
    if (line.includes("coop-economy.json")) {
      return {
        ok: true, code: 0, stderr: "",
        stdout: JSON.stringify({ lastAt: 1, systems: { 30000145: { ore: 10, goods: 0, demand: 5, security: 0, losses: 0 } }, pilots: { p1: { role: "miner", credits: 9, completed: 2, cargo: 0 } } }),
      };
    }
    if (line.includes("gameStore/data")) return { ok: true, code: 0, stdout: "asteroidBelts\nmarketRuntime\n", stderr: "" };
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
}

function build(exec, extra = {}) {
  const calls = [];
  const { tools } = createServerTools({ exec: fakeExec(calls, extra), composeDir: "C:/compose", ...extra });
  return { tools, calls };
}

const call = async (tools, name, args = {}) => {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool, `tool ${name} exists`);
  return tool.handler(args);
};

test("the server MCP exposes the live-world tools and refuses silent mutations", async () => {
  const { tools } = build();
  const names = tools.map((tool) => tool.name);
  for (const expected of ["server_status", "server_logs", "events", "alife_summary", "alife_timeline", "fleet_state", "economy", "world_data", "container_exec", "restart_server"]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  assert.match(await call(tools, "container_exec", { command: "ls", confirm: false }), /refused/);
  assert.match(await call(tools, "restart_server", { confirm: false }), /refused/);
  await assert.rejects(() => call(tools, "world_data", { collection: "../../etc/passwd" }), /unsafe collection/);
});

test("events filters by name, system and recency without inventing records", async () => {
  const { tools } = build();
  const text = await call(tools, "events", { event: "hauler-loaded", limit: 10 });
  assert.match(text, /matched=1/);
  assert.match(text, /living-hauler-loaded/);
  const bySystem = await call(tools, "events", { systemID: 30000144 });
  assert.match(bySystem, /living-npc-station-delivered/);
  assert.doesNotMatch(bySystem, /living-hauler-loaded/);
  const none = await call(tools, "events", { event: "no-such-event" });
  assert.match(none, /matched=0/);
});

test("alife_summary and timeline come from the same telemetry, with named blockers", async () => {
  const { tools } = build();
  const summary = await call(tools, "alife_summary", { top: 5 });
  assert.match(summary, /station-arrival \/ WARP_COMMAND_FAILED/);
  assert.match(summary, /trades=0/);
  const timeline = await call(tools, "alife_timeline", { limit: 10 });
  assert.match(timeline, /cargo-loaded/);
  assert.match(timeline, /warp-to-station/);
  assert.match(timeline, /station-delivered/);
});

test("fleet_state and economy report persisted native state per system", async () => {
  const { tools } = build();
  const fleet = await call(tools, "fleet_state", {});
  assert.match(fleet, /system 30000145: pilots=2/);
  assert.match(fleet, /linked=1 durable=1/);
  assert.match(fleet, /pirate=1/);
  const economy = await call(tools, "economy", { top: 3 });
  assert.match(economy, /30000145: ore=10/);
  assert.match(economy, /miner .*credits=9 completed=2/);
});

test("world_data lists collections and blocks path traversal", async () => {
  const { tools } = build();
  const list = await call(tools, "world_data", {});
  assert.match(list, /asteroidBelts/);
  await assert.rejects(() => call(tools, "world_data", { collection: "../secrets" }), /unsafe/);
});

test("the server MCP speaks stdio JSON-RPC end to end", async () => {
  const child = spawn(process.execPath, [join(root, "mcp", "server-mcp.cjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const frames = [];
  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) frames.push(JSON.parse(line));
      index = buffer.indexOf("\n");
    }
  });
  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no tools/list response")), 15000);
    const check = setInterval(() => {
      if (frames.some((frame) => frame.id === 2)) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });
  child.kill();
  const init = frames.find((frame) => frame.id === 1);
  assert.equal(init.result.serverInfo.name, "evejs-server");
  const list = frames.find((frame) => frame.id === 2);
  assert.ok(list.result.tools.length >= 10);
  assert.ok(list.result.tools.every((tool) => tool.inputSchema && tool.description));
});
