"use strict";
// Admin bridge: lets the local MCP server act on a *live or offline* character
// from inside the server process, where the real session and space runtime live.
//
// Why it exists: a tool that shells into the container is a separate Node
// process with its own empty session registry, so it cannot see the player. The
// only honest way to act on a player is from inside the server, so the tool
// drops a request file on the data volume and this module executes it.
//
// Actions are whitelisted and each one uses native primitives:
//   chat_command  - one slash/GM command as the character's live session
//   give_item     - grant an item (a ship hull included) to the station hangar,
//                   works without a session: the data layer is authoritative
//   remove_item   - delete an item the character really owns (never the active hull)
//   board_ship    - make an owned ship the active hull, works without a session
//
// Every action emits a coop-events.jsonl line with an explicit status, so a
// runtime decision is never only in a chat log.
const fs = require("node:fs");

const REQUESTS = process.env.EVEJS_COOP_ADMIN_REQUESTS || "/var/lib/evejs/coop-admin-requests.jsonl";
const RESULTS = process.env.EVEJS_COOP_ADMIN_RESULTS || "/var/lib/evejs/coop-admin-results.jsonl";
const EVENTS = process.env.EVEJS_COOP_EVENTS_FILE || "/var/lib/evejs/coop-events.jsonl";
const ALLOWED_ACTIONS = new Set(["chat_command", "give_item", "remove_item", "board_ship"]);
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

function emitEvent(event, status, detail) {
  appendJsonLine(EVENTS, Object.assign(
    { at: new Date().toISOString(), event, status },
    detail || {},
  ));
}

function readRow(table, key) {
  try {
    const store = require("../gameStore");
    let row = store.read(table, String(key));
    if (row && typeof row === "object" && !Array.isArray(row) && "success" in row) {
      if (row.success !== true) return null;
      row = row.data;
    }
    if (typeof row === "string") row = JSON.parse(row);
    return row && typeof row === "object" ? row : null;
  } catch (_error) {
    return null;
  }
}

function liveSessionFor(characterID) {
  try {
    const registry = require("../services/chat/sessionRegistry");
    return typeof registry.findSessionByCharacterID === "function"
      ? registry.findSessionByCharacterID(characterID)
      : null;
  } catch (_error) {
    return null;
  }
}

