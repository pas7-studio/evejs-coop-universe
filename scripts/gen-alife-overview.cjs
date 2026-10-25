"use strict";
// Build the co-op overview profile from a real client export.
//
// Why: the client decides what is visible by *preset group lists*, not by
// faction. Pirate/miner hulls are ordinary ship groups (25 frigate .. 31
// battleship), so a tab whose preset omits them shows an empty sky even
// though the server really spawned the NPCs.
//
// This script clones the group list of a preset that does include every ship
// group ("Common") into dedicated NPC and Mining presets, and rewrites the tab
// labels. Everything else (columns, states, bracket filters) is copied from
// the export untouched, so the import cannot break the client.
const fs = require("node:fs");
const path = require("node:path");

const SHIP_GROUPS = [25, 26, 27, 28, 29, 30, 31];

const TABS = [
  { index: 0, label: " Подорож ", fontSize: 12, color: "0xFF33FF99", preset: "Travel" },
  { index: 1, label: " Загальне ", fontSize: 12, color: "0xFF3399FF", preset: "Common" },
  { index: 2, label: " NPC / Пірати ", fontSize: 12, color: "0xFFFF3300", preset: "NPC" },
  { index: 3, label: " Цілі ", fontSize: 12, color: "0xFFFF6699", preset: "Targets" },
  { index: 4, label: " Дрони / заряди ", fontSize: 12, color: "0xFF9966FF", preset: "Targets: Charges/Drones" },
  { index: 5, label: " Небесні ", fontSize: 12, color: "0xFF99FF00", preset: "Celestial" },
  { index: 6, label: " Лут ", fontSize: 12, color: "0xFFFF9933", preset: "Loot" },
  { index: 7, label: " Майнінг ", fontSize: 12, color: "0xFF00CCFF", preset: "Mining" },
  { index: 8, label: " Все ", fontSize: 18, color: "0xFFFFFFFF", preset: "Everything" },
];

function splitLines(text) {
  return String(text).replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
}

