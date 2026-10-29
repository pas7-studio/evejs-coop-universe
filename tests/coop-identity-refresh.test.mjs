import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// The identity file has several readers (the world, the market trader, the co-op loop) and
// each kept its own copy. Measured 2026-10-30: the co-op linked a distribution hull and the
// market trader answered NO_IDENTITY_LINK to every sale, because it still held the file as it
// was at boot - and the next write from either side dropped the other's link.
const { createRegistry } = require("../integration/coopIdentityRegistry.cjs");

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-"));
  return path.join(dir, "coop-npc-links.json");
}

test("a registry notices a link another owner wrote", () => {
  const file = fresh();
  const exists = () => true;
  const reader = createRegistry({ file, exists });
  const writer = createRegistry({ file, exists });
  assert.equal(reader.get("coop-pilot-050"), null);
  writer.link({ id: "coop-pilot-050", name: "Fifty", faction: "independent", role: "hauler" },
    30000142, 980000004164);
  // The snapshot refreshes: a reader never acts on a stale copy.
  assert.equal(reader.get("coop-pilot-050")?.entityID, 980000004164);
  assert.equal(reader.snapshot().links["coop-pilot-050"].systemID, 30000142);
});

test("a refresh with nothing new changes nothing", () => {
  const file = fresh();
  const exists = () => true;
  const one = createRegistry({ file, exists });
  one.link({ id: "coop-pilot-051", name: "Fifty-one" }, 30000145, 980000004100);
  assert.equal(one.refresh(), false, "our own write is not a foreign change");
});

test("the market trader refreshes before it looks for the identity", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "integration/coopNativeNpcMarket.cjs"), "utf8");
  assert.ok(/registry\.refresh\?\.\(\)[\s\S]{0,200}registry\.snapshot\(\)\.links\?\.\[pilotID\]/.test(source),
    "a trader that never re-reads can only trade with the identities it saw at boot");
});

test("two owners link different hulls and neither loses the other's link", () => {
  // Measured 2026-10-30: the loop linked a distribution hull, the next write from the market
  // side replaced the whole file, and every crossing then failed SOURCE_IDENTITY_MISMATCH.
  const file = fresh();
  const exists = () => true;
  const a = createRegistry({ file, exists });
  const b = createRegistry({ file, exists });
  a.link({ id: "coop-pilot-060", name: "Sixty", role: "hauler" }, 30000145, 980000004164);
  b.link({ id: "coop-pilot-061", name: "Sixty-one", role: "hauler" }, 30000142, 980000004100);
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8")).links;
  assert.ok(onDisk["coop-pilot-060"], "the first owner's link survives the second write");
  assert.ok(onDisk["coop-pilot-061"], "and the second owner's link is there too");
});

test("a released link is not resurrected by another owner's write", () => {
  const file = fresh();
  const exists = () => true;
  const a = createRegistry({ file, exists });
  const b = createRegistry({ file, exists });
  a.link({ id: "coop-pilot-062", name: "Sixty-two" }, 30000145, 980000004101);
  b.link({ id: "coop-pilot-063", name: "Sixty-three" }, 30000145, 980000004102);
  a.release("coop-pilot-062", { expectedEntityID: 980000004101 });
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8")).links;
  assert.equal(onDisk["coop-pilot-062"], undefined, "a release sticks");
  assert.ok(onDisk["coop-pilot-063"], "and the other owner's link is untouched");
});