function executeChatCommand(request) {
  const characterID = Number(request.characterID) || 0;
  const command = String(request.command || "").trim();
  if (!command) return { ok: false, error: "command is required" };
  const session = liveSessionFor(characterID);
  if (!session) return { ok: false, error: "no live session for " + characterID + " (is the client logged in?)" };
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

// Grants an item (ship hull included) to the character's station hangar. This is
// the same primitive /giveitem uses, minus the session requirement, so it works
// while the character is offline.
function giveItem(request) {
  const characterID = Number(request.characterID) || 0;
  const typeID = Number(request.typeID) || 0;
  const quantity = Math.max(1, Number(request.quantity) || 1);
  if (!(typeID > 0)) return { ok: false, error: "typeID is required" };
  const character = readRow("characters", characterID);
  if (!character) return { ok: false, error: "character " + characterID + " not found" };
  const stationID = Number(request.stationID) || Number(character.stationID) || 0;
  if (!(stationID > 0)) {
    return { ok: false, error: "character " + characterID + " is not docked; pass stationID explicitly" };
  }
  try {
    const characterState = require("../services/character/characterState");
    const registry = require("../services/inventory/itemTypeRegistry");
    const resolved = typeof registry.resolveItemByTypeID === "function"
      ? registry.resolveItemByTypeID(typeID)
      : null;
    if (!resolved) return { ok: false, error: "unknown typeID " + typeID };
    const granted = characterState.grantItemToCharacterStationHangar(characterID, stationID, resolved, quantity);
    if (!granted || granted.success === false) {
      return { ok: false, error: String(granted && granted.errorMsg || "grant refused") };
    }
    const items = (granted.data && granted.data.items) || (granted.data && granted.data.changes) || [];
    const first = Array.isArray(items) && items.length
      ? (items[0].item || items[0])
      : null;
    // A live client should see it immediately instead of waiting for a relog.
    const session = liveSessionFor(characterID);
    let notified = false;
    if (session && first) {
      try {
        const changes = (granted.data && granted.data.changes) || [];
        if (typeof characterState.emitItemsChangedBatchForSession === "function" && changes.length) {
          characterState.emitItemsChangedBatchForSession(session, changes, { locationContext: null });
          notified = true;
        }
      } catch (_error) {
        notified = false;
      }
    }
    return {
      ok: true,
      characterID,
      stationID,
      typeID,
      quantity,
      itemID: first ? Number(first.itemID) || 0 : 0,
      name: first ? String(first.itemName || first.shipName || "") : "",
      online: Boolean(session),
      notified,
    };
  } catch (error) {
    return { ok: false, error: "grant failed: " + String(error && error.message || error) };
  }
}

// Deletes an item the character really owns. Refuses the active hull: deleting
// the ship a player is sitting in would break their session.
function removeItem(request) {
  const characterID = Number(request.characterID) || 0;
  const itemID = Number(request.itemID) || 0;
  if (!(itemID > 0)) return { ok: false, error: "itemID is required" };
  const store = require("../gameStore");
  const item = readRow("items", itemID);
  if (!item) return { ok: false, error: "item " + itemID + " does not exist" };
  if (Number(item.ownerID) !== characterID) {
    return { ok: false, error: "item " + itemID + " is not owned by " + characterID };
  }
  const character = readRow("characters", characterID);
  if (character && Number(character.shipID) === itemID) {
    return { ok: false, error: "item " + itemID + " is the active hull; board another ship first" };
  }
  if (typeof store.remove !== "function") return { ok: false, error: "gameStore has no remove()" };
  store.remove("items", String(itemID));
  if (typeof store.flushTableSync === "function") store.flushTableSync("items");
  return {
    ok: true,
    removed: [itemID],
    item: { itemID, typeID: item.typeID, name: item.itemName || item.shipName || null },
  };
}

// Makes an owned, docked ship the active hull. Native and session-free, so it
// also works while the character is offline.
function boardShip(request) {
  const characterID = Number(request.characterID) || 0;
  const itemID = Number(request.itemID) || 0;
  if (!(itemID > 0)) return { ok: false, error: "itemID is required" };
  const item = readRow("items", itemID);
  if (!item) return { ok: false, error: "item " + itemID + " does not exist" };
  if (Number(item.ownerID) !== characterID) {
    return { ok: false, error: "item " + itemID + " is not owned by " + characterID };
  }
  if (Number(item.categoryID) !== 6) {
    return { ok: false, error: "item " + itemID + " is not a ship hull (categoryID " + item.categoryID + ")" };
  }
  const character = readRow("characters", characterID);
  if (!character) return { ok: false, error: "character " + characterID + " not found" };
  if (!(Number(character.stationID) > 0)) {
    return { ok: false, error: "character " + characterID + " is not docked; docking is required to switch hulls" };
  }
  if (Number(item.locationID) !== Number(character.stationID) || Number(item.flagID) !== 4) {
    return { ok: false, error: "ship " + itemID + " is not in the hangar of station " + character.stationID };
  }
  const session = liveSessionFor(characterID);
  if (session) {
    return {
      ok: false,
      error: "character " + characterID + " is online; switching the hull of a live session is not supported here - relog or use the client",
    };
  }
  try {
    const itemStore = require("../services/inventory/itemStore");
    if (typeof itemStore.setActiveShipForCharacter !== "function") {
      return { ok: false, error: "setActiveShipForCharacter is missing" };
    }
    const result = itemStore.setActiveShipForCharacter(characterID, itemID);
    if (result && result.success === false) {
      return { ok: false, error: String(result.errorMsg || "board refused") };
    }
    return { ok: true, characterID, itemID, name: String(item.itemName || item.shipName || ""), online: false };
  } catch (error) {
    return { ok: false, error: "board failed: " + String(error && error.message || error) };
  }
}

function executeRequest(request) {
  if (!request || typeof request !== "object") return { ok: false, error: "empty request" };
  const action = String(request.action || "");
  if (!ALLOWED_ACTIONS.has(action)) return { ok: false, error: "action not allowed: " + action };
  const characterID = Number(request.characterID) || 0;
  if (!(characterID > 0)) return { ok: false, error: "characterID is required" };
  if (action === "chat_command") return executeChatCommand(request);
  if (action === "give_item") return giveItem(request);
  if (action === "remove_item") return removeItem(request);
  return boardShip(request);
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
    emitEvent("admin-action", result.ok ? "ok" : "refused", {
      action: String(request.action || ""),
      characterID: Number(request.characterID) || 0,
      detail: result.ok ? "" : String(result.error || ""),
    });
    log(`[CoopAdminBridge] ${request.action} for ${request.characterID}: ${result.ok ? "ok" : "refused"} ${result.error || ""}`.trim());
    executed += 1;
  }
  writeJsonLines(REQUESTS, keep);
  return executed;
}

module.exports = { drain, executeRequest, REQUESTS, RESULTS, ALLOWED_ACTIONS };
