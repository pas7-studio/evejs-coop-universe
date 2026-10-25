import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const probe = require("../integration/coopRuntimeProbe.cjs");

test("subscribers receive the exact appended record and cannot break telemetry", () => {
  const dir = mkdtempSync(join(tmpdir(), "coop-probe-subscribe-"));
  const file = join(dir, "events.jsonl");
  const previous = process.env.EVEJS_COOP_EVENTS_FILE;
  process.env.EVEJS_COOP_EVENTS_FILE = file;
  const seen = [];
  const off = probe.subscribe((record) => {
    seen.push(record);
    throw new Error("listener must be isolated");
  });
  try {
    assert.equal(probe.observe("living-test-record", null, null, { systemID: 30000145 }), true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].event, "living-test-record");
    const written = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(written.length, 1);
    assert.equal(written[0].systemID, 30000145);
    off();
    assert.equal(probe.observe("living-test-record", null, null, { systemID: 30000145 }), true);
    assert.equal(seen.length, 1, "unsubscribed listeners stop receiving");
  } finally {
    if (previous === undefined) delete process.env.EVEJS_COOP_EVENTS_FILE;
    else process.env.EVEJS_COOP_EVENTS_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
