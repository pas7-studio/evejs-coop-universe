import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The decision half of the market makers: prices stay inside the owner's corridors, a bid never
// crosses the ask, a listing never goes below cost, and demand only moves the price by one step.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const maker = require(path.join(forkRoot, "Code/server/src/space/coopMarketMaker.js"));

test("five traders, each with a large but booked bankroll", () => {
  assert.equal(maker.TRADERS.length, 5);
  for (const trader of maker.TRADERS) {
    assert.match(trader.traderID, /^mk-trader-[1-5]$/);
    assert.ok(trader.bankrollISK >= 50e9 && trader.bankrollISK <= 100e9, "50-100 billion each");
    assert.ok(trader.dailySpendISK > 0 && trader.dailySpendISK < trader.bankrollISK);
  }
});

test("a bid stays inside the owner's corridor and never crosses the ask", () => {
  const cheap = maker.decideBuyPrice({referenceISK: 1000, random: 0});
  assert.equal(cheap.priceISK, 700, "-30 % at the bottom of the band");
  const rich = maker.decideBuyPrice({referenceISK: 1000, random: 0.999999});
  assert.equal(rich.priceISK, 1300, "+30 % at the top of the band");

  const capped = maker.decideBuyPrice({referenceISK: 1000, bestAskISK: 1100, random: 0.999999});
  assert.ok(capped.priceISK < 1100, "a bid above the ask would just fill: capped below it");
  assert.equal(maker.decideBuyPrice({referenceISK: 0}).ok, false);
});

test("a listing is never below cost and never below the best bid", () => {
  const low = maker.decideSellPrice({costBasisISK: 1000, random: 0});
  assert.equal(low.priceISK, 1050, "+5 % at the bottom");
  const high = maker.decideSellPrice({costBasisISK: 1000, random: 0.999999});
  assert.equal(high.priceISK, 1400, "+40 % at the top");
  const raised = maker.decideSellPrice({costBasisISK: 1000, bestBidISK: 1200, random: 0});
  assert.ok(raised.priceISK > 1200, "never undercuts the book");
  assert.ok(raised.margin >= 0.05);
  assert.equal(maker.decideSellPrice({costBasisISK: 0}).ok, false);
});

test("demand moves the price one step, and only when there is demand", () => {
  const up = maker.adjustForDemand({priceISK: 1000, filled: true});
  assert.equal(up.priceISK, 1020, "+2 % after a fill");
  const down = maker.adjustForDemand({priceISK: 1000, expired: true});
  assert.equal(down.priceISK, 980, "-2 % after sitting its whole life");
  const unchanged = maker.adjustForDemand({priceISK: 1000});
  assert.equal(unchanged.moved, 0, "a live order changes nothing");
});
