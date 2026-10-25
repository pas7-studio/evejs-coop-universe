import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildProfile, verify, parsePresets, TABS, SHIP_GROUPS } = require("../scripts/gen-alife-overview.cjs");

function preset(name, groups) {
  const lines = [
    `- - ${name}`,
    "  - - - alwaysShownStates",
    "      - []",
    "    - - filteredStates",
    "      - []",
    "    - - groups",
    `      - - ${groups[0]}`,
    ...groups.slice(1).map((id) => `        - ${id}`),
  ];
  return lines.join("\n");
}

const BASE = [
  "backgroundOrder:",
  "- 1",
  "columnOrder:",
  "- 3",
  "overviewColumns:",
  "- - name",
  "  - icon",
  "presets:",
  preset("Travel", [6, 7, 8]),
  preset("Everything", [6, 7, ...SHIP_GROUPS, 185]),
  preset("Common", [6, 10, 15, ...SHIP_GROUPS]),
  preset("Harvest", [6, 10, 450]),
  preset("Targets", [6, 10, ...SHIP_GROUPS]),
  preset("Targets: Charges/Drones", [6, 548]),
  preset("Celestial", [6, 7, 8, 9]),
  preset("Loot", [6, 18, 19]),
  "shipLabelOrder:",
  "- 1",
  "stateBlinks:",
  "- - 0",
  "  - false",
  "tabSetup:",
  "- - 0",
  "  - - - bracket",
  "      - null",
  "    - - name",
  "      - <color=0xFF33FF99><fontsize=12> Travel </fontsize></color>",
  "    - - overview",
  "      - Travel",
  "userSettings:",
  "- - applyToOtherObjects",
  "  - true",
].join("\n");

test("the generated profile keeps every exported section intact", () => {
  const built = buildProfile(BASE);
  const check = verify(built, BASE);
  assert.deepEqual(check.problems, []);
  for (const key of ["backgroundOrder", "columnOrder", "overviewColumns", "shipLabelOrder", "stateBlinks", "userSettings"]) {
    assert.match(built, new RegExp(`^${key}:$`, "m"), `section ${key} survived`);
  }
});

test("NPC and Mining presets include every ship group, so hulls cannot be filtered out", () => {
  const presets = new Map(parsePresets(buildProfile(BASE).split("\n")).blocks.map((block) => [block.name, block.groups]));
  for (const name of ["NPC", "Mining", "Common", "Everything"]) {
    const groups = presets.get(name);
    assert.ok(groups, `${name} preset exists`);
    for (const id of SHIP_GROUPS) assert.ok(groups.includes(id), `${name} contains ship group ${id}`);
  }
  // Mining is Common plus the harvest-only celestials, so rocks and hulls share one tab.
  const common = new Set(presets.get("Common"));
  const extra = presets.get("Mining").filter((id) => !common.has(id));
  assert.deepEqual(extra, [450]);
});

test("every tab points at a preset that exists, in a stable order", () => {
  const built = buildProfile(BASE);
  const names = new Set(parsePresets(built.split("\n")).blocks.map((block) => block.name));
  const tabSection = built.slice(built.indexOf("tabSetup:"));
  const indices = [...tabSection.matchAll(/^- - (\d+)$/gm)].map((match) => Number(match[1]));
  assert.deepEqual(indices, TABS.map((tab) => tab.index));
  for (const tab of TABS) {
    assert.ok(names.has(tab.preset), `tab ${tab.label.trim()} -> ${tab.preset}`);
    assert.ok(tabSection.includes(`      - ${tab.preset}`) || tabSection.includes(`      - '${tab.preset}'`), `tab text maps ${tab.preset}`);
  }
  assert.ok(TABS.some((tab) => tab.label.includes("NPC")), "a dedicated NPC tab exists");
  assert.ok(TABS.some((tab) => tab.label.includes("Майнінг")), "a dedicated mining tab exists");
});

test("a degenerate export is refused instead of producing an empty sky", () => {
  const noShips = BASE.replace(preset("Common", [6, 10, 15, ...SHIP_GROUPS]), preset("Common", [6, 10, 15]));
  assert.throws(() => buildProfile(noShips), /lacks ship groups/);
  assert.throws(() => buildProfile("columnOrder:\n- 1\n"), /section presets: not found/);
});

test("verify catches a hand-edited profile that dropped a section", () => {
  const built = buildProfile(BASE);
  const broken = built.replace(/^stateBlinks:$/m, "stateBlinksX:");
  const check = verify(broken, BASE);
  assert.ok(check.problems.some((problem) => /lost top-level sections: stateBlinks/.test(problem)), check.problems.join("; "));
});
