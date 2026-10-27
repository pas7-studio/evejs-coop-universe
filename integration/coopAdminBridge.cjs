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

// Source .cjs modules become .js siblings in the deployed EveJS overlay.
const siblingSuffix = typeof __filename === "string" && __filename.endsWith(".js") ? "" : ".cjs";

const REQUESTS = process.env.EVEJS_COOP_ADMIN_REQUESTS || "/var/lib/evejs/coop-admin-requests.jsonl";
const RESULTS = process.env.EVEJS_COOP_ADMIN_RESULTS || "/var/lib/evejs/coop-admin-results.jsonl";
const EVENTS = process.env.EVEJS_COOP_EVENTS_FILE || "/var/lib/evejs/coop-events.jsonl";
const ALLOWED_ACTIONS = new Set(["chat_command", "give_item", "remove_item", "board_ship", "fit_ship", "move_item", "fit_slots", "deploy_structure", "spawn_native_npc", "war_diagnose", "inspect_npc"]);
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
    const itemStore = require("../services/inventory/itemStore");
    const registry = require("../services/inventory/itemTypeRegistry");
    const lookup = typeof registry.resolveItemByTypeID === "function"
      ? registry.resolveItemByTypeID(typeID)
      : null;
    // resolveItemByTypeID returns {success, match} in this codebase; the grant
    // primitive wants the record itself.
    const resolved = lookup && lookup.match ? lookup.match : lookup;
    if (!resolved) return { ok: false, error: "unknown typeID " + typeID };
    if (typeof itemStore.grantItemToCharacterStationHangar !== "function") {
      return { ok: false, error: "itemStore.grantItemToCharacterStationHangar is missing" };
    }
    const granted = itemStore.grantItemToCharacterStationHangar(characterID, stationID, resolved, quantity);
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

// Moves an owned item to another location: the native primitive behind looting a
// wreck or putting a module back in the hangar.
function moveItem(request) {
  const characterID = Number(request.characterID) || 0;
  const itemID = Number(request.itemID) || 0;
  const toLocationID = Number(request.toLocationID) || 0;
  const toFlagID = Number(request.toFlagID) || 4;
  if (!(itemID > 0) || !(toLocationID > 0)) return { ok: false, error: "itemID and toLocationID are required" };
  const item = readRow("items", itemID);
  if (!item) return { ok: false, error: "item " + itemID + " does not exist" };
  if (Number(item.ownerID) !== characterID) {
    return { ok: false, error: "item " + itemID + " is not owned by " + characterID };
  }
  try {
    const store = require("../services/inventory/itemStore");
    if (typeof store.moveItemToLocation !== "function") return { ok: false, error: "moveItemToLocation is missing" };
    const moved = store.moveItemToLocation(itemID, toLocationID, toFlagID, null);
    if (moved && moved.success === false) return { ok: false, error: String(moved.errorMsg || "move refused") };
    return {
      ok: true,
      itemID,
      name: String(item.itemName || item.shipName || ""),
      from: Number(item.locationID) || 0,
      toLocationID,
      toFlagID,
    };
  } catch (error) {
    return { ok: false, error: "move failed: " + String(error && error.message || error) };
  }
}

