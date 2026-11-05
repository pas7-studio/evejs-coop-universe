import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(import.meta.url)
const space = join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space")
const Rollout = require(join(space, "coopEconomyRolloutManifest.js"))
const Health = require(join(space, "coopEconomyHealthReport.js"))
const Compat = require(join(space, "coopEconomyCompatMatrix.js"))

test("an unknown rollout stage never writes", () => {
  const r = Rollout.evaluate({ stage: "NOPE", flags: {} })
  assert.equal(r.ok, false)
  assert.equal(r.code, "INVALID_STAGE")
  assert.equal(r.writes, false)
})

test("only a writing stage with all its flags writes", () => {
  const observeOnly = ["OFF", "SHADOW"];
  for (const stage of Rollout.STAGES) {
    const bare = Rollout.evaluate({ stage, flags: {} })
    assert.equal(bare.writes, false, stage + " wrote without any flag")
    if (observeOnly.includes(stage)) continue
    const required = Rollout.requiredFlagsFor(stage)
    assert.ok(Array.isArray(required) && required.length > 0, stage + " requires nothing")
    const flags = {}
    for (const name of required) flags[name] = true
    const full = Rollout.evaluate({ stage, flags })
    assert.equal(full.writes, true, stage + " did not write with " + required.join(","))
  }
})

test("a health report with a missing metric is refused, not guessed", () => {
  assert.equal(Health.buildReport({}).code, "INVALID_REPORT")
  assert.equal(Health.buildReport({
    pnl: { realizedCents: 100, stockValueCents: 50, committedCents: 0 },
    demand: { intents: 1, fulfilled: [{ quantity: 10 }] },
  }).code, "UNVERIFIED_METRIC", "an unverified fulfilment was counted")
  const good = Health.buildReport({
    pnl: { realizedCents: 100, stockValueCents: 50, committedCents: 0 },
    demand: { intents: 1, fulfilled: [{ receiptID: "r1", quantity: 10 }] },
    shortages: [], cargoLosses: [], players: 1,
  })
  assert.equal(good.ok, true, "a complete report was refused: " + JSON.stringify(good).slice(0, 160))
})

test("compatibility flags a policy that turns the economy on by itself", () => {
  const baseline = { policy: "manual" }
  const selfOn = Compat.run({ baseline, candidate: baseline, flags: { economy: true, manual: false } })
  assert.notEqual(selfOn.code, "COMPATIBLE", "a self-enabling policy passed the matrix")
  const clean = Compat.run({ baseline, candidate: baseline, flags: {} })
  assert.equal(clean.ok, true, "a clean candidate was refused: " + JSON.stringify(clean).slice(0, 160))
})
