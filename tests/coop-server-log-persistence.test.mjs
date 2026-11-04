import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The image-local server/logs/server.log dies with the container, so every
// `docker compose up --force-recreate` deleted the evidence for the run before it.
// Measured 2026-11-04: three restarts in one afternoon removed the client tracebacks
// we were investigating (the KeyError 30002803 only survived because it was quoted).
// The logger now mirrors the same rotating stream into the persistent data volume.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/utils/logger/index.js"), "utf8");

test("the server log is mirrored into the persistent data volume", () => {
  assert.match(source, /\/var\/lib\/evejs\/logs/);
  assert.match(source, /EVEJS_LOG_DIR/);
  assert.match(source, /rotatingLog\.append\(PERSISTENT_LOG_PATH, line\)/);
  assert.match(source, /rotatingLog\.append\(SERVER_LOG_PATH, line\)/,
    "the image-local log stays for docker logs parity");
});

test("persistence is best effort and never breaks logging", () => {
  assert.match(source, /fs\.accessSync\(path\.dirname\(PERSISTENT_LOG_PATH\), fs\.constants\.W_OK\)/);
  assert.match(source, /catch \(_error\) \{\s*persistentLogEnabled = false;\s*\}/);
});

test("archives are pruned so the data volume stays bounded", () => {
  assert.match(source, /72 \* 3600 \* 1000/);
  assert.match(source, /\^server\\\.\[0-9\]\{4\}/);
  assert.match(source, /fs\.unlinkSync\(file\)/);
});
