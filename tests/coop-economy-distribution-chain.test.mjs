import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const space = join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space")
const Run = require(join(space, "coopEconomyDistributionRun.js"))
const Pool = require(join(space, "coopEconomyHaulerReservation.js"))
const Unload = require(join(space, "coopEconomyUnload.js"))

test("a run cannot skip a stage", () => {
  const d = Run.createDistributor()
  assert.equal(d.start({ runID: "r1", hullID: "h1", cargoID: "c1", quantity: 10 }).ok, true)
  const stages = d.STAGES
  const last = stages[stages.length - 1]
  const res = d.advance({ runID: "r1", to: last, receiptID: undefined })
  assert.equal(res.ok, false)
  assert.equal(res.code, "INVALID_TRANSITION")
  assert.equal(d.snapshot("r1").stage, stages[0])
})

test("a hull is reserved once per run and cannot serve two runs", () => {
  const p = Pool.createHaulerPool()
  assert.equal(p.register({ hullID: "h1", capacityM3: 100 }).ok, true)
  assert.equal(p.reserve({ runID: "r2", hullID: "h1", volumeM3: 100, cargoIDs: [] }).ok, true)
  const again = p.reserve({ runID: "r2", hullID: "h1", volumeM3: 100, cargoIDs: [] })
  assert.equal(again.ok, true)
  assert.equal(again.code, "ALREADY_RESERVED")
  const r3 = p.reserve({ runID: "r3", hullID: "h1", volumeM3: 100, cargoIDs: [] })
  assert.equal(r3.ok, false)
})

test("an unload outside dock range deposits nothing", () => {
  let deposits = 0
  const port = { deposit: () => { deposits += 1; return { receiptID: "d" + deposits } } }
  const far = { cargo: { ownerID: "o", typeID: "t", quantity: 1 }, orders: [{ priceCents: 5, quantity: 10 }], unloadPort: port, station: { stationID: "s", dockRangeMeters: 2500, distanceMeters: 5000 } }
  const r1 = Unload.unload(far)
  assert.equal(r1.ok, false)
  assert.equal(r1.code, "NOT_AT_STATION")
  assert.equal(deposits, 0)
  const near = { cargo: { ownerID: "o", typeID: "t", quantity: 1 }, orders: [{ priceCents: 5, quantity: 10 }], unloadPort: port, station: { stationID: "s", dockRangeMeters: 2500, distanceMeters: 2500 } }
  const r2 = Unload.unload(near)
  assert.equal(r2.ok, true)
  assert.equal(deposits, 1)
})
