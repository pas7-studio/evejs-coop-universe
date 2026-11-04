import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Measured 2026-11-05 on the owner's play stack: the overview WINDOW never appeared at
// login and only came back after a second pilot joined his fleet. The server half of that
// chain is here, and it had two holes:
//
//  1. The shared-preset store was never flushed to disk (the table file was still `{}` from
//     2026-10-24 while the service served an entry from memory), so every restart rebuilt
//     it with nextSqID = 1 and every key the client had kept was gone.
//  2. Handle_GetStoredPreset answered null when the exact `hash::sqID` was missing, even
//     when the CONTENT hash matched. The client keeps the key of the profile it last
//     applied and asks for exactly that key at login; null makes
//     presetservice.LoadSharedOverviewProfile raise UserError('OverviewProfileLoadingError')
//     and the overview window is never built.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = fs.readFileSync(
  path.join(forkRoot, "Code/server/src/services/overview/overviewPresetMgrService.js"), "utf8");

test("the preset store is flushed, not only cached", () => {
  assert.match(source, /repo\.flushTableSync\(TABLE\)/,
    "a stored preset must reach the disk, or every restart loses the keys the client keeps");
});

test("a stale sequence number still resolves by content hash", () => {
  const handler = source.slice(source.indexOf("Handle_GetStoredPreset("));
  assert.match(handler, /if \(entry && entry\.hashvalue === hashvalue\)/,
    "an exact key still answers first");
  assert.match(handler, /const sameHash = \(Array\.isArray\(state\.hashIndex\[hashvalue\]\)/,
    "an unknown sqID with a known hash falls back to that hash's entry");
  assert.match(handler, /filter\(\(candidate\) => candidate && candidate\.hashvalue === hashvalue && candidate\.payload\)/,
    "the fallback only ever answers the same content hash, never another profile");
  assert.match(handler, /return \{ type: "wstring", value: String\(/,
    "the payload is still a wstring: a marshal str is Python 2 bytes and breaks the client");
  // The only null is the genuinely unknown hash; a same-hash entry always answers.
  const nullCount = (handler.match(/return null;/g) || []).length;
  assert.equal(nullCount, 2, "only the missing key guard and the unknown hash refuse");
});

