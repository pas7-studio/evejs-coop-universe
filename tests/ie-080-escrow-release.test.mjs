import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const Escrow = require(join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space/coopEconomySellEscrow.js"));

// Found by adversarial wave 7 (module interaction). `reserve` only ever incremented the counter:
// there was no operation anywhere that could end a hold, so 40 reserved units were unavailable
// for ever and could never be listed, sold or freed. An automatic release on fill would be wrong,
// because IE-038 keeps the fleet reserve and the market escrow as disjoint pools: the fix is the
// explicit release() that was missing.
test("IE-038 escrow: a reservation can be released, and only by its holder", () => {
  const e = Escrow.createEscrow();
  assert.equal(e.stock({ itemID: "r1", quantity: 80 }).code, "STOCKED");
  assert.equal(e.reserve({ itemID: "r1", quantity: 40 }).code, "RESERVED");
  assert.equal(e.available("r1"), 40, "the hold did not reduce free stock");
  assert.equal(typeof e.release, "function", "there is no way to end a hold");
  assert.equal(e.release({ itemID: "r1", quantity: 41 }).ok, false, "a hold was over-released");
  assert.equal(e.release({ itemID: "r1", quantity: 40 }).code, "RELEASED");
  assert.equal(e.reserved("r1"), 0);
  assert.equal(e.available("r1"), 80, "the released units did not come back");
});

test("IE-038 escrow: a market fill never frees a fleet reservation", () => {
  const e = Escrow.createEscrow();
  e.stock({ itemID: "r2", quantity: 10 });
  e.reserve({ itemID: "r2", quantity: 4 });
  assert.equal(e.list({ escrowID: "l2", itemID: "r2", quantity: 6, priceCents: 5 }).code, "LISTED");
  assert.equal(e.available("r2"), 0);
  e.fill({ escrowID: "l2", quantity: 2 });
  assert.equal(e.reserved("r2"), 4, "the fill released a hold it never owned");
  assert.equal(e.available("r2"), 0, "the sold units became free stock");
});