// Fits modules onto an owned, docked hull using the same native fitting path as
// the dev ship commands: grant each module to the hangar, then fit it. Works
// without a live session, so a bare hull can be made flyable offline.
function fitShip(request) {
  const characterID = Number(request.characterID) || 0;
  const shipItemID = Number(request.itemID) || 0;
  const modules = Array.isArray(request.modules) ? request.modules : [];
  if (!(shipItemID > 0)) return { ok: false, error: "itemID (the hull) is required" };
  if (!modules.length) return { ok: false, error: "modules[] is required" };
  const character = readRow("characters", characterID);
  if (!character) return { ok: false, error: "character " + characterID + " not found" };
  const stationID = Number(character.stationID) || 0;
  if (!(stationID > 0)) return { ok: false, error: "character is not docked" };
  const shipItem = readRow("items", shipItemID);
  if (!shipItem) return { ok: false, error: "ship " + shipItemID + " not found" };
  if (Number(shipItem.ownerID) !== characterID) {
    return { ok: false, error: "ship " + shipItemID + " is not owned by " + characterID };
  }
  if (Number(shipItem.categoryID) !== 6) {
    return { ok: false, error: "item " + shipItemID + " is not a ship hull" };
  }
  if (Number(shipItem.locationID) !== stationID || Number(shipItem.flagID) !== 4) {
    return { ok: false, error: "ship " + shipItemID + " is not in the hangar of station " + stationID };
  }

  let registry = null;
  let characterState = null;
  let dev = null;
  try {
    registry = require("../services/inventory/itemTypeRegistry");
    characterState = require("../services/character/characterState");
    dev = require("../services/ship/devCommandShipRuntime");
  } catch (error) {
    return { ok: false, error: "fitting modules unavailable: " + String(error && error.message || error) };
  }
  if (typeof dev.fitGrantedItemTypeToShip !== "function") {
    return { ok: false, error: "fitGrantedItemTypeToShip is missing" };
  }

  // The native fitting planner needs the real session: with a bare identity it
  // answers "no valid slot" for every module, which would be a lie to report.
  const identity = liveSessionFor(characterID);
  if (!identity) {
    return { ok: false, error: "fitting needs a live session: log the character in first" };
  }

  const results = [];
  for (const module of modules) {
    const name = String(module && module.name || "").trim();
    const typeID = Number(module && module.typeID) || 0;
    const count = Math.max(1, Number(module && module.count) || 1);
    let itemType = null;
    try {
      const lookup = typeID > 0
        ? registry.resolveItemByTypeID(typeID)
        : registry.resolveItemByName(name);
      itemType = lookup && lookup.match ? lookup.match : lookup;
    } catch (_error) {
      itemType = null;
    }
    if (!itemType) {
      results.push({ name: name || String(typeID), ok: false, error: "item type not found" });
      continue;
    }
    // grant:false means the modules already sit in the hangar (for example after
    // being recovered from a wreck), so fitting consumes those real items
    // instead of minting new ones.
    if (request.grant !== false) {
      let granted = null;
      try {
        const store = require("../services/inventory/itemStore");
        granted = store.grantItemToCharacterStationHangar(characterID, stationID, itemType, count);
      } catch (error) {
        results.push({ name, ok: false, error: "grant failed: " + String(error && error.message || error) });
        continue;
      }
      if (!granted || granted.success === false) {
        results.push({ name, ok: false, error: String(granted && granted.errorMsg || "grant refused") });
        continue;
      }
    }
    try {
      const fitted = dev.fitGrantedItemTypeToShip(identity, stationID, shipItem, itemType, count, {
        syncToSession: false,
        forceFit: true,
      });
      const fittedCount = Number(fitted && fitted.fittedCount) || 0;
      results.push({
        name: itemType.name || itemType.typeName || name,
        ok: fittedCount > 0,
        fitted: fittedCount,
        forced: Number(fitted && fitted.forcedCount) || 0,
        error: fittedCount > 0 ? "" : "no valid slot for this module",
      });
    } catch (error) {
      results.push({ name, ok: false, error: "fit failed: " + String(error && error.message || error) });
    }
  }

  const fitted = results.filter((row) => row.ok).length;
  return { ok: fitted > 0, fitted, attempted: results.length, results, characterID, itemID: shipItemID };
}

