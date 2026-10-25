import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { alifeOrderArbitrationEnabled } = require("../integration/coopVirtualWorldRuntime.cjs");

const root = join(import.meta.dirname, "..");

test("the unified ALIFE switch implies native order arbitration", () => {
  assert.equal(alifeOrderArbitrationEnabled({ EVEJS_COOP_ALIFE: "1" }), true);
  assert.equal(alifeOrderArbitrationEnabled({ EVEJS_COOP_NPC_ORDER_ARBITER: "1" }), true);
});

test("arbitration stays off unless a flag really asks for it", () => {
  assert.equal(alifeOrderArbitrationEnabled({}), false);
  assert.equal(alifeOrderArbitrationEnabled({ EVEJS_COOP_ALIFE: "0" }), false);
  assert.equal(alifeOrderArbitrationEnabled({ EVEJS_COOP_ALIFE: "true" }), false);
  assert.equal(alifeOrderArbitrationEnabled({ EVEJS_COOP_NPC_ORDER_ARBITER: "yes" }), false);
  assert.equal(alifeOrderArbitrationEnabled({ EVEJS_COOP_ALIFE: "0", EVEJS_COOP_NPC_ORDER_ARBITER: "1" }), true);
});

test("the runtime guard is the only place that decides order authority", () => {
  const text = readFileSync(join(root, "integration", "coopVirtualWorldRuntime.cjs"), "utf8");
  // No module may re-implement the gate with a raw env comparison.
  assert.match(text, /function npcOrderBridge\(\)\{\n if\(!alifeOrderArbitrationEnabled\(process\.env\)\)return null;/);
  const raw = text.match(/process\.env\.EVEJS_COOP_NPC_ORDER_ARBITER/g) || [];
  assert.equal(raw.length, 0, "the legacy flag must be read only through the helper");
});

test("every native NPC order-dependent director is gated by the same master helper",()=>{
 const source=readFileSync(join(root,"integration","coopVirtualWorldRuntime.cjs"),"utf8");
 const guardPositions=[
  "function npcPersonalGoals(){",
  "function advanceNativeWreckRecovery(){",
  "function advanceNativeWreckCustody(){",
  "function advanceNativeLootStationDelivery(){",
  "function advanceNativeAmmoSupply({"
 ];
 for(const guard of guardPositions){
  const at=source.indexOf(guard);
  assert.ok(at>=0,guard);
  const end=source.indexOf(" const runtime=require(",at);
  const body=source.slice(at,end>at?end:at+1100);
  assert.ok(body.includes("!alifeOrderArbitrationEnabled(process.env)"),
   "missing shared authority gate in "+guard);
 }
 for(const scope of ["const rearmEnabled=","const squadEnabled="]){
  const at=source.indexOf(scope);
  assert.ok(at>=0,scope);
  const body=source.slice(at,at+260);
  assert.ok(body.includes("alifeOrderArbitrationEnabled(process.env)"),
   "legacy gate still blocks ALIFE master switch for "+scope);
 }
 const direct=source.match(/process\.env\.EVEJS_COOP_NPC_ORDER_ARBITER/g)||[];
 assert.equal(direct.length,0,"no shadow legacy-only flags should survive");
});
test("unified authority cannot silently enable unrelated NPC features",()=>{
 assert.equal(alifeOrderArbitrationEnabled({EVEJS_COOP_ALIFE:"1"}),true);
 const source=readFileSync(join(root,"integration","coopVirtualWorldRuntime.cjs"),"utf8");
 for(const flag of ["EVEJS_COOP_NPC_PERSONAL_GOALS","EVEJS_COOP_NPC_WRECK_RECOVERY",
   "EVEJS_COOP_NPC_WRECK_TRANSFER","EVEJS_COOP_NPC_AMMO_SUPPLY",
   "EVEJS_COOP_NPC_EARN_SPEND_REARM","EVEJS_COOP_NPC_SQUAD_RAIDS"]){
  assert.ok(source.includes("process.env."+flag),"independent opt-in must survive "+flag);
 }
});
