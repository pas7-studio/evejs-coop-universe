"use strict";
// L1 hook for authored agent dialogue tokens (see integration/coopAgentDialogue.cjs).
// Env-gated and default OFF. Two single-statement insertions, both idempotent:
//   1. remember the DoAction session,
//   2. substitute the player-name token in the outgoing agentSays tuple.
const ENTER_ANCHOR = "  Handle_DoAction(args, session) {";
const APPLY_ANCHOR = [
  "  const agentSays = normalizeMarshalTuple(payload",
  '    ? payload.agentSays',
  '    : ["This agent is unavailable.", null]);',
].join("\n");
const ENTER_HOOK =
  '  if (process.env.EVEJS_COOP_AGENT_DIALOGUE === "1") { try { require("../space/coopAgentDialogue").enter(session); } catch (error) { console.warn("[CoopAgentDialogue]", error.message); } }';
const APPLY_HOOK =
  '  if (process.env.EVEJS_COOP_AGENT_DIALOGUE === "1") { try { require("../space/coopAgentDialogue").applyToTuple(agentSays); } catch (error) { console.warn("[CoopAgentDialogue]", error.message); } }';

function count(text, part) {
  return text.split(part).length - 1;
}

function patch(text, { remove = false } = {}) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const enterAnchor = ENTER_ANCHOR;
  const applyAnchor = APPLY_ANCHOR.replace(/\n/g, eol);
  const enterHook = ENTER_HOOK;
  const applyHook = APPLY_HOOK;

  if (remove) {
    if (count(text, enterHook) === 1) text = text.replace(enterHook + eol, "");
    else if (count(text, enterHook) !== 0) throw Error("Unexpected coop agent dialogue enter hook state");
    if (count(text, applyHook) === 1) text = text.replace(applyHook + eol, "");
    else if (count(text, applyHook) !== 0) throw Error("Unexpected coop agent dialogue apply hook state");
    return text;
  }

  if (count(text, enterAnchor) !== 1) {
    throw Error("Unknown agent DoAction handler anchor");
  }
  if (count(text, applyAnchor) !== 1) {
    throw Error("Unknown agent DoAction response anchor");
  }
  if (count(text, enterHook) === 0) text = text.replace(enterAnchor, enterAnchor + eol + enterHook);
  else if (count(text, enterHook) !== 1) throw Error("Duplicate coop agent dialogue enter hook");
  if (count(text, applyHook) === 0) text = text.replace(applyAnchor, applyAnchor + eol + applyHook);
  else if (count(text, applyHook) !== 1) throw Error("Duplicate coop agent dialogue apply hook");
  return text;
}

module.exports = { patch };
