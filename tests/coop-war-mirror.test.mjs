import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// FW-051: the validated faction-war mirror moved from a JSON file into its own
// gameStore table. These tests pin the two things that matter: the file is only
// a migration source (never a second writer once SQLite holds the record), and a
// mirror failure can never fail or corrupt the authoritative war write.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createWarMirror, TABLE, KEY} = require(
  path.join(forkRoot, "Code/server/src/space/coopWarMirror.js"));

function stateOf(stamp) {
  return {
    version: 1,
    wars: {w1: {stamp}},
    campaigns: {},
    territories: {},
  };
}

function validate(state) {
  if (!state || state.version !== 1) throw new Error("WAR_STATE_INVALID");
}

function fakeStore({failWrite = false} = {}) {
  const rows = new Map();
  const writes = [];
  return {
    rows,
    writes,
    read(table, key) {
      const value = rows.get(`${table}/${key}`);
      return value
        ? {success: true, errorMsg: null, data: structuredClone(value)}
        : {success: false, errorMsg: "ENTRY_NOT_FOUND", data: null};
    },
    write(table, key, data) {
      writes.push([table, key]);
      if (failWrite) return {success: false, errorMsg: "WRITE_ERROR"};
      rows.set(`${table}/${key}`, structuredClone(data));
      return {success: true, errorMsg: null};
    },
  };
}

function tempFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-war-mirror-"));
  return path.join(dir, name);
}

test("a war write mirrors into the coopWarMirror row, not a file", () => {
  const store = fakeStore();
  const file = tempFile("mirror.json");
  const mirror = createWarMirror({gameStore: store, validate, file});
  const state = stateOf("sqlite");

  assert.equal(mirror.write(state), "SQLITE");
  assert.deepEqual(store.writes, [[TABLE, KEY]]);
  assert.equal(TABLE, "coopWarMirror");
  assert.equal(KEY, "/state-v1");
  assert.deepEqual(store.rows.get("coopWarMirror//state-v1"), state);
  assert.equal(fs.existsSync(file), false);
});

test("an invalid state is never stored and never written to the file", () => {
  const store = fakeStore();
  const file = tempFile("mirror.json");
  const mirror = createWarMirror({gameStore: store, validate, file});

  assert.throws(() => mirror.write({version: 0}), /WAR_STATE_INVALID/);
  assert.equal(store.writes.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("read prefers SQLite and leaves the legacy file untouched", () => {
  const store = fakeStore();
  const file = tempFile("mirror.json");
  fs.writeFileSync(file, JSON.stringify(stateOf("file")));
  const mirror = createWarMirror({gameStore: store, validate, file});
  mirror.write(stateOf("sqlite"));

  assert.deepEqual(mirror.read(), stateOf("sqlite"));
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).wars.w1.stamp, "file");
});

test("the legacy JSON file is read once and healed into SQLite", () => {
  const store = fakeStore();
  const file = tempFile("mirror.json");
  fs.writeFileSync(file, JSON.stringify(stateOf("legacy")));
  let healed = 0;
  const mirror = createWarMirror({gameStore: store, validate, file, onHeal: () => { healed += 1; }});

  assert.deepEqual(mirror.read(), stateOf("legacy"));
  assert.equal(healed, 1);
  assert.equal(store.rows.get("coopWarMirror//state-v1").wars.w1.stamp, "legacy");
  // next boot no longer needs the file at all
  fs.rmSync(file);
  assert.deepEqual(mirror.read(), stateOf("legacy"));
});

test("an unreadable row or file is reported as no mirror, never invented", () => {
  const store = fakeStore();
  const file = tempFile("mirror.json");
  const mirror = createWarMirror({gameStore: store, validate, file});
  assert.equal(mirror.read(), null);

  fs.writeFileSync(file, "{not json");
  assert.equal(mirror.read(), null);

  // a corrupt document is rejected by the core validator, not trusted
  fs.writeFileSync(file, JSON.stringify({version: 2}));
  assert.equal(mirror.read(), null);
  assert.equal(store.rows.size, 0);
});

test("a refused SQLite write falls back to the file instead of failing the war", () => {
  const store = fakeStore({failWrite: true});
  const file = tempFile("mirror.json");
  const mirror = createWarMirror({gameStore: store, validate, file});

  assert.equal(mirror.write(stateOf("fallback")), "FILE");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), stateOf("fallback"));
});
