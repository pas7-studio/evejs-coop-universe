"use strict";
// Concern-specific reversible transformer. Chat 01 owns installer wiring.
// Single-statement source replacements are exact, source-bounded and default
// OFF. The original native implementation is returned without its flag.
const targets = Object.freeze({
  "server/src/space/modules/hostileModuleRuntime.js": Object.freeze([
    [
      "  return sourceCapAmount + 1e-6 < targetCapAmount;",
      '  return process.env.EVEJS_COOP_NATIVE_EWAR_CORRECTIONS === "1" ? require("../coopEwarDogmaCorrections").nosTransferAllowed(sourceEntity, targetEntity, callbacks) : sourceCapAmount + 1e-6 < targetCapAmount;'
    ]
  ]),
  "server/src/space/modules/assistanceModuleRuntime.js": Object.freeze([
    [
      "        appliedAmount: roundNumber(shieldBonusAmount, 6),",
      '        appliedAmount: process.env.EVEJS_COOP_NATIVE_EWAR_CORRECTIONS === "1" ? require("../coopEwarDogmaCorrections").actualRemoteRepairAmount("remoteShield", previousConditionState, targetEntity) : roundNumber(shieldBonusAmount, 6),'
    ],
    [
      "        appliedAmount: roundNumber(armorRepairAmount, 6),",
      '        appliedAmount: process.env.EVEJS_COOP_NATIVE_EWAR_CORRECTIONS === "1" ? require("../coopEwarDogmaCorrections").actualRemoteRepairAmount("remoteArmor", previousConditionState, targetEntity) : roundNumber(armorRepairAmount, 6),'
    ],
    [
      "        appliedAmount: roundNumber(hullRepairAmount, 6),",
      '        appliedAmount: process.env.EVEJS_COOP_NATIVE_EWAR_CORRECTIONS === "1" ? require("../coopEwarDogmaCorrections").actualRemoteRepairAmount("remoteHull", previousConditionState, targetEntity) : roundNumber(hullRepairAmount, 6),'
    ]
  ])
});
function count(text, needle) { return text.split(needle).length - 1; }
function patchEwarDogma(source, filePath, {remove = false} = {}) {
  if (typeof source !== "string" || typeof filePath !== "string")
    throw Error("EWAR_SOURCE_INVALID");
  const entries = targets[filePath];
  if (!entries) throw Error("EWAR_UNSUPPORTED_NATIVE_FILE");
  const contextMarker = filePath.includes("hostileModule")
    ? "function resolveNosTransferAllowed(sourceEntity, targetEntity, effectState, callbacks = {}) {"
    : "function executeAssistanceModuleCycle({";
  if (count(source, contextMarker) !== 1)
    throw Error("EWAR_PINNED_NATIVE_CONTEXT_MISMATCH");
  let result = source;
  for (const [oldLine, newLine] of entries) {
    const oldCount = count(result, oldLine);
    const newCount = count(result, newLine);
    if (oldCount + newCount !== 1)
      throw Error("EWAR_NATIVE_ANCHOR_MISMATCH");
    if (remove && newCount === 1) result = result.replace(newLine, oldLine);
    if (!remove && oldCount === 1) result = result.replace(oldLine, newLine);
  }
  return result;
}
module.exports = {patchEwarDogma, targets};
