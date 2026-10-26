import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKLOG = path.join(ROOT, "docs", "WORKLOG.md");
const ENTRY = /^### (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) · ([0-9a-f]{7,40}) · (L1|L2|L3|DOCS|TEST|OPS) · (.+)$/gm;

function entries() {
  const text = fs.readFileSync(WORKLOG, "utf8");
  const found = [];
  let match;
  ENTRY.lastIndex = 0;
  while ((match = ENTRY.exec(text)) !== null) {
    found.push({ at: match[1], sha: match[2], layer: match[3], title: match[4], index: match.index, text });
  }
  return found;
}

test("the worklog exists and carries real entries", () => {
  assert.ok(fs.existsSync(WORKLOG), "docs/WORKLOG.md must exist");
  assert.ok(entries().length > 0, "the worklog must not be empty");
});

test("every entry names a commit, a UTC time and a layer", () => {
  for (const entry of entries()) {
    assert.match(entry.sha, /^[0-9a-f]{7,40}$/);
    assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
    assert.ok(entry.title.trim().length > 8, "an entry needs a real subject");
  }
});

test("no commit is logged twice", () => {
  const seen = new Set();
  for (const entry of entries()) {
    const key = entry.sha.slice(0, 7);
    assert.ok(!seen.has(key), "duplicate worklog entry for " + key);
    seen.add(key);
  }
});

test("every entry records why and where", () => {
  const text = fs.readFileSync(WORKLOG, "utf8");
  const blocks = text.split(/^### /m).slice(1);
  for (const block of blocks) {
    const title = block.split("\n")[0];
    assert.match(block, /^Why: \S/m, "missing Why: in " + title);
    assert.match(block, /^Where: \S/m, "missing Where: in " + title);
    assert.match(block, /^Evidence: \S/m, "missing Evidence: in " + title);
  }
});
