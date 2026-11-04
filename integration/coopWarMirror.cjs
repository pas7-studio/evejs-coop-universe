"use strict";
// FW-051: the war mirror belongs in the game store, not in a JSON file.
//
// FW-041 kept a validated copy of the war state in a JSON file on the data
// volume because a second key inside corporationRuntime lives in a ROW GROUP:
// writing one member lets the next flush rebuild every member from the cache
// and silently revert the real treasury row (FW-050, measured). A dedicated
// table has a single row, so it keeps the "restore only an absent war"
// guarantee without ever touching a sibling row - and it stops the process
// from parsing and rewriting a 1 MB document by hand on every war write.
//
// The legacy file is still READ for one release: an existing install has its
// newest war there, and the first successful read heals that record into
// SQLite so the next boot does not need the file at all.
const TABLE = "coopWarMirror";
const KEY = "/state-v1";

function createWarMirror({gameStore, validate, fs = require("node:fs"), file = null, onHeal = null} = {}) {
  if (!gameStore || typeof gameStore.read !== "function" || typeof gameStore.write !== "function") {
    throw new Error("WAR_MIRROR_GAME_STORE_REQUIRED");
  }
  if (typeof validate !== "function") throw new Error("WAR_MIRROR_VALIDATOR_REQUIRED");

  function readFile() {
    if (!file) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      validate(parsed);
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function writeFile(state) {
    if (!file) return false;
    try {
      const temp = file + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(state));
      fs.renameSync(temp, file);
      return true;
    } catch (_error) {
      return false;
    }
  }

  // Best effort by contract: a mirror may never be the reason a real war write
  // fails. The authoritative record is the atomic row, which is written first.
  function write(state) {
    validate(state);
    try {
      const result = gameStore.write(TABLE, KEY, state);
      if (!result || result.success !== false) return "SQLITE";
    } catch (_error) { /* fall through to the legacy file */ }
    return writeFile(state) ? "FILE" : "NONE";
  }

  function read() {
    try {
      const result = gameStore.read(TABLE, KEY);
      if (result && result.success && result.data) {
        validate(result.data);
        return result.data;
      }
    } catch (_error) { /* unreadable row: the legacy file is the last resort */ }
    const legacy = readFile();
    if (!legacy) return null;
    if (write(legacy) === "SQLITE" && typeof onHeal === "function") {
      try { onHeal(); } catch (_error) { /* reporting is best effort */ }
    }
    return legacy;
  }

  return {TABLE, KEY, read, write};
}

module.exports = {TABLE, KEY, createWarMirror};