// Fits modules into explicit slot flags: [typeID, flag, count]. This is the
// data-level truth of a fit (items sitting in their slots) and is used when the
// auto-slot planner cannot place a hull it has never seen fitted.
function fitSlots(request) {
  const characterID = Number(request.characterID) || 0;
  const shipItemID = Number(request.itemID) || 0;
  const slots = Array.isArray(request.modules) ? request.modules : [];
  if (!(shipItemID > 0) || !slots.length) return { ok: false, error: "itemID and modules[] are required" };
  const character = readRow("characters", characterID);
  if (!character) return { ok: false, error: "character " + characterID + " not found" };
  const stationID = Number(character.stationID) || 0;
  const shipItem = readRow("items", shipItemID);
  if (!shipItem) return { ok: false, error: "ship " + shipItemID + " not found" };
  if (Number(shipItem.ownerID) !== characterID) return { ok: false, error: "ship is not owned by " + characterID };

  const store = require("../services/inventory/itemStore");
  const registry = require("../services/inventory/itemTypeRegistry");

  // Every hangar item of a type, oldest first, so recovered items are reused.
  const hangarItemsOfType = (typeID) => {
    const rows = [];
    let table = require("../gameStore").read("items");
    if (table && table.success !== false && table.data !== undefined) table = table.data;
    if (typeof table === "string") table = JSON.parse(table);
    const walk = (value, depth) => {
      if (!value || depth > 4 || rows.length > 4000) return;
      if (Array.isArray(value)) { for (const child of value) walk(child, depth + 1); return; }
      if (typeof value !== "object") return;
      if (value.itemID !== undefined && value.typeID !== undefined) {
        if (Number(value.ownerID) === characterID &&
            Number(value.typeID) === typeID &&
            Number(value.locationID) === stationID &&
            Number(value.flagID) === 4) {
          rows.push(value);
        }
        return;
      }
      for (const child of Object.values(value)) walk(child, depth + 1);
    };
    walk(table, 0);
    return rows.sort((left, right) => Number(left.itemID) - Number(right.itemID));
  };

  const results = [];
  for (const slot of slots) {
    const typeID = Number(slot && slot.typeID) || 0;
    const flagID = Number(slot && slot.flag) || 0;
    const count = Math.max(1, Number(slot && slot.count) || 1);
    if (!(typeID > 0) || !(flagID > 0)) {
      results.push({ typeID, flag: flagID, ok: false, error: "typeID and flag are required" });
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      let candidates = hangarItemsOfType(typeID);
      if (!candidates.length) {
        const lookup = registry.resolveItemByTypeID(typeID);
        const itemType = lookup && lookup.match ? lookup.match : lookup;
        if (!itemType) { results.push({ typeID, flag: flagID, ok: false, error: "unknown typeID" }); break; }
        const granted = store.grantItemToCharacterStationHangar(characterID, stationID, itemType, 1);
        if (!granted || granted.success === false) {
          results.push({ typeID, flag: flagID, ok: false, error: String(granted && granted.errorMsg || "grant refused") });
          break;
        }
        candidates = hangarItemsOfType(typeID);
      }
      const item = candidates[0];
      if (!item) { results.push({ typeID, flag: flagID, ok: false, error: "no item available" }); break; }
      const moved = store.moveItemToLocation(item.itemID, shipItemID, flagID, null);
      if (moved && moved.success === false) {
        results.push({ typeID, flag: flagID, ok: false, error: String(moved.errorMsg || "move refused") });
        break;
      }
      results.push({ typeID, flag: flagID, itemID: item.itemID, ok: true });
    }
  }
  const fitted = results.filter((row) => row.ok).length;
  return { ok: fitted > 0, fitted, attempted: results.length, results, characterID, itemID: shipItemID };
}

