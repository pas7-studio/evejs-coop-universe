"use strict";
// Admin bridge: lets the local MCP server run one native chat/GM command inside
// the *server process*, where the live session and space runtime actually live.
//
// Why it exists: a tool that shells into the container is a separate Node
// process with its own empty session registry, so it cannot see the player. The
// only honest way to act on a live player is from inside the server, so the
// tool drops a request file on the data volume and this module executes it.
//
// Scope: one whitelisted action (`chat_command`), loopback-local file, and the
// exact session of the requested character. Nothing else is accepted.
const fs = require("node:fs");

const REQUESTS = process.env.EVEJS_COOP_ADMIN_REQUESTS || "/var/lib/evejs/coop-admin-requests.jsonl";
const RESULTS = process.env.EVEJS_COOP_ADMIN_RESULTS || "/var/lib/evejs/coop-admin-results.jsonl";
const ALLOWED_ACTIONS = new Set(["chat_command"]);
const MAX_REQUESTS_PER_DRAIN = 8;

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function writeJsonLines(file, lines) {
  try {
    fs.writeFileSync(file, lines.length ? lines.join("\n") + "\n" : "");
  } catch (_error) {
    /* a lost result is reported as a timeout by the caller */
  }
}

function appendJsonLine(file, value) {
  try {
    fs.appendFileSync(file, JSON.stringify(value) + "\n");
  } catch (_error) {
    /* nothing to do: the caller will time out */
  }
}

function executeRequest(request) {
  if (!request || typeof request !== "object") return { ok: false, error: "empty request" };
  const action = String(request.action || "");
  if (!ALLOWED_ACTIONS.has(action)) return { ok: false, error: "action not allowed: " + action };
  const characterID = Number(request.characterID) || 0;
  if (!(characterID > 0)) return { ok: false, error: "characterID is required" };

  let session = null;
  try {
    const registry = require("../services/chat/sessionRegistry");
    session = typeof registry.findSessionByCharacterID === "function"
      ? registry.findSessionByCharacterID(characterID)
      : null;
  } catch (error) {
    return { ok: false, error: "session registry unavailable: " + String(error && error.message || error) };
  }
  if (!session) return { ok: false, error: "no live session for " + characterID + " (is the client logged in?)" };

  const command = String(request.command || "").trim();
  if (!command) return { ok: false, error: "command is required" };

  try {
    const chat = require("../services/chat/chatCommands");
    if (typeof chat.executeChatCommand !== "function") return { ok: false, error: "executeChatCommand is missing" };
    const result = chat.executeChatCommand(session, command, null, {});
    return {
      ok: true,
      handled: Boolean(result && result.handled),
      message: String(result && result.message || ""),
      characterID,
      command,
    };
  } catch (error) {
    return { ok: false, error: "command failed: " + String(error && error.message || error) };
  }
}

// Executes pending requests once. Called from the world tick; cheap when empty.
function drain(options) {
  const opts = options || {};
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const pending = readJsonLines(REQUESTS);
  if (!pending.length) return 0;

  const keep = [];
  let executed = 0;
  for (let index = 0; index < pending.length; index += 1) {
    if (executed >= MAX_REQUESTS_PER_DRAIN) {
      keep.push(pending[index]);
      continue;
    }
    let request = null;
    try {
      request = JSON.parse(pending[index]);
    } catch (_error) {
      appendJsonLine(RESULTS, { id: "unparseable", ok: false, error: "request is not JSON" });
      continue;
    }
    const result = executeRequest(request);
    appendJsonLine(RESULTS, Object.assign({ id: request.id || "", at: new Date().toISOString() }, result));
    log(`[CoopAdminBridge] ${request.action} for ${request.characterID}: ${result.ok ? "ok" : "refused"} ${result.error || ""}`.trim());
    executed += 1;
  }
  writeJsonLines(REQUESTS, keep);
  return executed;
}

module.exports = { drain, executeRequest, REQUESTS, RESULTS, ALLOWED_ACTIONS };
