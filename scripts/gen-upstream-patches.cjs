"use strict";
// One-off generator for patches/upstream/*.patch against the pinned checkout.
// It never writes to the checkout; it only reads the pinned blob, applies the
// intended edit in a temp copy and emits a unified diff with repo paths.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CHECKOUT = "C:/Games/EveCoop/upstream-evejs/Code";
const OUT = path.join(__dirname, "..", "patches", "upstream");
const tmp = path.join(process.env.TEMP || ".", "coop-patchgen");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

function pristine(rel) {
  const text = execFileSync("git", ["-C", CHECKOUT, "show", "HEAD:Code/" + rel], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return text.replace(/\r\n/g, "\n");
}
function diff(rel, before, after) {
  const a = path.join(tmp, "a.js");
  const b = path.join(tmp, "b.js");
  fs.writeFileSync(a, before);
  fs.writeFileSync(b, after);
  let out = "";
  try {
    out = execFileSync("diff", ["-u", a, b], { encoding: "utf8" });
  } catch (error) {
    if (error.status !== 1) throw error;
    out = String(error.stdout || "");
  }
  const lines = out.split("\n");
  lines[0] = "--- a/" + rel;
  lines[1] = "+++ b/" + rel;
  return lines.join("\n");
}
function replaceOnce(text, from, to, label) {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error("ANCHOR_NOT_UNIQUE:" + label + ":" + (parts.length - 1));
  return parts[0] + to + parts[1];
}

const store = "server/src/space/npc/nativeNpcStore.js";
const storeBefore = pristine(store);
const storeAfter = replaceOnce(
  storeBefore,
  "  removeNativeModule,\n  listNativeCargoForEntity,\n",
  "  removeNativeModule,\n  listNativeCargo,\n  listNativeCargoForEntity,\n",
  "store-export",
);

const svc = "server/src/space/npc/nativeNpcService.js";
const svcBefore = pristine(svc);
let svcAfter = svcBefore;
svcAfter = replaceOnce(
  svcAfter,
  '      toFiniteNumber(getTypeAttributeValue(supportHullTypeID, "capacitorCapacity"), 0),\n    );\n',
  '      toFiniteNumber(getTypeAttributeValue(supportHullTypeID, "capacitorCapacity"), 0),\n' +
    '    );\n' +
    '    entity.capacitorRechargeRate = Math.max(\n' +
    '      toFiniteNumber(entity.capacitorRechargeRate, 0),\n' +
    '      toFiniteNumber(getTypeAttributeValue(supportHullTypeID, "rechargeRate"), 0),\n' +
    '    );\n',
  "support-capacitor",
);
svcAfter = replaceOnce(
  svcAfter,
  "    entity.passiveDerivedState.maxTargetRange = entity.maxTargetRange;\n" +
    "    entity.passiveDerivedState.scanResolution = entity.scanResolution;\n" +
    "    entity.passiveDerivedState.capacitorCapacity = entity.capacitorCapacity;\n",
  "    entity.passiveDerivedState.maxTargetRange = entity.maxTargetRange;\n" +
    "    entity.passiveDerivedState.scanResolution = entity.scanResolution;\n" +
    "    entity.passiveDerivedState.capacitorCapacity = entity.capacitorCapacity;\n" +
    "    entity.passiveDerivedState.capacitorRechargeRate = entity.capacitorRechargeRate;\n",
  "support-passive",
);
svcAfter = replaceOnce(
  svcAfter,
  "  entity.capacitorCapacity = Math.max(\n    toFiniteNumber(entity.capacitorCapacity, 0),\n    dogmaCapacitorCapacity,\n  );\n",
  "  entity.capacitorCapacity = Math.max(\n    toFiniteNumber(entity.capacitorCapacity, 0),\n    dogmaCapacitorCapacity,\n  );\n" +
    "  // Native NPC hulls never received a recharge rate, so CCP passive capacitor\n" +
    "  // recharge never ran for them and a module that needs cap worked exactly once.\n" +
    "  if (toFiniteNumber(entity.capacitorRechargeRate, 0) <= 0) {\n" +
    '    entity.capacitorRechargeRate = Math.max(\n' +
    "      0,\n" +
    '      toFiniteNumber(getTypeAttributeValue(shipTypeID, "rechargeRate"), 0),\n' +
    "    );\n" +
    "  }\n",
  "dogma-capacitor",
);
svcAfter = replaceOnce(
  svcAfter,
  "    entity.passiveDerivedState.maxLockedTargets = entity.maxLockedTargets;\n" +
    "    entity.passiveDerivedState.capacitorCapacity = entity.capacitorCapacity;\n",
  "    entity.passiveDerivedState.maxLockedTargets = entity.maxLockedTargets;\n" +
    "    entity.passiveDerivedState.capacitorCapacity = entity.capacitorCapacity;\n" +
    "    entity.passiveDerivedState.capacitorRechargeRate = entity.capacitorRechargeRate;\n",
  "dogma-passive",
);

function header(number, subject, body) {
  return [
    "From: pas7std co-op <coop@pas7std.invalid>",
    "Subject: [PATCH " + number + "] " + subject,
    "",
    body,
    "",
    "Upstream base: c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f",
    "Local overlay: integration/* is NOT part of this patch series.",
    "---",
    "",
  ].join("\n");
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "0001-native-npc-store-export-list-cargo.patch"),
  header(
    "0001/0002",
    "nativeNpcStore: export listNativeCargo",
    "listNativeCargo() exists but was not exported, so no caller could enumerate\n" +
      "native cargo rows globally. Co-op restart recovery needs a read-only scan\n" +
      "(the per-entity helper cannot find rows whose entity is gone). No behaviour\n" +
      "change for existing callers.",
  ) + diff(store, storeBefore, storeAfter),
);
fs.writeFileSync(
  path.join(OUT, "0002-native-npc-capacitor-recharge.patch"),
  header(
    "0002/0002",
    "nativeNpcService: give native NPC hulls a capacitor recharge rate",
    "Native NPC entities received capacitorCapacity but never capacitorRechargeRate,\n" +
      "so the CCP passive recharge loop in runtime.js (which requires a positive\n" +
      "recharge rate) never ran for them. A cap-hungry module such as a strip miner\n" +
      "could activate once and then failed with NOT_ENOUGH_CAPACITOR forever.\n" +
      "\n" +
      "The rate is taken from the same hull dogma attribute the fitting service uses,\n" +
      "so NPCs recharge like real ships at the same non-linear CCP curve. This is a\n" +
      "native fix for a native omission; it does not add a co-op timer or grant\n" +
      "capacitor out of thin air.",
  ) + diff(svc, svcBefore, svcAfter),
);
console.log("WROTE", fs.readdirSync(OUT).join(", "));