// Deploys one real structure for a faction through coopStructureFactory, which
// writes via the native structureState writer. The co-op layer needs this because
// the stock deployment surface is client RPC only. The result always carries the
// factory's own refusal reason, and a deploy is only "ok" when the row is read
// back from the native system reader afterwards.
function deployStructure(request) {
  let factory = null;
  try {
    factory = require("./coopStructureFactory" + siblingSuffix);
  } catch (error) {
    return { ok: false, error: "structure factory unavailable: " + String(error && error.message || error) };
  }
  const input = {
    systemID: Number(request.systemID) || 0,
    typeID: Number(request.typeID) || 0,
    // Passed verbatim: the factory's own strict faction validation must be what
    // the caller sees, so a JSON string never becomes a faction here.
    factionID: request.factionID,
    ownerCorpID: Number(request.ownerCorpID) || 0,
    position: request.position,
    name: String(request.name || ""),
  };
  if (typeof request.description === "string" && request.description.trim()) {
    input.description = request.description;
  }
  let deployed = null;
  try {
    deployed = factory.deploy(input);
  } catch (error) {
    return { ok: false, error: "deploy threw: " + String(error && error.message || error) };
  }
  if (!deployed || deployed.status !== "DEPLOYED") {
    return {
      ok: false,
      status: String((deployed && deployed.status) || "UNKNOWN"),
      error: String((deployed && (deployed.reason || deployed.errorMsg)) || "deploy refused"),
    };
  }
  let verified = { status: "UNKNOWN", reason: "NOT_VERIFIED" };
  try {
    verified = factory.verify({ systemID: deployed.systemID, structureID: deployed.structureID });
  } catch (_error) {
    verified = { status: "UNKNOWN", reason: "VERIFY_FAILED" };
  }
  return {
    ok: verified.status === "PRESENT",
    status: deployed.status,
    structureID: deployed.structureID,
    systemID: deployed.systemID,
    typeID: deployed.typeID,
    factionID: deployed.factionID,
    verified: verified.status,
    verifyReason: String(verified.reason || ""),
    name: String((deployed.record && (deployed.record.name || deployed.record.itemName)) || ""),
  };
}

// Spawns real native NPC hulls in a system from a real SDE profile, so the world
// can be set up honestly (e.g. a second faction's patrol in a tied system). It
// uses the same native spawnBatchInSystem + scene anchor the materializer uses,
// reports the resulting entity/corporation/faction, and never fabricates a ship.
function spawnNativeNpc(request) {
  const systemID = Number(request.systemID) || 0;
  const profileQuery = String(request.profileQuery || "").trim();
  const amount = Math.max(1, Math.min(4, Number(request.amount) || 1));
  if (!(systemID > 0)) return { ok: false, error: "systemID is required" };
  if (!profileQuery) return { ok: false, error: "profileQuery is required" };
  let runtime = null;
  let npc = null;
  let topology = null;
  let npcStore = null;
  let factions = null;
  try {
    runtime = require("./runtime");
    npc = require("./npc/npcRuntime");
    topology = require("./coopNpcTopology" + siblingSuffix);
    npcStore = require("./npc/nativeNpcStore");
    factions = require("../services/faction/factionState");
  } catch (error) {
    return { ok: false, error: "native spawn dependencies unavailable: " + String(error && error.message || error) };
  }
  let scene = null;
  try {
    scene = runtime.ensureScene(systemID, { refreshStargates: false });
  } catch (error) {
    return { ok: false, error: "scene unavailable: " + String(error && error.message || error) };
  }
  const anchor = topology.anchorOptions(scene);
  if (!anchor) return { ok: false, error: "NO_NATIVE_SYSTEM_ANCHOR" };
  let result = null;
  try {
    result = npc.spawnBatchInSystem(systemID, {
      ...anchor,
      amount,
      entityType: "npc",
      transient: true,
      broadcast: true,
      profileQuery,
    });
  } catch (error) {
    return { ok: false, error: "spawn threw: " + String(error && error.message || error) };
  }
  const spawned = (result && result.data && Array.isArray(result.data.spawned)) ? result.data.spawned : [];
  if (!result || result.success !== true || !spawned.length) {
    return { ok: false, error: String((result && result.errorMsg) || "spawn refused"), spawned: spawned.length };
  }
  const ships = spawned.map((entry) => {
    const entityID = Number((entry.entity && entry.entity.itemID) || entry.entityID || 0);
    let corporationID = 0;
    let factionID = 0;
    try {
      const native = npcStore.getNativeEntity(entityID);
      corporationID = Number(native && native.corporationID) || 0;
      factionID = Number(factions.getFactionIDForCorporation(corporationID)) || 0;
    } catch (_error) {
      corporationID = 0;
    }
    return { entityID, corporationID, factionID };
  });
  // Optional: make the ship a real world presence by linking it to an unlinked
  // roster pilot. Without a link the war presence legitimately ignores the hull.
  let link = null;
  const pilotID = String(request.pilotID || "").trim();
  if (pilotID && ships.length) {
    try {
      const runtimeWorld = require("./coopVirtualWorldRuntime" + siblingSuffix);
      link = runtimeWorld.linkSpawnedIdentity({
        pilotID,
        systemID,
        entityID: ships[0].entityID,
        role: String(request.role || ""),
      });
    } catch (error) {
      link = { status: "LINK_UNAVAILABLE", reason: String(error && error.message || error) };
    }
  }
  return {
    ok: true,
    systemID,
    profileQuery,
    spawned: ships.length,
    ships,
    link,
    selectionID: String((result.data && (result.data.selectionID || result.data.selectionName)) || ""),
  };
}

