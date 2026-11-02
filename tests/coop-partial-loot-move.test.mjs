import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { resolveCapacityClampedQuantity } = require(
  path.join(forkRoot, "Code/server/src/services/inventory/invMoveCapacity.js"),
);

const full = { success: false, errorMsg: "NotEnoughCargoSpace", free: 7, requiredVolume: 186 };

test("a stack that does not fit moves only what fits instead of nothing", () => {
  const resolved = resolveCapacityClampedQuantity({
    capacityCheck: full,
    unitVolume: 1,
    wantedQuantity: 186,
  });
  assert.equal(resolved.success, true, "the drag must not be refused outright");
  assert.equal(resolved.quantity, 7, "exactly the free space is filled");
  assert.equal(resolved.partial, true);
});

test("nothing fits means a real NotEnoughCargoSpace", () => {
  const resolved = resolveCapacityClampedQuantity({
    capacityCheck: { success: false, errorMsg: "NotEnoughCargoSpace", free: 0.5 },
    unitVolume: 1,
    wantedQuantity: 186,
  });
  assert.equal(resolved.success, false);
});

test("a singleton cannot be split, so it still refuses", () => {
  const resolved = resolveCapacityClampedQuantity({
    capacityCheck: { success: false, errorMsg: "NotEnoughCargoSpace", free: 400 },
    unitVolume: 500,
    wantedQuantity: 1,
    singleton: 1,
  });
  assert.equal(resolved.success, false);
});

test("a move that fits is left untouched", () => {
  const resolved = resolveCapacityClampedQuantity({
    capacityCheck: { success: true },
    unitVolume: 1,
    wantedQuantity: 12,
  });
  assert.deepEqual(resolved, { success: true, quantity: 12 });
});

test("a different refusal is not turned into a partial move", () => {
  const resolved = resolveCapacityClampedQuantity({
    capacityCheck: { success: false, errorMsg: "CargoContainerCapacityExceeded", free: 50 },
    unitVolume: 1,
    wantedQuantity: 186,
  });
  assert.equal(resolved.success, false);
});
