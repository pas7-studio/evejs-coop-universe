#!/usr/bin/env node
"use strict";
// MCP entry point: EveJS server side (containers, telemetry, fleet, game store).
// stdout carries protocol frames only; diagnostics go to stderr.
const { createServer } = require("./lib/mcpServer.cjs");
const { createServerTools } = require("./lib/serverTools.cjs");

const { tools } = createServerTools({
  composeDir: process.env.EVEJS_COMPOSE_DIR || "",
});

const server = createServer({
  name: "evejs-server",
  version: "1.0.0",
  instructions: [
    "Live view of the local EveJS co-op server.",
    "Read-only by default: status, logs, events, alife_summary, alife_timeline, fleet_state, economy, world_data.",
    "Mutating tools (container_exec, restart_server) refuse unless confirm: true; only ever target the co-op project.",
    "Never kill processes or containers you did not start: report instead.",
  ].join(" "),
  tools,
});

server.serve(process.stdin, process.stdout);
process.stderr.write(`[evejs-server-mcp] ${tools.length} tools ready\n`);
