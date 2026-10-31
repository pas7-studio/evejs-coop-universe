import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The event file is written once per observed record, ~220 times a minute on the play stack. The old
// writer opened, wrote and closed the file (and re-asked for the same directory) for every record.
// A record must still be on disk the moment observe() returns - only the syscalls are gone.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const probePath = path.join(forkRoot, "Code/server/src/space/coopRuntimeProbe.js");

function freshProbe() {
  delete require.cache[probePath];
  const probe = require(probePath);
  const file = path.join(os.tmpdir(), `coop-probe-${process.pid}-${Date.now()}-${Math.random()}.jsonl`);
  process.env.EVEJS_COOP_EVENTS_FILE = file;
  // Force the path re-validation on every write, so the tests observe it at once.
  process.env.EVEJS_COOP_EVENTS_REVALIDATE_MS = "0";
  return {probe, file};
}

const readLines = (file) => fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);

test("a record is on disk as soon as observe() returns", () => {
  const {probe, file} = freshProbe();
  try {
    assert.equal(probe.observe("fd-test", null, null, {status: "OK"}), true);
    const lines = readLines(file);
    assert.equal(lines.length, 1, "no buffering: the record is durable immediately");
    assert.equal(JSON.parse(lines[0]).event, "fd-test");
  } finally {
    probe.closeAll();
    fs.rmSync(file, {force: true});
  }
});

test("many records keep their order through one descriptor", () => {
  const {probe, file} = freshProbe();
  try {
    for (let i = 0; i < 25; i += 1) probe.observe("fd-test", null, null, {i});
    const lines = readLines(file).map((line) => JSON.parse(line).i);
    assert.deepEqual(lines, [...Array(25).keys()], "every record, in order, nothing lost");
    assert.equal(fs.statSync(file).size > 0, true);
  } finally {
    probe.closeAll();
    fs.rmSync(file, {force: true});
  }
});

test("a rotated file is reopened instead of writing into the old inode", () => {
  const {probe, file} = freshProbe();
  try {
    probe.observe("fd-test", null, null, {n: 1});
    fs.renameSync(file, `${file}.1`);
    // The descriptor still points at the renamed inode; the writer must notice and reopen.
    probe.observe("fd-test", null, null, {n: 2});
    const rotated = readLines(`${file}.1`).map((line) => JSON.parse(line).n);
    assert.deepEqual(rotated, [1], "the rotated file keeps its own history");
  } finally {
    probe.closeAll();
    fs.rmSync(file, {force: true});
    fs.rmSync(`${file}.1`, {force: true});
  }
});

test("a deleted file does not swallow the next record", () => {
  const {probe, file} = freshProbe();
  try {
    probe.observe("fd-test", null, null, {n: 1});
    fs.rmSync(file, {force: true});
    assert.equal(probe.observe("fd-test", null, null, {n: 2}), true,
      "an unlinked descriptor must be reopened, not reported as blocked telemetry");
    assert.equal(readLines(file).length, 1);
  } finally {
    probe.closeAll();
    fs.rmSync(file, {force: true});
  }
});
