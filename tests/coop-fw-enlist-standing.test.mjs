// FW-096 guard: enlistment can require the SECOND reputation level.
//
// Owner decision 2026-10-30: "вступ у війну з 2-ї репи, а не з нуля". Native
// Factional Warfare treats a raw 0.0 standing as eligible, which let a fresh pilot
// join a war the world had to fund before farming anything. The rule is one env
// knob (EVEJS_COOP_FW_ENLIST_MIN_STANDING) whose DEFAULT is still 0 - exactly the
// native behaviour - so the change is opt-in and nothing else moves.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const gate = require("../integration/coopFwEnlistmentGate.cjs");

const SESSION = { characterID: 140000005, corporationID: 1000120 };
const CHARACTER = { characterID: 140000005, corporationID: 1000120, directFactionID: 0 };
const CORPORATION = { corporationID: 1000120, isNPC: true };
const NOW = 133000000000000000n;               // FileTime, well past any cooldown
const invoke = (standing, env) => gate.validateDirect({
  session: SESSION, factionID: 500001, characterID: 140000005,
  character: CHARACTER, corporation: CORPORATION, corpRuntime: null,
  standing, nowFiletime: NOW, env });

test("the station measured today: 1.553 raw Caldari standing", () => {
  // Owner's own character 140000005 in the play stack: raw = effective = 1.553.
  assert.equal(invoke(1.553, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "2" }).ok, false);
  assert.equal(invoke(1.553, {}).ok, true, "the native default still accepts it");
  assert.equal(invoke(2, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "2" }).ok, true);
  assert.equal(invoke(1.999, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "2" }).ok, false);
});

test("the refusal names the required level instead of only saying no", () => {
  const refused = invoke(1.553, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "2" });
  assert.equal(refused.error, "FW_RAW_FACTION_STANDING_TOO_LOW");
  assert.equal(refused.required, 2);
  assert.equal(refused.standing, 1.553);
});

test("0 restores the native rule and a broken knob never becomes stricter or looser by accident", () => {
  assert.equal(invoke(0, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "0" }).ok, true);
  assert.equal(invoke(0, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "" }).ok, true);
  assert.equal(invoke(0, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "not-a-number" }).ok, true);
  assert.equal(gate.minEnlistStanding({}), 0);
  assert.equal(gate.minEnlistStanding({ EVEJS_COOP_FW_ENLIST_MIN_STANDING: "2" }), 2);
  assert.equal(gate.minEnlistStanding({ EVEJS_COOP_FW_ENLIST_MIN_STANDING: "bad" }), 0);
});

test("a negative standing is still refused whatever the knob says", () => {
  assert.equal(invoke(-0.5, { EVEJS_COOP_FW_ENLIST_MIN_STANDING: "-5" }).ok, false);
  assert.equal(invoke(Number.NaN, {}).ok, false);
});
