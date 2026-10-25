#!/usr/bin/env node
"use strict";
// MCP entry point: EVE client side (process, gamelog, chat log, settings).
// The client UI is not automated; this observes what the client itself wrote.
const { createServer } = require("./lib/mcpServer.cjs");
const { createClientTools } = require("./lib/clientTools.cjs");

const { tools } = createClientTools({});

const server = createServer({
  name: "evejs-client",
  version: "1.0.0",
  instructions: [
    "Read the local EVE client: process state, gamelog, chat logs, overview labels.",
    "Importing an overview profile stays a human click in the client UI.",
    "overview_rename_tab edits a copy of the settings file only at identical byte length, with a backup, and refuses while the client runs.",
    "client_launch requires confirm: true and never restarts an already running client.",
  ].join(" "),
  tools,
});

server.serve(process.stdin, process.stdout);
process.stderr.write(`[evejs-client-mcp] ${tools.length} tools ready\n`);
