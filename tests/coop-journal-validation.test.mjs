import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const run = require(path.join(forkRoot, "Code/server/src/space/coopDistributionRun.js"));

const HAULER = 980000093319;

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "l8-01-"));
}

function cleanup(root) {
  fs.rmSync(root, {recursive: true, force: true});
}

function writeJournal(root, haulerID, content) {
  const dir = path.join(root, "distribution-run");
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, `${haulerID}.json`), typeof content === "string" ? content : JSON.stringify(content));
}

const env = {...process.env, EVEJS_COOP_NPC_MARKET_ROOT: ""};

function readJournal(root, haulerID) {
  return run.readJournal(haulerID, {...env, EVEJS_COOP_NPC_MARKET_ROOT: root});
}

function readState(root, haulerID) {
  return run.read(haulerID, {...env, EVEJS_COOP_NPC_MARKET_ROOT: root});
}

function listReport(root) {
  return run.listReport({...env, EVEJS_COOP_NPC_MARKET_ROOT: root});
}

function tick(root, haulerID, authorities) {
  return run.tick(haulerID, authorities, {...env, EVEJS_COOP_NPC_MARKET_ROOT: root});
}

test("empty object is INVALID and read() is null", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {});
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "INVALID");
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("empty array is UNREADABLE", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, []);
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "UNREADABLE");
    assert.ok(typeof result.reason === "string");
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("invalid JSON is UNREADABLE", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, "{ this is not json");
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "UNREADABLE");
    assert.ok(typeof result.reason === "string");
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("journal with no phase is INVALID and reason names PHASE", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {version: 1, haulerID: HAULER});
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "INVALID");
    assert.match(result.reason, /PHASE/);
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("journal for another hull is INVALID and reason names HAULER", () => {
  const root = tmpRoot();
  try {
    // The FILE belongs to the hull we ask about; the CONTENT claims another hull. Writing it under
    // HAULER + 1 and asking about HAULER would test "missing", not "wrong identity".
    writeJournal(root, HAULER, {version: 1, haulerID: HAULER + 1, phase: "PLAN"});
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "INVALID");
    assert.match(result.reason, /HAULER/);
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("unsupported version is INVALID and reason names VERSION", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {version: 99, haulerID: HAULER});
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "INVALID");
    assert.match(result.reason, /VERSION/);
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("unknown phase is INVALID and reason names PHASE", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {version: 1, haulerID: HAULER, phase: "TELEPORT"});
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "INVALID");
    assert.match(result.reason, /PHASE/);
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("wrong field types are each INVALID", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {stopIndex: "zero"});
    assert.equal(readJournal(root, HAULER).status, "INVALID");

    writeJournal(root, HAULER, {stops: {}});
    assert.equal(readJournal(root, HAULER).status, "INVALID");

    writeJournal(root, HAULER, {stops: [{stationID: "x"}]});
    assert.equal(readJournal(root, HAULER).status, "INVALID");

    writeJournal(root, HAULER, {phase: "LOAD", trip: "a string"});
    assert.equal(readJournal(root, HAULER).status, "INVALID");

    writeJournal(root, HAULER, {updatedAt: "yesterday"});
    assert.equal(readJournal(root, HAULER).status, "INVALID");

    writeJournal(root, HAULER, {haulerID: "not-a-number"});
    assert.equal(readJournal(root, HAULER).status, "INVALID");
  } finally {
    cleanup(root);
  }
});

test("directory at journal path is UNREADABLE", () => {
  const root = tmpRoot();
  try {
    const dir = path.join(root, "distribution-run");
    fs.mkdirSync(dir, {recursive: true});
    fs.mkdirSync(path.join(dir, `${HAULER}.json`), {recursive: true});
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "UNREADABLE");
    assert.ok(typeof result.reason === "string");
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("missing file is MISSING and read() is null", () => {
  const root = tmpRoot();
  try {
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "MISSING");
    assert.equal(readState(root, HAULER), null);
  } finally {
    cleanup(root);
  }
});

test("valid PLAN journal is OK and read() returns it", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {version: 1, haulerID: HAULER, phase: "PLAN"});
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "OK");
    assert.equal(result.state.haulerID, HAULER);
    assert.equal(result.state.phase, "PLAN");
    // read() re-parses the file, so it is a different object with the same content.
    assert.deepEqual(readState(root, HAULER), result.state);
  } finally {
    cleanup(root);
  }
});

test("valid in-progress journal is OK", () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {
      version: 1,
      haulerID: HAULER,
      phase: "LOAD",
      trip: {origin: 1, dest: 2},
      stops: [{stationID: 1}],
      stopIndex: 0,
      updatedAt: 1234567890
    });
    const result = readJournal(root, HAULER);
    assert.equal(result.status, "OK");
    assert.equal(result.state.phase, "LOAD");
    assert.deepEqual(readState(root, HAULER), result.state);
  } finally {
    cleanup(root);
  }
});

test("listReport on missing directory reports ABSENT with error null", () => {
  const root = tmpRoot();
  try {
    const report = listReport(root);
    assert.equal(report.status, "ABSENT");
    assert.equal(report.error, null);
    assert.deepEqual(report.runs, []);
    assert.deepEqual(report.unreadable, []);
  } finally {
    cleanup(root);
  }
});

test("listReport on a run path that cannot be enumerated reports UNREADABLE", () => {
  const root = tmpRoot();
  try {
    // Windows reports ENOENT for a path that runs THROUGH a file, and ENOENT honestly means
    // "absent". To force a real enumeration failure the run path ITSELF must be a file (ENOTDIR).
    fs.writeFileSync(path.join(root, "distribution-run"), "data");
    const report = listReport(root);
    assert.equal(report.status, "UNREADABLE");
    assert.ok(typeof report.error === "string");
    assert.ok(report.error.length > 0);
    assert.deepEqual(report.runs, []);
    assert.deepEqual(report.unreadable, []);
  } finally {
    cleanup(root);
  }
});

test("tick with empty object returns BLOCKED and leaves file byte-identical", async () => {
  const root = tmpRoot();
  try {
    writeJournal(root, HAULER, {});
    const before = fs.readFileSync(path.join(root, "distribution-run", `${HAULER}.json`), "utf8");
    const authorities = {planTrip: () => {throw new Error("planTrip called");}};
    const result = await tick(root, HAULER, authorities);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "JOURNAL_INVALID");
    const after = fs.readFileSync(path.join(root, "distribution-run", `${HAULER}.json`), "utf8");
    assert.equal(before, after);
  } finally {
    cleanup(root);
  }
});
