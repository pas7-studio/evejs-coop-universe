import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Live regression 2026-11-03 (owner, mission details window and agent dialog):
// CCP mission text was rendered with raw mutables, e.g.
//   "Пираты установили блокаду возле скрытых звездных врат в
//    ([location]dungeonLocationID.name)"
// The shipped mission authority has 2878 missions, 1862 of them tokenised, with
// exactly 20 distinct tokens over five kinds. The single resolver below must never
// leave a token in the text it produces, even when the value is unknown.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const tokens = require(path.join(forkRoot, "Code/server/src/services/agent/missionMessageTokens.js"));

const CONTEXT = {
  player: "Sasunok1",
  agentID: "Kikui Isaki",
  agentCorpID: "State Protectorate",
  agentFactionID: "Caldari State",
  dungeonLocationID: "Perimeter VI - Moon 12",
  objectiveDestinationID: "Jita IV - Moon 4",
  objectiveTypeID: "Federation Navy Comet",
  objectiveTypeIDQuantity: 9,
  rewardTypeID: "Caldari Navy Commendation",
  rewardQuantity: 250,
  agentSolarSystemID: "Perimeter",
};

test("every measured token shape resolves with a context", () => {
  const text = [
    "[character]player.name",
    "[location]dungeonLocationID.name",
    "[character]agentID.name",
    "[npcOrganization]agentCorpID.name",
    "[location]objectiveDestinationID.name",
    "[npcOrganization]agentFactionID.nameWithArticle",
    "[item]objectiveTypeID.name",
    "[item]objectiveTypeID.quantityName",
    "[location]agentSolarSystemID.name",
    "[numeric]rewardQuantity",
    "[item]rewardTypeID.name",
  ].join(" | ");
  const out = tokens.substitute(text, CONTEXT);
  assert.deepEqual(tokens.tokenList(out), []);
  assert.match(out, /Sasunok1/);
  assert.match(out, /Perimeter VI - Moon 12/);
  assert.match(out, /the Caldari State/);
  assert.match(out, /9 x Federation Navy Comet/);
  assert.match(out, /250/);
});

test("an unknown value becomes a readable phrase, never a raw token", () => {
  const out = tokens.substitute(
    "Blockade near ([location]dungeonLocationID.name) run by ([character]agentID.name).",
    {},
  );
  assert.deepEqual(tokens.tokenList(out), []);
  assert.equal(out, "Blockade near (the designated location) run by (the assigned contact).");
});

test("text without tokens is returned unchanged", () => {
  const text = "Objective complete. Return to your agent for final debriefing.";
  assert.equal(tokens.hasTokens(text), false);
  assert.equal(tokens.substitute(text, CONTEXT), text);
});

test("context values are collected from nested mission records", () => {
  const record = {
    missionID: 875,
    killMission: { dungeonID: 213, objectiveQuantity: 0 },
    messages: { "messages.mission.briefing": { messageID: 127450 } },
  };
  const values = tokens.collectContextValues([record]);
  assert.equal(values.missionID, 875);
  assert.equal(values.dungeonID, 213);
  assert.equal(values.messageID, 127450);
});

test("resolvers only fill keys they can name", () => {
  const raw = { dungeonSolarSystemID: 30000144, objectiveTypeID: 603 };
  const values = tokens.resolveContextValues(raw, {
    nameForKey: (key) => (key === "dungeonSolarSystemID" ? "Perimeter" : ""),
  });
  assert.deepEqual(values, { dungeonSolarSystemID: "Perimeter" });
});
