import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = process.env.EVEJS_FORK_ROOT;
if (!root) {
  throw new Error("EVEJS_FORK_ROOT is unset");
}

const require = createRequire(import.meta.url);
const modPath = path.join(root, "Code/server/src/space/coopEconomyReachability.js");
const M = require(modPath);

const SERVER = path.join(root, "Code/server");

function assertRelPath(p) {
  assert.ok(!p.startsWith("/"), `path starts with "/": ${p}`);
  assert.ok(!p.includes("\\"), `path has backslash: ${p}`);
  assert.ok(!/^[A-Za-z]:/.test(p), `path has drive letter: ${p}`);
}

test("test 1: real graph shape and relative paths", () => {
  const graph = M.buildRequireGraph({
    srcRoot: SERVER,
    entryFile: path.join(SERVER, "index.js"),
  });
  assert.ok(graph.files > 1000, "files > 1000");
  assert.ok(graph.reachable.length > 700, "reachable.length > 700");
  assert.ok(graph.unreachable.length > 0, "unreachable.length > 0");
  for (const p of graph.reachable) {
    assertRelPath(p);
  }
  for (const p of graph.unreachable) {
    assertRelPath(p);
  }
});

test("test 2: index.js reachable and paths unique", () => {
  const graph = M.buildRequireGraph({
    srcRoot: SERVER,
    entryFile: path.join(SERVER, "index.js"),
  });
  assert.ok(
    graph.reachable.some((p) => p.endsWith("index.js")),
    "index.js is in reachable"
  );
  const seen = new Set();
  for (const p of graph.reachable) {
    assert.ok(!seen.has(p), `duplicate reachable path: ${p}`);
    seen.add(p);
  }
});

test("test 3: unreachableModules prefix and empty", () => {
  const graph = M.buildRequireGraph({
    srcRoot: SERVER,
    entryFile: path.join(SERVER, "index.js"),
  });
  const out = M.unreachableModules(graph, ["src/space/coop"]);
  assert.ok(Array.isArray(out), "returns an array");
  assert.deepEqual(out, out.slice().sort(), "result is sorted");
  for (const p of out) {
    assert.ok(p.startsWith("src/space/coop"), `entry missing prefix: ${p}`);
  }
  assert.deepEqual(M.unreachableModules(graph, []), [], "empty prefixes -> []");
});

test("test 4: detectIncompatibleExecutors", () => {
  assert.equal(M.INCOMPATIBLE_EXECUTORS, "INCOMPATIBLE_EXECUTORS");
  const conflict = [
    { phase: "refinery", owner: "b", enabled: true },
    { phase: "refinery", owner: "a", enabled: true },
    { phase: "mining", owner: "a", enabled: true },
  ];
  assert.deepEqual(
    M.detectIncompatibleExecutors(conflict),
    [{ phase: "refinery", owners: ["a", "b"] }]
  );
  const disabled = [
    { phase: "refinery", owner: "b", enabled: true },
    { phase: "refinery", owner: "a", enabled: false },
    { phase: "mining", owner: "a", enabled: true },
  ];
  assert.deepEqual(M.detectIncompatibleExecutors(disabled), []);
});

test("test 5: negative cases", () => {
  assert.throws(
    () =>
      M.buildRequireGraph({
        srcRoot: SERVER,
        entryFile: path.join(SERVER, "does-not-exist.js"),
      }),
    TypeError,
    "missing entry file throws TypeError"
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ie002-"));
  try {
    fs.writeFileSync(path.join(tmp, "entry.js"), 'require("./other.js");\n');
    fs.writeFileSync(path.join(tmp, "other.js"), "// leaf\n");
    const g = M.buildRequireGraph({
      srcRoot: tmp,
      entryFile: path.join(tmp, "entry.js"),
    });
    const norm = (p) => p.split("/").join("/");
    assert.deepEqual(
      g.reachable.map(norm),
      ["entry.js", "other.js"],
      "reachable has exactly the two relative paths"
    );
    assert.deepEqual(g.unreachable, [], "unreachable is empty");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
