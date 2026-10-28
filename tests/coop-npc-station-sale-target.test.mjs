import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Measured on the work stack 2026-10-28, after the market journal was reconciled:
// the arrival still refused the sale, now with NATIVE_NPC_BUSY, because the fleet's
// own approach issues an orbit order on its asteroid and that sets
// controller.currentTargetID (target 5020484740197 while the hauler sat at station
// 60003724 with its minerals ready to sell).
const fork = path.join("C:", "Games", "EveCoop", "upstream-evejs", "Code", "server", "src", "space",
  "coopVirtualWorldRuntime.js");
const present = fs.existsSync(fork);
const source = present ? fs.readFileSync(fork, "utf8") : "";

test("the sale releases an idle station target before it asks the market", { skip: !present }, () => {
  const clearAt = source.indexOf("releaseStationIdleTarget({systemID,stationID,haulerID,scene:scene||null});");
  const traderAt = source.indexOf('if(!trader){noteSaleSkip(systemID,stationID,haulerID,"MARKET_UNAVAILABLE")');
  assert.ok(clearAt > 0, "the sale must release an idle target");
  assert.ok(traderAt > clearAt, "the release belongs before the trader is used");
});

test("only a non-combat target is released", { skip: !present }, () => {
  for (const guard of [
    'if(String(controller.manualOrder?.type||"")==="attack")return false;',
    "if(Number(controller.lastAggressorID)>0&&Number.isFinite(aggressionAge)&&",
    'const isStatic=staticList.some(x=>Number(x?.itemID)===targetID)||',
    'if(!isStatic)return false;',
    'if(String(ship.mode||"").toUpperCase()==="WARP"||ship.pendingWarp||ship.warpState)return false;',
  ]) {
    assert.ok(source.includes(guard), "missing guard: " + guard);
  }
});

test("the release is observable", { skip: !present }, () => {
  assert.ok(source.includes("living-npc-station-target-cleared"));
  assert.ok(source.includes("releasedTargetID:targetID"));
});
