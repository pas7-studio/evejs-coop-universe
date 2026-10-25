"use strict";
// Add one reversible, default-OFF guard inside pinned native anomaly completion.
// Chat 01 owns the sole transactional scripts/patch-evejs-coop.cjs installer.
const FILE = "server/src/services/dungeon/dungeonUniverseSiteService.js";
const OPEN = "function maybeCompleteClearedEncounterSite(instance, populationHints, options = {}) {";
const NEXT = "function isDataRelicUniverseSignatureInstance(instance) {";
const PLAN = "  const plans = resolveEncounterPlans(populationHints);";
const CONTEXT = 'normalizeLowerText(instance && instance.lifecycleState, "") !== "active"';
const HOOK = '  if (process.env.EVEJS_COOP_NATIVE_PVE_OBJECTIVE_GUARD === "1" && !require("../../space/coopNativePveObjectiveGuard").canCompleteAnomaly(instance, populationHints)) return false;';
const count = (haystack, needle) => haystack.split(needle).length - 1;
function patch(source, file, {remove = false} = {}) {
  if (file !== FILE || typeof source !== "string") throw Error("PVE_UNSUPPORTED_PINNED_SOURCE");
  if (count(source, OPEN) !== 1 || count(source, NEXT) !== 1)
    throw Error("PVE_PINNED_CONTEXT_MISMATCH");
  const start = source.indexOf(OPEN);
  const end = source.indexOf(NEXT, start + OPEN.length);
  if (end < start) throw Error("PVE_PINNED_FUNCTION_ORDER_MISMATCH");
  const fragment = source.slice(start, end);
  if (!fragment.includes(CONTEXT) || count(fragment, PLAN) !== 1 ||
      count(fragment, HOOK) > 1 ||
      (fragment.includes("EVEJS_COOP_NATIVE_PVE_OBJECTIVE_GUARD") &&
       !fragment.includes(HOOK))) throw Error("PVE_PINNED_ANCHOR_MISMATCH");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const insertion = HOOK + eol;
  if (remove) {
    if (!fragment.includes(insertion)) return source;
    return source.slice(0, start) + fragment.replace(insertion, "") + source.slice(end);
  }
  if (fragment.includes(insertion)) return source;
  const insertionPoint = fragment.indexOf(PLAN);
  return source.slice(0, start) + fragment.slice(0, insertionPoint) + insertion +
    fragment.slice(insertionPoint) + source.slice(end);
}
module.exports = {patch, FILE, OPEN, HOOK};
