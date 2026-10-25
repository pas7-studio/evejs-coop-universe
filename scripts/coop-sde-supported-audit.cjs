#!/usr/bin/env node
"use strict";
/**
 * CHAT-37: read-only SDE/native snapshot compatibility audit.
 * No installation, data import, balance mutation, asset authorisation or UI claim.
 * Original CCP JSONL rows use _key; native itemTypeRegistry snapshot uses typeID.
 */
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createHash } = require("node:crypto");
const REQUIRED = Object.freeze(["types", "groups", "categories", "marketGroups", "typeDogma", "dogmaAttributes", "dogmaEffects"]);
const GOOD_KEY = value => Number.isSafeInteger(value) && value > 0;
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function readJsonl(filename, { idField = "_key", allowMissing = false, include = null } = {}) {
  let stat;
  try { stat = fs.lstatSync(filename); }
  catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200 * 1024 * 1024)
    throw Error("UNSAFE_SDE_FILE:" + filename);
  const found = new Map(), seen = new Set();
  const input = fs.createReadStream(filename, { encoding: "utf8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of reader) {
      lineNumber++;
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); } catch { throw Error(`BAD_JSONL:${path.basename(filename)}:${lineNumber}`); }
      if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(value[idField]) ||
          (idField === "typeID" ? value[idField] <= 0 : value[idField] < 0))
        throw Error(`INVALID_KEY:${path.basename(filename)}:${lineNumber}`);
      const key = value[idField];
      if (seen.has(key)) throw Error(`DUPLICATE_KEY:${path.basename(filename)}:${key}`);
      seen.add(key);
      if (!include || include.has(key)) found.set(key, value);
    }
  } finally { reader.close(); input.destroy(); }
  return { rows: found, total: seen.size, checksum: fingerprint([...found.keys()].sort((a,b)=>a-b)) };
}
function issue(list, severity, typeID, code, detail = null) {
  list.push({ severity, typeID, code, ...(detail ? { detail } : {}) });
}
const stringName = raw => typeof raw === "string" ? raw : (typeof raw?.en === "string" ? raw.en : "");
const val = value => Number.isFinite(Number(value)) ? Number(value) : null;
const optionalNumber = (obj,key) => obj?.[key] === null || obj?.[key] === undefined ? null : val(obj[key]);
const asDogmaAttrs = row => {
  const attributes = row?.dogmaAttributes;
  if (!Array.isArray(attributes)) return null;
  const result = new Map();
  for (const entry of attributes) {
    if (!GOOD_KEY(entry?.attributeID) || typeof entry.value !== "number" || !Number.isFinite(entry.value) || result.has(entry.attributeID))
      return null;
    result.set(entry.attributeID, entry.value);
  }
  return result;
};
const asDogmaEffects = row => {
  const effects = row?.dogmaEffects ?? [];
  if (!Array.isArray(effects)) return null;
  const result = new Map();
  for (const entry of effects) {
    if (!GOOD_KEY(entry?.effectID) || typeof entry.isDefault !== "boolean" || result.has(entry.effectID)) return null;
    result.set(entry.effectID, entry.isDefault);
  }
  return result;
};
const limitIssues = (issues, max = 150) => ({ count: issues.length, examples: issues.slice(0,max) });

