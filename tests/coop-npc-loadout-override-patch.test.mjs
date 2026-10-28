import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const ROOT=path.join(import.meta.dirname,"..");
const SERIES=path.join(ROOT,"patches","upstream");
const MANIFEST=JSON.parse(fs.readFileSync(path.join(SERIES,"MANIFEST.json"),"utf8"));
const FILE="0007-npc-loadout-override.patch";
const patch=fs.readFileSync(path.join(SERIES,FILE),"utf8");
const entry=MANIFEST.patches.find(p=>p.file===FILE);

test("the loadout override patch is pinned in the series with its real hash",()=>{
 assert.ok(entry,"0007 must be listed in MANIFEST.json");
 const digest=crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(SERIES,FILE))).digest("hex");
 assert.equal(entry.sha256,digest);
 // Since 2026-10-28 the change ships in pas7-studio/EveJS and the file is kept
 // as a proposal diff; the manifest records that state as "in-fork".
 assert.equal(entry.status,"in-fork");
 assert.equal(MANIFEST.pin,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
 assert.ok(patch.includes("Upstream base: "+MANIFEST.pin));
});
test("the patch touches exactly the three definition files and never a stacked one",()=>{
 assert.deepEqual(entry.files,[
  "server/src/space/npc/npcData.js",
  "server/src/space/npc/npcSelection.js",
  "server/src/space/npc/npcService.js",
 ]);
 // One patch per file: 0002 already owns nativeNpcService.js, so a second patch
 // for it could never be verified by the applier.
 const stacked=MANIFEST.patches.filter(p=>p.file!==FILE)
  .flatMap(p=>p.files||[]);
 for(const file of entry.files)assert.ok(!stacked.includes(file),
  file+" is already owned by another patch in the series");
 const headers=[...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m=>m[1]);
 assert.deepEqual(headers,entry.files);
});
test("the option is threaded from the spawn call into every definition builder",()=>{
 assert.ok(patch.includes("+function buildNpcDefinition(profileID, options = {}) {"));
 assert.ok(patch.includes("+function getCachedNpcDefinition(profileID, definitionCache, loadoutID = \"\") {"));
 assert.ok(patch.includes("+    ? buildNpcDefinition(normalizedProfileID, { loadoutID: normalizedLoadoutID })"));
 assert.ok(patch.includes("+    loadoutID: String(options.loadoutID || \"\"),"),
  "npcService.resolveBatchSelection must forward the option");
 const forwards=[...patch.matchAll(/^\+ +loadoutID,$/gm)].length;
 assert.ok(forwards>=8,"every resolveNpcSpawnPlan option literal must forward it, got "+forwards);
});
test("retail behaviour is unchanged when the option is absent",()=>{
 // The profile's own row stays the only source without the option, and a named
 // row that does not exist must fail instead of silently using the retail one.
 assert.ok(patch.includes("-  const loadoutRow = findRawByID(NPC_TABLE.LOADOUTS, profileRow.loadoutID);"));
 assert.ok(patch.includes("+    : findRawByID(NPC_TABLE.LOADOUTS, profileRow.loadoutID);"));
 assert.ok(patch.includes("+    ? findRawByID(NPC_TABLE.LOADOUTS, requestedLoadoutID)"));
 assert.ok(!/requestedLoadoutID\s*\|\|\s*profileRow\.loadoutID/.test(patch),
  "a missing override must not fall back to the retail row");
 assert.ok(patch.includes("-    return definitionCache.get(normalizedProfileID);"),
  "the unoverridden cache path must be replaced by the keyed one");
});
test("the coop patrol loadout module is part of the deployed overlay",()=>{
 const spec=require(path.join(ROOT,"scripts","overlay-spec.cjs"));
 assert.ok(spec.names.includes("coopWarPatrolLoadout"));
 assert.ok(fs.existsSync(path.join(ROOT,"integration","coopWarPatrolLoadout.cjs")));
});
