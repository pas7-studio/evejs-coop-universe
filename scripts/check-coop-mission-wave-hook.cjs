"use strict";
// Local, read-only proof that the coopMissionWavePacing hook can be inserted:
// the anchor exists exactly once in the pinned file, the inserted line parses,
// and the module it requires is registered for installation.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const CODE = process.argv[2] || "C:\\Games\\EveCoop\\upstream-evejs\\Code";

const spec = require(path.join(ROOT, "scripts", "overlay-spec.cjs"));
const entry = spec.specs.find((item) => item.file === "server/src/services/dungeon/dungeonUniverseSiteService.js");
if (!entry) throw new Error("HOOK_ENTRY_MISSING");
const patch = (entry.patches || []).find((item) => String(item.line).includes("coopMissionWavePacing"));
if (!patch) throw new Error("HOOK_LINE_MISSING");

const file = path.join(CODE, entry.file);
const text = fs.readFileSync(file, "utf8");
const occurrences = text.split(patch.anchor).length - 1;
if (occurrences !== 1) throw new Error("ANCHOR_COUNT " + occurrences);

// The inserted line must parse on its own; it may reference only names the
// enclosing function really has.
// eslint-disable-next-line no-new-func
new Function("scene", "instance", "encounterPlan", "spawnResult", "nowMs", "totalWaves", "dungeonRuntime", patch.line);

if (!spec.names.includes("coopMissionWavePacing")) throw new Error("MODULE_NOT_REGISTERED");
if (!fs.existsSync(path.join(ROOT, "integration", "coopMissionWavePacing.cjs"))) throw new Error("MODULE_FILE_MISSING");

console.log("HOOK_OK anchor=1 module=coopMissionWavePacing entry=" + entry.file);
