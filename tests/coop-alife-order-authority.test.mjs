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
