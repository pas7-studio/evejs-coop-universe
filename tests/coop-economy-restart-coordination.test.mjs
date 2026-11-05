import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

// The coordination layer, not just the money: a lease fences another owner out, a distribution run
// ties a hull to a cargo, and an escrow hold promises units will not be sold twice. All three were
// process-local, so a restart silently released them (measured 2026-11-01).
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const SPACE = join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space");

function reload(name) {
  const p = join(SPACE, name + ".js");
  delete require.cache[require.resolve(p)];
  return require(p);
}

function memoryJournal() {
  const rows = new Map();
  return {
    get: (k) => rows.get(k),
    set: (k, v) => { rows.set(k, v); },
    has: (k) => rows.has(k),
    delete: (k) => rows.delete(k),
    entries: () => [...rows.entries()],
  };
}

test("a lease still fences after a restart", () => {
  const journal = memoryJournal();
  const before = reload("coopEconomyRaceMatrix").createLeases({ ttlTicks: 30, graceTicks: 5, journal });
  assert.equal(before.acquire({ key: "belt-1", ownerID: "a", tick: 0 }).code, "ACQUIRED");

  const after = reload("coopEconomyRaceMatrix").createLeases({ ttlTicks: 30, graceTicks: 5, journal });
  assert.equal(after.holderOf("belt-1"), "a", "a restart released the lease");
  assert.equal(after.acquire({ key: "belt-1", ownerID: "b", tick: 1 }).code, "LOCK_HELD");
});

test("an in-flight distribution run survives a restart", () => {
  const journal = memoryJournal();
  const before = reload("coopEconomyDistributionRun").createDistributor({ journal });
  before.start({ runID: "run-1", hullID: "h1", cargoID: "c1", quantity: 10 });
  const stage = before.snapshot("run-1").stage;

  const after = reload("coopEconomyDistributionRun").createDistributor({ journal });
  const resumed = after.snapshot("run-1");
  assert.ok(resumed, "a restart forgot the run");
  assert.equal(resumed.stage, stage, "the run resumed at a different stage");
});

test("an escrow hold survives a restart and the units stay unavailable", () => {
  const journal = memoryJournal();
  const before = reload("coopEconomySellEscrow").createEscrow({ journal });
  before.stock({ itemID: "i1", quantity: 80 });
  before.reserve({ itemID: "i1", quantity: 40 });
  before.list({ escrowID: "e1", itemID: "i1", quantity: 20, priceCents: 5 });

  const after = reload("coopEconomySellEscrow").createEscrow({ journal });
  assert.equal(after.reserved("i1"), 40, "the hold was forgotten by the restart");
  assert.equal(after.listed("i1"), 20, "the listing was forgotten by the restart");
  assert.equal(after.available("i1"), 20, "the restarted escrow double-counts free stock");
  // the same units cannot be listed a second time after the restart
  assert.equal(after.list({ escrowID: "e2", itemID: "i1", quantity: 20, priceCents: 5 }).code, "ALREADY_LISTED");
});