async function audit({sdeDir, nativeItemsFile, nativeDogmaFile = null} = {}) {
  if (![sdeDir, nativeItemsFile].every(x => typeof x === "string" && x && path.isAbsolute(x)))
    throw Error("ABSOLUTE_SDE_AND_NATIVE_PATHS_REQUIRED");
  if (!fs.statSync(fs.realpathSync(sdeDir)).isDirectory()) throw Error("SDE_DIRECTORY_REQUIRED");
  const native = await readJsonl(nativeItemsFile, {idField:"typeID"});
  const nativeDogma = nativeDogmaFile ? await readJsonl(nativeDogmaFile) : null;
  if (native.total === 0) throw Error("EMPTY_NATIVE_TYPES_SNAPSHOT");
  const ids = new Set(native.rows.keys());
  const sde = {};
  for (const table of REQUIRED) {
    sde[table] = await readJsonl(path.join(sdeDir,table+".jsonl"), {
      allowMissing:true, include: ["types","typeDogma"].includes(table) ? ids : null,
    });
  }
  const missing = REQUIRED.filter(k=>!sde[k]);
  const errors=[],differences=[],warnings=[];
  if (sde.marketGroups) {
    for (const [marketID, record] of sde.marketGroups.rows) {
      const parent = record.parentGroupID;
      if (parent !== undefined && parent !== null && !sde.marketGroups.rows.has(parent))
        issue(errors,"HIGH",null,"MARKET_PARENT_MISSING",{marketGroupID:marketID,parentGroupID:parent});
    }
  }
  if (nativeDogma && sde.typeDogma) {
    for (const typeID of sde.typeDogma.rows.keys()) {
      if (!nativeDogma.rows.has(typeID)) issue(errors,"HIGH",typeID,"NATIVE_DOGMA_SNAPSHOT_MISSING");
    }
  }
  for (const [typeID, old] of native.rows) {
    const now = sde.types?.rows.get(typeID);
    if (!now) { issue(errors,"HIGH",typeID,"TYPE_NOT_IN_2026_SDE"); continue; }
    if (!GOOD_KEY(old.groupID) || !GOOD_KEY(now.groupID))
      issue(errors,"HIGH",typeID,"GROUP_ID_INVALID");
    else if (old.groupID !== now.groupID)
      issue(differences,"HIGH",typeID,"GROUP_CHANGED",{pinned:old.groupID,current:now.groupID});
    const group = sde.groups?.rows.get(now.groupID);
    if (sde.groups && !group) issue(errors,"HIGH",typeID,"GROUP_MISSING");
    if (sde.categories && group && !sde.categories.rows.has(group.categoryID))
      issue(errors,"HIGH",typeID,"CATEGORY_MISSING");
    if (group && GOOD_KEY(old.categoryID) && old.categoryID !== group.categoryID)
      issue(differences,"HIGH",typeID,"CATEGORY_CHANGED",{pinned:old.categoryID,current:group.categoryID});
    if (typeof old.published === "boolean" && old.published !== now.published)
      issue(differences,"HIGH",typeID,"PUBLISHED_CHANGED",{pinned:old.published,current:now.published});
    if (old.published === true && now.published !== true)
      issue(errors,"HIGH",typeID,"PUBLISHED_ITEM_NO_LONGER_PUBLISHED");
    if (now.marketGroupID !== undefined && sde.marketGroups && !sde.marketGroups.rows.has(now.marketGroupID))
      issue(errors,"HIGH",typeID,"MARKET_GROUP_MISSING");
    const oldMarket=optionalNumber(old,"marketGroupID"),newMarket=optionalNumber(now,"marketGroupID");
    if (oldMarket !== null && oldMarket !== newMarket)
      issue(differences,"MEDIUM",typeID,"MARKET_GROUP_CHANGED",{pinned:oldMarket,current:newMarket});
    for (const field of ["mass","volume","capacity","radius","basePrice","graphicID","iconID","portionSize"]) {
      const before=optionalNumber(old,field),after=optionalNumber(now,field);
      if (before !== null && before !== after)
        issue(differences,["graphicID","iconID","mass","volume","capacity"].includes(field)?"HIGH":"MEDIUM",typeID,"ATTRIBUTE_CHANGED:"+field,{pinned:before,current:after});
    }
    if (stringName(old.name) && stringName(now.name) && stringName(old.name)!==stringName(now.name))
      issue(warnings,"LOW",typeID,"ENGLISH_NAME_CHANGED",{pinned:stringName(old.name),current:stringName(now.name)});
    if (nativeDogma && nativeDogma.rows.has(typeID)) {
      const existing = nativeDogma.rows.get(typeID), latest=sde.typeDogma?.rows.get(typeID);
      if (!latest) { issue(errors,"HIGH",typeID,"SDE_DOGMA_MISSING"); continue; }
      const before=asDogmaAttrs(existing),after=asDogmaAttrs(latest);
      const be=asDogmaEffects(existing),ae=asDogmaEffects(latest);
      if (!before || !after || !be || !ae) { issue(errors,"HIGH",typeID,"INVALID_DOGMA_SNAPSHOT"); continue; }
      for(const [id,value] of after) if(sde.dogmaAttributes && !sde.dogmaAttributes.rows.has(id))
        issue(errors,"HIGH",typeID,"UNKNOWN_DOGMA_ATTRIBUTE",{attributeID:id});
      for(const [id,value] of ae) if(sde.dogmaEffects && !sde.dogmaEffects.rows.has(id))
        issue(errors,"HIGH",typeID,"UNKNOWN_DOGMA_EFFECT",{effectID:id});
      for (const id of new Set([...before.keys(),...after.keys()])) {
        if(before.get(id)!==after.get(id)) issue(differences,"HIGH",typeID,"DOGMA_VALUE_CHANGED",{attributeID:id,pinned:before.get(id)??null,current:after.get(id)??null});
      }
      for (const id of new Set([...be.keys(),...ae.keys()])) {
        if(be.get(id)!==ae.get(id)) issue(differences,"HIGH",typeID,"DOGMA_EFFECT_CHANGED",{effectID:id,pinned:be.get(id)??null,current:ae.get(id)??null});
      }
    }
  }
  const dogmaCoverage = nativeDogma ? {compared:[...nativeDogma.rows.keys()].filter(id=>ids.has(id)&&sde.typeDogma?.rows.has(id)).length,provided:nativeDogma.total} : {compared:0,provided:0};
  return {
    status: missing.length ? "BLOCKED_MISSING_SDE_TABLES" : errors.length ? "BLOCKED_DATA_INTEGRITY" : differences.length ? "REVIEW_SDE_DRIFT" : !nativeDogma ? "BLOCKED_NATIVE_DOGMA_MISSING" : "STATIC_DATA_MATCH_CLIENT_UNVERIFIED",
    authoritativeGameCompatibility:"NOT_ESTABLISHED",
    mutations:0,
    snapshotTypeCount:native.total,
    dogmaCoverage,
    missingTables:missing,
    sourceTables:Object.fromEntries(REQUIRED.map(k=>[k,sde[k]?.total??null])),
    errors:limitIssues(errors),differences:limitIssues(differences),warnings:limitIssues(warnings),
    notice:"Static row equality does NOT prove 2026 types, effects, market RPC or client assets work in pinned EveJS 24.01. No item/asset import is authorised.",
  };
}
function parseArgs(argv) {
  const a={};
  const names={"--sde-dir":"sdeDir","--native-items":"nativeItemsFile","--native-dogma":"nativeDogmaFile"};
  for(let i=0;i<argv.length;i++){
    if(!names[argv[i]]||!argv[i+1]||argv[i+1].startsWith("--"))throw Error("UNKNOWN_OR_MISSING_CLI_ARGUMENT");
    a[names[argv[i++]]]=argv[i];
  }
  return a;
}
if(require.main===module){
  (async()=>{try{const result=await audit(parseArgs(process.argv.slice(2)));console.log(JSON.stringify(result,null,2));if(result.status!=="STATIC_DATA_MATCH_CLIENT_UNVERIFIED")process.exitCode=2;}
  catch(error){console.error("BLOCKED_SDE_AUDIT: "+error.message);process.exitCode=2}})();
}
module.exports={REQUIRED,readJsonl,audit,parseArgs,asDogmaAttrs,asDogmaEffects};