function executeRequest(request) {
  if (!request || typeof request !== "object") return { ok: false, error: "empty request" };
  const action = String(request.action || "");
  if (!ALLOWED_ACTIONS.has(action)) return { ok: false, error: "action not allowed: " + action };
  // A structure belongs to a corporation, not to a character, so this action is
  // the one admin request that legitimately has no characterID.
  if (action === "deploy_structure") return deployStructure(request);
  if (action === "spawn_native_npc") return spawnNativeNpc(request);
  // Read-only war diagnostics: never reserves, orders or writes anything.
  if (action === "inspect_npc") {
    // Read-only: what a native hull really carries right now.
    const entityID = Number(request.entityID) || 0;
    if (!(entityID > 0)) return { ok: false, error: "entityID is required" };
    try {
      const store = require("./npc/nativeNpcStore");
      const native = store.getNativeEntity(entityID);
      const modules = store.listNativeModulesForEntity(entityID) || [];
      const cargo = store.listNativeCargoForEntity(entityID) || [];
      return {
        ok: true,
        entityID,
        native: native ? {
          systemID: Number(native.systemID) || 0,
          corporationID: Number(native.corporationID) || 0,
          ownerID: Number(native.ownerID) || 0,
          transient: native.transient === true,
        } : null,
        modules: modules.slice(0, 16).map((m) => ({
          moduleID: Number(m.moduleID) || 0,
          categoryID: Number(m.categoryID) || 0,
          typeID: Number(m.typeID) || 0,
          flagID: Number(m.flagID) || 0,
          online: Boolean(m.moduleState && m.moduleState.online),
        })),
        moduleCount: modules.length,
        cargo: cargo.slice(0, 16).map((c) => ({
          cargoID: Number(c.cargoID) || 0,
          categoryID: Number(c.categoryID) || 0,
          typeID: Number(c.typeID) || 0,
          quantity: Number(c.quantity) || 0,
          moduleID: Number(c.moduleID) || 0,
          transient: c.transient === true,
        })),
        cargoCount: cargo.length,
      };
    } catch (error) {
      return { ok: false, error: "inspect failed: " + String(error && error.message || error) };
    }
  }
  if (action === "war_diagnose") {
    try {
      const runtimeWorld = require("./coopVirtualWorldRuntime" + siblingSuffix);
      return { ok: true, mobilization: runtimeWorld.diagnoseMobilization() };
    } catch (error) {
      return { ok: false, error: "diagnose failed: " + String(error && error.message || error) };
    }
  }
  const characterID = Number(request.characterID) || 0;
  if (!(characterID > 0)) return { ok: false, error: "characterID is required" };
  if (action === "chat_command") return executeChatCommand(request);
  if (action === "give_item") return giveItem(request);
  if (action === "remove_item") return removeItem(request);
  if (action === "fit_ship") return fitShip(request);
  if (action === "move_item") return moveItem(request);
  if (action === "fit_slots") return fitSlots(request);
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
