import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const space = join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space")
const Calibration = require(join(space, "coopEconomyCalibration.js"))
const Soak = require(join(space, "coopEconomySoak.js"))

const bounds = {
  safetyStockTicks: [1, 1000],
  productionCadenceTicks: [1, 1000],
  offerRefreshTicks: [1, 1000],
  riskStep: [1, 1000],
}

const inBounds = {
  safetyStockTicks: 50,
  productionCadenceTicks: 20,
  offerRefreshTicks: 30,
  riskStep: 10,
  demandMultiplier: 1,
}

test("calibration clamps to its bounds and refuses a demand pump", () => {
  const ok = Calibration.calibrate({ measured: { ...inBounds }, bounds })
  assert.equal(ok.ok, true)
  assert.equal(ok.code, "CALIBRATED")
  assert.equal(ok.config.safetyStockTicks, inBounds.safetyStockTicks)

  const a = Calibration.calibrate({ measured: { ...inBounds }, bounds })
  const b = Calibration.calibrate({ measured: { ...inBounds }, bounds })
  assert.deepEqual(a.config, b.config)

  // an out-of-range measurement is clamped to its bound and the field is named in `clamped`
  const high = Calibration.calibrate({ measured: { ...inBounds, safetyStockTicks: 99999 }, bounds })
  assert.equal(high.ok, true)
  assert.equal(high.config.safetyStockTicks, bounds.safetyStockTicks[1], "the bound was not applied")
  assert.equal(high.clamped.includes("safetyStockTicks"), true, "the clamped field was not named")
  const low = Calibration.calibrate({ measured: { ...inBounds, safetyStockTicks: -5 }, bounds })
  assert.equal(low.config.safetyStockTicks, bounds.safetyStockTicks[0], "the lower bound was not applied")

  const refused = Calibration.calibrate({ measured: { ...inBounds, demandMultiplier: 2 }, bounds })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, "DEMAND_PUMP_REFUSED")
})

test("a soak run is reproducible and its bounds are real", () => {
  const r1 = Soak.runSoak({ ticks: 50, seed: 7, stockCap: 10000, walletStart: 100000 })
  const r2 = Soak.runSoak({ ticks: 50, seed: 7, stockCap: 10000, walletStart: 100000 })
  assert.equal(r1.ok, true)
  assert.equal(r1.code, "SOAK_COMPLETE")
  assert.deepEqual(r1, r2)

  const zero = Soak.runSoak({ ticks: 0, seed: 7 })
  assert.equal(zero.code, "INVALID_SOAK")

  const float = Soak.runSoak({ ticks: 50, seed: 1.5 })
  assert.equal(float.code, "INVALID_SOAK")

  const r3 = Soak.runSoak({ ticks: 50, seed: 7, stockCap: 10000, walletStart: 100000 })
  assert.equal(r1.finalStock, r3.finalStock)
  assert.equal(r1.finalWallet, r3.finalWallet)
})
