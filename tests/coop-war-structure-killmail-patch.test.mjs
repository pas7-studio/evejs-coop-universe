import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-war-structure-killmail-patch.cjs");
const original=`"use strict";
function recordKillmailFromDestruction(targetEntity, destroyResult, options = {}) {
  const ledgerKey="native:structure";
  const record={killID:5};
  const toPositiveInt=x=>Number(x)||0;
  ledgersByVictim.delete(ledgerKey);
  return record;
}`;
test("pinned native killmail patch is source-preserving, reversible and idempotent",()=>{
 const applied=patch(original,{remove:false});
 assert.match(applied,/noteNativeStructureKill/);
 assert.match(applied,/EVEJS_COOP_FACTION_WAR_NATIVE_OBJECTIVES/);
 assert.equal(patch(applied,{remove:false}),applied);
 assert.equal(patch(applied,{remove:true}),original);
 assert.equal(patch(original,{remove:true}),original);
 assert.doesNotThrow(()=>new Function(applied));
});
test("unknown or duplicate native killmail anchors abort safely",()=>{
 assert.throws(()=>patch(original.replace(
  "  ledgersByVictim.delete(ledgerKey);","  other.delete(ledgerKey);")),
  /FW_009B_NATIVE_KILLMAIL_ANCHOR_CHANGED/);
 assert.throws(()=>patch(original+"\n"+original),
  /FW_009B_NATIVE_KILLMAIL_ANCHOR_CHANGED/);
});
