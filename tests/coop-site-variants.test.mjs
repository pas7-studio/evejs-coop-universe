import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The owner wants a harder co-op version of the classic anomalies to appear in the SAME
// pool with its own chance to spawn - not the original site renamed. So the variant is a
// real extra template in the dungeon authority's cache, under its own `coop:` templateID.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const variants = require(path.join(forkRoot, "Code/server/src/space/coopSiteVariants.js"));

function cache() {
  const four = {templateID: "client-dungeon:2226", siteFamily: "combat", difficulty: 4,
    resolvedName: "Guristas Burrow"};
  const three = {templateID: "client-dungeon:51", siteFamily: "combat", difficulty: 3,
    resolvedName: "Sansha Den"};
  const ore = {templateID: "client-dungeon:9000", siteFamily: "ore", difficulty: 5,
    resolvedName: "Veldspar Field"};
  const templatesByID = new Map([[four.templateID, four], [three.templateID, three], [ore.templateID, ore]]);
  const templatesByFamily = new Map([["combat", [four, three]], ["ore", [ore]]]);
  return {templatesByID, templatesByFamily, four, three, ore};
}

test("a difficulty-4 combat template gets a real extra pool entry with the multiplier in its name", () => {
  const fixture = cache();
  const added = variants.extendCache(fixture);
  assert.equal(added, 1, "only the difficulty-4 combat template qualifies");
  const variant = fixture.templatesByID.get("coop:client-dungeon:2226");
  assert.ok(variant, "the variant is a first-class template the seeder can resolve");
  assert.equal(variant.sourceTemplateID, "client-dungeon:2226");
  assert.equal(variant.resolvedName, "Co-op x2: Guristas Burrow");
  assert.equal(variant.coopVariant, true);
  assert.deepEqual(fixture.templatesByFamily.get("combat").map((entry) => entry.templateID),
    ["client-dungeon:2226", "client-dungeon:51", "coop:client-dungeon:2226"]);
});

test("the original template is untouched and non-combat or easy sites never clone", () => {
  const fixture = cache();
  variants.extendCache(fixture);
  assert.equal(fixture.four.resolvedName, "Guristas Burrow");
  assert.equal(fixture.four.difficulty, 4);
  assert.equal(fixture.templatesByID.has("coop:client-dungeon:51"), false, "difficulty 3 stays solo content");
  assert.equal(fixture.templatesByID.has("coop:client-dungeon:9000"), false, "ore is never cloned");
});

test("the switch and the cap are real", () => {
  const off = cache();
  assert.equal(variants.extendCache(off, {EVEJS_COOP_SITE_VARIANTS: "0"}), 0);
  assert.equal(off.templatesByID.has("coop:client-dungeon:2226"), false);
  assert.equal(variants.maxPerFamily({EVEJS_COOP_SITE_VARIANTS_MAX: "7"}), 7);
  assert.equal(variants.maxPerFamily({EVEJS_COOP_SITE_VARIANTS_MAX: "0"}), variants.MAX_PER_FAMILY);
});

test("a variant label is never prefixed twice", () => {
  const scaling = require(path.join(forkRoot, "Code/server/src/space/coopSiteWaveScaling.js"));
  assert.equal(scaling.markSiteLabel("Co-op x2: Guristas Burrow",
    {siteFamily: "combat", difficulty: 4, templateID: "coop:client-dungeon:2226"}),
  "Co-op x2: Guristas Burrow");
});