// --- 0003: sessionless native NPC capacitor advance -------------------------
const loop = "server/src/space/npc/npcBehaviorLoop.js";
const loopBefore = pristine(loop);
let loopAfter = replaceOnce(
  loopBefore,
  "    if (toFiniteNumber(controller.nextThinkAtMs, 0) > now) {\n      continue;\n    }\n    tickController(scene, controller, now);\n    processed += 1;\n",
  "    if (toFiniteNumber(controller.nextThinkAtMs, 0) > now) {\n      continue;\n    }\n    advanceSessionlessCapacitor(scene.getEntityByID(controller.entityID), now);\n    tickController(scene, controller, now);\n    processed += 1;\n",
  "loop-main",
);
loopAfter = replaceOnce(
  loopAfter,
  "    tickController(scene, controller, now);\n  }\n}\n",
  "    advanceSessionlessCapacitor(scene.getEntityByID(controller.entityID), now);\n    tickController(scene, controller, now);\n  }\n}\n",
  "loop-secondary",
);
loopAfter = replaceOnce(
  loopAfter,
  "module.exports = {\n",
  [
    "// CCP non-linear capacitor recharge (dC/dt = (10*Cmax/tau)*(sqrt(r)-r)) for a",
    "// native NPC that has no session. runtime.js advances capacitor only inside",
    "// active module cycle bookkeeping, so an idle NPC never recovered and a",
    "// cap-hungry module could activate exactly once. The same curve is used, with",
    "// the 1% floor CCP keeps so a fully drained ship still recovers.",
    "function advanceSessionlessCapacitor(entity, now) {",
    "  if (!entity || entity.kind !== \"ship\" || entity.session) {",
    "    return;",
    "  }",
    "  const capacity = toFiniteNumber(entity.capacitorCapacity, 0);",
    "  const tauMs = toFiniteNumber(entity.capacitorRechargeRate, 0);",
    "  if (capacity <= 0 || tauMs <= 0 || !Number.isFinite(Number(now))) {",
    "    return;",
    "  }",
    "  const previousAtMs = toFiniteNumber(entity.capacitorRechargedAtMs, 0);",
    "  entity.capacitorRechargedAtMs = now;",
    "  if (previousAtMs <= 0 || now <= previousAtMs) {",
    "    return;",
    "  }",
    "  const dtSeconds = Math.min(5000, now - previousAtMs) / 1000;",
    "  const tauSeconds = tauMs / 1000;",
    "  let ratio = Math.min(1, Math.max(0, toFiniteNumber(entity.capacitorChargeRatio, 1)));",
    "  if (ratio >= 1) {",
    "    return;",
    "  }",
    "  const steps = Math.max(1, Math.ceil(dtSeconds));",
    "  const stepSeconds = dtSeconds / steps;",
    "  for (let step = 0; step < steps && ratio < 1; step += 1) {",
    "    const bounded = Math.max(0.01, ratio);",
    "    ratio += ((10 / tauSeconds) * (Math.sqrt(bounded) - bounded)) * stepSeconds;",
    "  }",
    "  entity.capacitorChargeRatio = Math.min(1, Math.max(0, ratio));",
    "  if (entity.conditionState && typeof entity.conditionState === \"object\") {",
    "    entity.conditionState.charge = entity.capacitorChargeRatio;",
    "  }",
    "}",
    "",
    "module.exports = {\n",
  ].join("\n"),
  "loop-helper",
);
fs.writeFileSync(
  path.join(OUT, "0003-native-npc-sessionless-capacitor.patch"),
  header(
    "0003/0003",
    "npcBehaviorLoop: recharge native NPC capacitor without a session",
    "Patch 0002 gives NPC hulls a real recharge rate, but the only place that",
    "advances capacitor is runtime.js module-cycle bookkeeping. A native NPC has no",
    "session and, after its first activation, no active cycle, so nothing ever",
    "ticked its capacitor: a strip miner activated once and then failed with",
    "NOT_ENOUGH_CAPACITOR forever. Advance the same CCP curve in the NPC controller",
    "tick, which already runs for every controller.",
  ) + diff(loop, loopBefore, loopAfter),
);
console.log("WROTE 0003");
