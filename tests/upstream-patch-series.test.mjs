import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERIES = path.join(ROOT, "patches", "upstream");
const PIN = "c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(SERIES, "MANIFEST.json"), "utf8"));
}

test("the series is pinned and the manifest owns every patch", () => {
  const m = manifest();
  assert.equal(m.pin, PIN, "a newer upstream base means a deliberate PIN bump, not drift");
  assert.ok(Array.isArray(m.patches) && m.patches.length > 0);
  const files = fs.readdirSync(SERIES).filter((name) => name.endsWith(".patch")).sort();
  assert.deepEqual(
    files,
    m.patches.map((entry) => entry.file).sort(),
    "every .patch must be listed in MANIFEST.json",
  );
});

test("each patch hash matches the manifest, so an edit cannot pass unnoticed", () => {
  for (const entry of manifest().patches) {
    const buffer = fs.readFileSync(path.join(SERIES, entry.file));
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    assert.equal(digest, entry.sha256, entry.file + " hash mismatch");
    assert.equal(entry.status, entry.status, "status field is required");
    assert.ok(["not-sent", "sent", "merged"].includes(entry.status), entry.file + " status");
  }
});

test("patches are atomic, ordered and never touch our overlay modules", () => {
  const m = manifest();
  const numbers = m.patches.map((entry) => Number(entry.file.slice(0, 4)));
  assert.deepEqual(numbers, numbers.slice().sort((a, b) => a - b), "series must be ordered");
  for (const entry of m.patches) {
    const text = fs.readFileSync(path.join(SERIES, entry.file), "utf8");
    assert.match(text, /^Upstream base: [0-9a-f]{40}$/m, entry.file + " must name its base");
    for (const file of entry.files) {
      assert.ok(file.startsWith("server/"), entry.file + " may only patch stock server code");
      assert.ok(!file.includes("integration"), entry.file + " must not carry overlay code");
    }
    const touched = [...text.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(touched.sort(), entry.files.slice().sort(), entry.file + " file list");
  }
});

test("the overlay no longer carries the capacitor workaround replaced by patch 0002", () => {
  const overlay = fs.readFileSync(path.join(ROOT, "scripts", "patch-evejs-coop.cjs"), "utf8");
  assert.ok(!overlay.includes("coopNpcCapacitor"), "the L2 top-up hack must stay deleted");
  const m = manifest();
  assert.ok(
    m.patches.some((entry) => entry.file.startsWith("0002")),
    "the native recharge patch must be present",
  );
});
