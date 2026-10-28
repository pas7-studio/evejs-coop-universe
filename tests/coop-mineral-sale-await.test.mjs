import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Measured on the work stack 2026-10-28: every sale in the world's history was ORE
// (types 17464, 1228, 1230) and never a single mineral, while the refinery kept
// producing them and one hauler hold held 47 lift-tagged rows. The lift is async and
// its Promise was read as a result, so no mineral type ever joined sellTypes and the
// trader answered NO_REAL_NATIVE_CARGO.
const fork = path.join("C:", "Games", "EveCoop", "upstream-evejs", "Code", "server", "src", "space",
  "coopVirtualWorldRuntime.js");
const present = fs.existsSync(fork);
const source = present ? fs.readFileSync(fork, "utf8") : "";

test("the mineral lift is awaited before the sale is priced", { skip: !present }, () => {
  const liftAt = source.indexOf("loaded=await ensureMineralLift()?.lift({systemID,stationID,haulerID,");
  const wantedAt = source.indexOf("const wanted=[...new Set(sellTypes.filter(typeID=>");
  assert.ok(liftAt > 0, "the lift must be awaited");
  assert.ok(wantedAt > liftAt, "the sale list must be built after the lift really finished");
  assert.ok(!/loaded=ensureMineralLift\(\)\?\.lift\(/.test(source),
    "a Promise must never be read as a lift result");
});

test("the lifted mineral types join the sale list", { skip: !present }, () => {
  assert.ok(source.includes('if(loaded&&loaded.status==="LIFTED")'));
  assert.ok(source.includes("if(!sellTypes.includes(typeID))sellTypes.push(typeID);"));
  assert.ok(source.includes("liftedTypes.add(typeID);"));
});

test("an arrival with nothing sellable is still reported", { skip: !present }, () => {
  assert.ok(source.includes('if(!ordered.length)last="NO_ALLOWED_ORE";'));
});

test("a type the station does not bid for never ends the whole batch", { skip: !present }, () => {
  // Measured 2026-10-28: the 5 manufactured chipsets were lifted into the hauler at
  // 60014935, and the batch settled NOT_SOLD NO_SEEDED_COUNTERPARTY on an unrelated
  // allowlisted ore type - an order the station never had a bid for. The only type it
  // really bids 53 700 for was never asked for.
  assert.ok(source.includes('"NO_SEEDED_COUNTERPARTY"].includes(last)'),
    "a missing bid for one type must skip that type, not the haul");
  const sortAt = source.indexOf("const ordered=[...carriedGood,...liftedRest,");
  const wantedAt = source.indexOf("const wanted=[...new Set(sellTypes.filter(typeID=>");
  assert.ok(sortAt > wantedAt, "the product and the lifted stock are asked for first");
});

test("real cargo in the hold is sellable even when the manifest names only ore", { skip: !present }, () => {
  // Measured 2026-10-28: 5 chipsets lifted on an earlier arrival rode along with a full
  // ore haul; the trip's own `types` narrowed the batch to this trip's ore, so the market
  // was never asked for them. The hull's real cargo is a fact, not a manifest entry.
  assert.ok(source.includes('const carried=new Set();'));
  assert.ok(source.includes("liftedTypes.has(Number(typeID))||carried.has(Number(typeID))||"));
  assert.ok(source.includes("listNativeCargoForEntity(Number(haulerID))"));
});

test("the sell policy is capped, so its ORDER is the priority", { skip: !present }, () => {
  // Measured 2026-10-28: the manufactured chipsets were appended as the 44th type of the
  // operator list, the allowlist keeps only the first 20, and the arrival sale therefore
  // never asked the market for the one type the station really bid 54 289 for.
  const pure = path.join(path.dirname(fork), "coopVirtualWorldRuntime.pure.js");
  assert.ok(fs.existsSync(pure));
  const source = fs.readFileSync(pure, "utf8");
  assert.ok(source.includes(".filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,20)"),
    "the cap is real: 20 types per batch");
  const compose = fs.readFileSync(path.join("C:", "Games", "EveCoop", "upstream-evejs", "Code",
    "compose.coop-probe.yaml"), "utf8");
  const line = compose.split("\n").find((x) => x.includes("EVEJS_COOP_NPC_MARKET_SELL_TYPES"));
  assert.ok(line && line.includes("'444,"), "the manufactured product must lead the list");
});

test("the world settles its own market journal instead of staying blocked", { skip: !present }, () => {
  // Measured 2026-10-28: one crashed partial fill left a journal at RPC_CALLING and every
  // later sale of that pilot was refused with UNRESOLVED_MARKET_JOURNAL until an operator
  // ran the reconcile tool. The proof is read-only, so the world does it itself.
  assert.ok(source.includes("function reconcileMarketJournalsAtBoot("));
  assert.ok(source.includes('reconcileMarketJournalsAtBoot(true);'),
    "a journal refusal retries the reconcile instead of blocking for ever");
  const boot = fs.readFileSync(path.join(path.dirname(fork), "coopMarketJournalBoot.js"), "utf8");
  assert.ok(boot.includes('require("./coopNativeNpcMarketReconcile").reconcileJournals({'));
  assert.ok(source.includes('inspectOrder:orderID=>marketClient.call("GetOrder",{order_id:String(orderID)})'),
    "settlement reads the market's own row and never re-sends a fill");
});
