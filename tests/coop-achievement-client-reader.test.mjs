import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

// The catalogue is parsed by the client's own generated reader, not by a reader of ours.
//
// Our own reader and our own writer share the same assumption, so the same wrong field width
// passes both - that is how a uint32 target shipped where the client reads uint64, and the client
// decoded 1 as 618475290625. scripts/coop-verify-flatbuffer-client.cjs runs the client's generated
// module from the local archive at run time (CCP code is never committed); this test fails if that
// reader cannot make sense of the buffer. It SKIPS - never passes - when python3 with the
// flatbuffers package or the client archive is missing, because a check that cannot run is not
// evidence.
const repoRoot = path.resolve(process.cwd());

test("the client's own generated reader parses our achievement catalogue", (t) => {
  const result = spawnSync(
    process.execPath,
    ["scripts/coop-verify-flatbuffer-client.cjs", "achievement"],
    { cwd: repoRoot, encoding: "utf8", timeout: 600000 },
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (/SKIPPED/.test(output)) {
    t.skip(output.trim().split("\n").find((line) => line.includes("SKIPPED")));
    return;
  }
  assert.equal(result.status, 0, output.split("\n").slice(-6).join("\n"));
  assert.match(output, /CLIENT_READER_OK/);
  // The numbers the reader reports are the ones the catalogue declares; a wrong width shows up
  // here as a target that is not 1/100.
  assert.match(output, /targets=1\/100 sp=1000\/2500/);
});
