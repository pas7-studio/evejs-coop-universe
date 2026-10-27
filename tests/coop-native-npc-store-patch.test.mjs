import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Guard for a real regression: patch 0009 once shipped without the
// `rootShapeVerified.add(tableName)` line, so the memo never populated, every
// collection read took the cold path and the server stayed pinned at ~97% of a
// core while the profile still looked "fixed". A patch that does not actually
// memoise is worse than no patch, so assert the mechanics, not the intent.
const patch = fs.readFileSync(
  new URL("../patches/upstream/0009-native-npc-store-root-clone.patch", import.meta.url),
  "utf8",
);

test("patch 0009 memoises the root shape instead of re-reading it", () => {
  assert.match(patch, /const rootShapeVerified = new Set\(\);/);
  assert.match(patch, /rootShapeVerified\.add\(tableName\);/);
  assert.match(patch, /if \(rootShapeVerified\.has\(tableName\)\)/);
});

test("patch 0009 reads only the requested collection", () => {
  assert.match(patch, /\+  rootShapeReady\(tableName\);/);
  assert.match(patch, /database\.read\(tableName, `\/\$\{key\}`\)/);
  // the old body is what the patch removes, so it must appear as a removal line
  assert.match(patch, /-  const root = ensureRootShape\(tableName\);/);
});
