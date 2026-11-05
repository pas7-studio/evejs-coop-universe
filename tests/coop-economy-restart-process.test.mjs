import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The earlier restart tests simulated a restart by dropping the module cache. That is not a restart:
// the process still shares its memory, its file handles and its clock. This one runs the operation in
// a CHILD PROCESS, twice, over the same journal file - a real process boundary.
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const SPACE = path.join((process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim(), "Code/server/src/space");
const RUNNER = path.join(import.meta.dirname, "fixtures", "settle-once.cjs");

function run(fillID, journalFile, creditLog) {
  const out = execFileSync(process.execPath, [RUNNER, SPACE, journalFile, creditLog, fillID], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

function credits(logFile) {
  try {
    return fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).length;
  } catch (_error) {
    return 0;
  }
}

test("a file journal makes one settlement survive a real process restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-journal-"));
  const journalFile = path.join(dir, "journal.json");
  const creditLog = path.join(dir, "credits.log");

  const first = run("fill-proc", journalFile, creditLog);
  assert.equal(first.code, "SETTLED");
  assert.equal(credits(creditLog), 1);

  const onDisk = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  assert.equal(onDisk.length, 1, "the journal did not write the settled fill");

  const second = run("fill-proc", journalFile, creditLog);
  assert.equal(second.code, "ALREADY_SETTLED", "a second process settled the same fill again");
  assert.equal(credits(creditLog), 1, "the money moved twice across a process restart");
});

test("a corrupt journal file is set aside, not silently treated as empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-journal-bad-"));
  const journalFile = path.join(dir, "journal.json");
  const creditLog = path.join(dir, "credits.log");
  fs.writeFileSync(journalFile, "{ not json");

  // Contract change 2026-11-02 (independent review): the old expectation was that a corrupt journal
  // is set aside and the settlement proceeds with an empty map. That is how a settled fill is paid a
  // second time after a crash, so the journal now fails closed: the corrupt file is preserved, the
  // settlement is refused, and no money moves.
  const first = run("fill-bad", journalFile, creditLog);
  assert.equal(first.code, "JOURNAL_UNREADABLE", "a corrupt journal did not fail closed");
  assert.equal(fs.existsSync(journalFile + ".corrupt"), true, "the corrupt journal was not preserved");
  assert.equal(credits(creditLog), 0, "money moved with no readable journal");
});

test("the file journal never leaves a half-written file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-journal-atomic-"));
  const journalFile = path.join(dir, "journal.json");
  const journal = require(path.join(SPACE, "coopEconomyJournalFile.js")).createFileJournal(journalFile);
  for (let i = 0; i < 50; i += 1) journal.set("k" + i, { i });
  const parsed = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  assert.equal(parsed.length, 50);
  const reloaded = require(path.join(SPACE, "coopEconomyJournalFile.js")).createFileJournal(journalFile);
  assert.equal(reloaded.get("k49").i, 49, "a fresh reader does not see the last write");
  assert.equal(reloaded.size, 50);
});