function sectionRange(lines, name) {
  const start = lines.indexOf(`${name}:`);
  if (start < 0) throw new Error(`section ${name}: not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[A-Za-z]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function parsePresets(lines) {
  const { start, end } = sectionRange(lines, "presets");
  const blocks = [];
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i];
    if (line.startsWith("- - ")) {
      blocks.push({ name: line.slice(4).trim().replace(/^'|'$/g, ""), lines: [line] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  for (const block of blocks) block.groups = groupsOf(block.lines);
  return { start, end, blocks };
}

function groupsOf(blockLines) {
  const at = blockLines.indexOf("    - - groups");
  if (at < 0) return [];
  const ids = [];
  for (let i = at + 1; i < blockLines.length; i += 1) {
    const line = blockLines[i];
    if (/^    - - /.test(line) || line.startsWith("- - ")) break;
    const match = line.match(/^\s+(?:-\s+)+(\d+)$/);
    if (match) {
      ids.push(Number(match[1]));
      continue;
    }
    if (!line.trim()) continue;
    break;
  }
  return ids;
}

function appendGroups(blockLines, extra) {
  const out = blockLines.slice();
  const at = out.indexOf("    - - groups");
  if (at < 0) throw new Error("preset has no groups list");
  let last = at;
  for (let i = at + 1; i < out.length; i += 1) {
    if (/^    - - /.test(out[i]) || out[i].startsWith("- - ")) break;
    last = i;
  }
  const present = new Set(groupsOf(blockLines));
  const batch = extra.filter((id) => !present.has(id)).map((id) => `        - ${id}`);
  if (!batch.length) return out;
  out.splice(last + 1, 0, ...batch);
  return out;
}

function clonePreset(block, name, extraGroups = []) {
  const lines = block.lines.slice();
  lines[0] = "- - " + name;
  return { name, lines: appendGroups(lines, extraGroups), groups: groupsOf(appendGroups(lines, extraGroups)) };
}

// Replace a preset's group list outright. Appending cannot express "ships only",
// because the source externalises gates/belts/stations/billboards as groups too.
function presetWithGroups(block, name, groups) {
  const lines = block.lines.slice();
  lines[0] = "- - " + name;
  const at = lines.indexOf("    - - groups");
  if (at < 0) throw new Error("preset has no groups list");
  let end = at + 1;
  while (end < lines.length && !/^    - - /.test(lines[end]) && !lines[end].startsWith("- - ")) end += 1;
  const unique = [...new Set(groups.map(Number))];
  const body = [`      - - ${unique[0]}`, ...unique.slice(1).map((id) => `        - ${id}`)];
  const out = [...lines.slice(0, at + 1), ...body, ...lines.slice(end)];
  return { name, lines: out, groups: unique };
}

function tabBlock(tab) {
  const quoted = /[:#]/.test(tab.preset) ? `'${tab.preset}'` : tab.preset;
  return [
    `- - ${tab.index}`,
    "  - - - bracket",
    "      - null",
    "    - - color",
    "      - null",
    "    - - name",
    `      - <color=${tab.color}><fontsize=${tab.fontSize}>${tab.label}</fontsize></color>`,
    "    - - overview",
    `      - ${quoted}`,
  ];
}

function buildProfile(baseText) {
  const lines = splitLines(baseText);
  const presets = parsePresets(lines);
  const byName = new Map(presets.blocks.map((block) => [block.name, block]));

  const source = byName.get("Common") || byName.get("Everything");
  if (!source) throw new Error("base export has neither Common nor Everything preset");
  const missing = SHIP_GROUPS.filter((id) => !source.groups.includes(id));
  if (missing.length) throw new Error(`source preset ${source.name} lacks ship groups ${missing.join(",")}`);

  const harvest = byName.get("Harvest");
  const extra = harvest ? harvest.groups.slice() : [];

  const blocks = presets.blocks.map((block) => block.lines);
  if (!byName.has("NPC")) blocks.push(clonePreset(source, "NPC").lines);
  if (!byName.has("Mining")) blocks.push(clonePreset(source, "Mining", extra).lines);

  const head = lines.slice(0, presets.start + 1);
  const tabRange = sectionRange(lines, "tabSetup");
  const middle = lines.slice(presets.end, tabRange.start);
  const tail = lines.slice(tabRange.end);
  const tabs = [];
  for (const tab of TABS) tabs.push(...tabBlock(tab));

  return [...head, ...blocks.flat(), ...middle, "tabSetup:", ...tabs, ...tail].join("\n");
}

// Minimal variant: keep the owner's presets and tabs exactly as exported and
// only ADD one preset plus one tab bound to it. Renaming or reordering tabs is
// what made the first attempt appear empty in the client.
//
// The added preset lists SHIP GROUPS ONLY (SDE category 6), because a preset
// cloned from "Common" also carried stargates, billboards, belts and stations:
// an "NPC / Pirates" tab must show hulls, not the whole system.
function shipGroupIds() {
  const data = require("./overview-ship-groups.json");
  if (!data || !Array.isArray(data.groups) || !data.groups.length) throw new Error("overview-ship-groups.json is empty");
  return data.groups.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
}

function buildMinimal(baseText, { presetName = "NPC (all ships)", label = " NPC / Пірати ", groups = null } = {}) {
  const lines = splitLines(baseText);
  const presets = parsePresets(lines);
  const byName = new Map(presets.blocks.map((block) => [block.name, block]));
  const source = byName.get("Common") || byName.get("Everything");
  if (!source) throw new Error("base export has neither Common nor Everything preset");
  const wanted = Array.isArray(groups) && groups.length ? groups.map(Number) : shipGroupIds();
  const hullGroups = wanted.filter((id) => Number.isSafeInteger(id) && id > 0);

  const blocks = presets.blocks.map((block) => block.lines);
  if (!byName.has(presetName)) blocks.push(presetWithGroups(source, presetName, hullGroups).lines);

  const tabRange = sectionRange(lines, "tabSetup");
  const existingTabs = [];
  for (let i = tabRange.start + 1; i < tabRange.end; i += 1) {
    if (lines[i].startsWith("- - ")) existingTabs.push(Number(lines[i].slice(4)));
  }
  const nextIndex = existingTabs.length ? Math.max(...existingTabs) + 1 : 0;
  const newTab = tabBlock({
    index: nextIndex,
    label,
    fontSize: 12,
    color: "0xFFFF3300",
    preset: presetName,
  }).map((line) => line.replace(/^- - \d+$/, `- - ${nextIndex}`));

  const head = lines.slice(0, presets.start + 1);
  const middle = lines.slice(presets.end, tabRange.start);
  const tail = lines.slice(tabRange.end);
  return [
    ...head,
    ...blocks.flat(),
    ...middle,
    "tabSetup:",
    ...lines.slice(tabRange.start + 1, tabRange.end),
    ...newTab,
    ...tail,
  ].join("\n");
}

function verifyMinimal(text, baseText, { presetName = "NPC (all ships)", label = " NPC / Пірати ", groups = null } = {}) {
  const problems = [];
  const expected = Array.isArray(groups) && groups.length ? groups.map(Number) : shipGroupIds();
  const base = parsePresets(splitLines(baseText));
  const out = parsePresets(splitLines(text));
  // Every original preset must survive byte-identical in name and group list.
  for (const block of base.blocks) {
    const same = out.blocks.find((entry) => entry.name === block.name);
    if (!same) problems.push(`lost preset ${block.name}`);
    else if (same.groups.join(",") !== block.groups.join(",")) problems.push(`changed groups of ${block.name}`);
  }
  const added = out.blocks.filter((block) => !base.blocks.some((entry) => entry.name === block.name));
  if (added.length !== 1) problems.push(`expected exactly one new preset, got ${added.length}`);
  else {
    const got = added[0].groups.slice().sort((a, b) => a - b);
    const want = [...new Set(expected)].sort((a, b) => a - b);
    if (got.join(",") !== want.join(",")) {
      const extra = got.filter((id) => !want.includes(id));
      const missing = want.filter((id) => !got.includes(id));
      problems.push(
        `new preset group mismatch (extra: ${extra.slice(0, 8).join(",") || "none"}; missing: ${missing.slice(0, 8).join(",") || "none"})`,
      );
    }
    if (added[0].name !== presetName) problems.push(`new preset is named ${added[0].name}`);
  }
  // Tabs: all original index<->overview pairs must be untouched.
  const baseTabs = tabPairs(splitLines(baseText));
  const outTabs = tabPairs(splitLines(text));
  for (const [index, preset] of baseTabs) {
    const hit = outTabs.find(([outIndex]) => outIndex === index);
    if (!hit) problems.push(`lost tab ${index}`);
    else if (hit[1] !== preset) problems.push(`tab ${index} moved from ${preset} to ${hit[1]}`);
  }
  if (outTabs.length !== baseTabs.length + 1) problems.push(`expected one extra tab, got ${outTabs.length - baseTabs.length}`);
  const newTab = outTabs.find(([index]) => !baseTabs.some(([baseIndex]) => baseIndex === index));
  if (newTab && newTab[1] !== presetName) problems.push(`new tab points at ${newTab[1]}`);
  if (!text.includes(label.replace(/^\s+|\s+$/g, ""))) problems.push("new tab label missing");
  const lostKeys = topLevelKeys(baseText).filter((key) => !topLevelKeys(text).includes(key));
  if (lostKeys.length) problems.push(`lost top-level sections: ${lostKeys.join(", ")}`);
  return { problems, baseTabs, outTabs };
}

function tabPairs(lines) {
  const { start, end } = sectionRange(lines, "tabSetup");
  const pairs = [];
  let current = null;
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i];
    if (line.startsWith("- - ")) {
      if (current) pairs.push(current);
      current = [Number(line.slice(4)), ""];
      continue;
    }
    if (current && /^\s+- \S/.test(line) && lines[i - 1] && /overview$/.test(lines[i - 1])) {
      current[1] = line.replace(/^\s+- /, "").replace(/^'|'$/g, "");
    }
  }
  if (current) pairs.push(current);
  return pairs;
}

function topLevelKeys(text) {
  return splitLines(text).filter((line) => /^[A-Za-z][A-Za-z0-9_]*:/.test(line)).map((line) => line.slice(0, line.indexOf(":")));
}

function verify(text, baseText) {
  const lines = splitLines(text);
  const presets = parsePresets(lines);
  const names = new Set(presets.blocks.map((block) => block.name));
  const problems = [];
  if (baseText) {
    const before = topLevelKeys(baseText);
    const after = new Set(topLevelKeys(text));
    const lost = before.filter((key) => !after.has(key));
    if (lost.length) problems.push(`lost top-level sections: ${lost.join(", ")}`);
    if (after.size !== new Set(before).size) {
      problems.push(`section count changed: ${before.length} -> ${after.size}`);
    }
  }
  for (const block of presets.blocks) {
    if (/^(NPC|Mining|Common|Everything)$/.test(block.name)) {
      const missing = SHIP_GROUPS.filter((id) => !block.groups.includes(id));
      if (missing.length) problems.push(`preset ${block.name} misses ship groups ${missing.join(",")}`);
    }
  }
  const tabs = [];
  const { start, end } = sectionRange(lines, "tabSetup");
  for (let i = start + 1; i < end; i += 1) {
    if (lines[i].startsWith("- - ")) tabs.push(Number(lines[i].slice(4)));
  }
  const expected = TABS.map((tab) => tab.index);
  if (tabs.join(",") !== expected.join(",")) problems.push(`tab indices ${tabs.join(",")} != ${expected.join(",")}`);
  for (const tab of TABS) {
    if (!names.has(tab.preset)) problems.push(`tab ${tab.label.trim()} points at missing preset ${tab.preset}`);
  }
  const text2 = text.join ? text.join("\n") : String(text);
  for (const tab of TABS) {
    if (!text2.includes(tab.preset)) problems.push(`preset ${tab.preset} unreachable from tab text`);
  }
  return { problems, presetNames: [...names], tabs, shipPresets: presets.blocks.filter((b) => SHIP_GROUPS.every((id) => b.groups.includes(id))).map((b) => b.name) };
}

function main(argv) {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const mode = argv.includes("--minimal") ? "minimal" : "full";
  const rest = argv.filter((arg) => !arg.startsWith("--"));
  const basePath = rest[0] || path.join(home, "Documents", "EVE", "Overview", "alife-base.yaml");
  const outPath = rest[1] || path.join(home, "Documents", "EVE", "Overview", mode === "minimal" ? "alife-npc.yaml" : "alife.yaml");
  const baseText = fs.readFileSync(basePath, "utf8");
  if (mode === "minimal") {
    const built = buildMinimal(baseText);
    const check = verifyMinimal(built, baseText);
    if (check.problems.length) {
      console.error("refusing to write an invalid profile:\n  " + check.problems.join("\n  "));
      process.exit(1);
    }
    fs.writeFileSync(outPath, built, "utf8");
    console.log(`wrote ${outPath} (${Buffer.byteLength(built, "utf8")} bytes)`);
    console.log(`tabs: ${check.baseTabs.length} kept + 1 added -> ${check.outTabs.map(([i, p]) => `${i}:${p}`).join(", ")}`);
    return { outPath, check };
  }
  const built = buildProfile(baseText);
  const check = verify(built, baseText);
  if (check.problems.length) {
    console.error("refusing to write an invalid profile:\n  " + check.problems.join("\n  "));
    process.exit(1);
  }
  fs.writeFileSync(outPath, built, "utf8");
  console.log(`wrote ${outPath} (${Buffer.byteLength(built, "utf8")} bytes)`);
  console.log(`presets with all ship groups: ${check.shipPresets.join(", ")}`);
  console.log(`tabs: ${check.tabs.length}`);
  for (const tab of TABS) console.log(`  [${tab.index}] ${tab.label.trim()} -> ${tab.preset}`);
  return { outPath, check };
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  buildProfile,
  buildMinimal,
  verify,
  verifyMinimal,
  parsePresets,
  groupsOf,
  tabPairs,
  TABS,
  SHIP_GROUPS,
};
