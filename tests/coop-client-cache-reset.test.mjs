import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Owner request 2026-11-05: logging out to the character-select screen (or closing the
// client) must drop the server-side cached method calls, so the next login refetches
// instead of replaying the client's on-disk MachoNet cache. The client only reuses a
// cached result while objCache.GetCachedMethodCallVersion answers with the version it
// stored, so "version reads 0" is the whole contract we have to keep.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const reset = require(
  path.join(forkRoot, "Code/server/src/space/coopClientCacheReset.js"));
const runtime = require(
  path.join(forkRoot, "Code/server/src/services/cache/objectCacheRuntime.js"));

const FLAG = "EVEJS_COOP_CLIENT_CACHE_RESET";
const SESSION = {characterID: 140000005, charid: 140000005};

function withTempEvents(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-cache-reset-"));
  const file = path.join(dir, "coop-events.jsonl");
  const previous = process.env.EVEJS_COOP_EVENTS_FILE;
  process.env.EVEJS_COOP_EVENTS_FILE = file;
  try {
    return fn(file);
  } finally {
    if (previous === undefined) delete process.env.EVEJS_COOP_EVENTS_FILE;
    else process.env.EVEJS_COOP_EVENTS_FILE = previous;
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

function cacheOneResult(method) {
  runtime.buildCachedMethodCallResult("cached-result", {
    serviceName: "marketProxy",
    method,
    args: [34],
  });
  assert.ok(
    runtime.getCachedMethodCallVersion({serviceName: "marketProxy", method, args: [34]}) > 0,
    "a served result must publish a non-zero version",
  );
}

test("flag OFF leaves the client cache alone", () => {
  delete process.env[FLAG];
  cacheOneResult("GetOrders");
  const outcome = reset.noteLogoutToCharacterSelect(SESSION);
  assert.equal(outcome.status, "DISABLED");
  assert.ok(
    runtime.getCachedMethodCallVersion(
      {serviceName: "marketProxy", method: "GetOrders", args: [34]}) > 0,
    "nothing may be invalidated while the feature is off",
  );
  runtime.invalidateAllCachedMethodCalls();
});

test("logging out to character select makes every cached version read 0", () => {
  process.env[FLAG] = "1";
  try {
    withTempEvents((file) => {
      cacheOneResult("GetOrders");
      cacheOneResult("GetRegionBest");
      const outcome = reset.noteLogoutToCharacterSelect(SESSION);
      assert.equal(outcome.status, "RESET");
      assert.equal(outcome.characterID, 140000005);
      assert.ok(outcome.invalidated >= 2);
      for (const method of ["GetOrders", "GetRegionBest"]) {
        assert.equal(
          runtime.getCachedMethodCallVersion({serviceName: "marketProxy", method, args: [34]}),
          0,
          `${method} must be refetched after the reset`,
        );
      }
      const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(lines.length, 1);
      assert.equal(lines[0].event, "client-cache-reset");
      assert.equal(lines[0].status, "RESET");
      assert.equal(lines[0].reason, "LOGOUT_TO_CHARACTER_SELECT");
      assert.equal(lines[0].characterID, 140000005);
    });
  } finally {
    delete process.env[FLAG];
  }
});

test("a second reset in the same window is harmless and reported as NOTHING_CACHED", () => {
  process.env[FLAG] = "1";
  try {
    withTempEvents(() => {
      cacheOneResult("GetOrders");
      assert.equal(reset.noteCharacterSessionClosed(SESSION).status, "RESET");
      const again = reset.noteLogoutToCharacterSelect(SESSION);
      assert.equal(again.status, "NOTHING_CACHED");
      assert.equal(again.invalidated, 0);
    });
  } finally {
    delete process.env[FLAG];
  }
});

test("a session without a character id never breaks the logout path", () => {
  process.env[FLAG] = "1";
  try {
    withTempEvents(() => {
      cacheOneResult("GetOrders");
      const outcome = reset.noteLogoutToCharacterSelect({});
      assert.equal(outcome.characterID, 0);
      assert.equal(outcome.status, "RESET");
    });
  } finally {
    delete process.env[FLAG];
  }
});
