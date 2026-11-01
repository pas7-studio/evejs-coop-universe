import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  MAX_BOOTSTRAP_CASH_CENTS,
  validateWorldManifest,
  createWorldManifest,
} = require(require("node:path").join(process.env.EVEJS_FORK_ROOT || (() => { throw new Error("EVEJS_FORK_ROOT is unset"); })(), "Code/server/src/space/coopEconomyWorldManifest.js"));

const BASE = {
  worldSeed: "w1",
  stations: [{ stationID: "s1" }, { stationID: "s2" }],
  corporations: [
    {
      corpID: "c1",
      homeStationID: "s1",
      cashCents: 5000000000,
      dailySpendCapCents: 100000000,
      maxActiveJobs: 4,
    },
  ],
};

test("a valid manifest returns { ok: true, errors: [] }", () => {
  const result = validateWorldManifest(BASE);
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("missing or empty worldSeed -> MISSING_SEED; empty stations -> NO_STATIONS", () => {
  assert.ok(validateWorldManifest({ ...BASE }).ok);

  const noSeed = { ...BASE, worldSeed: undefined };
  const errors = validateWorldManifest(noSeed).errors;
  assert.ok(errors.includes("MISSING_SEED"));

  const emptySeed = { ...BASE, worldSeed: "" };
  const errors2 = validateWorldManifest(emptySeed).errors;
  assert.ok(errors2.includes("MISSING_SEED"));

  const noStations = { ...BASE, stations: [] };
  const errors3 = validateWorldManifest(noStations).errors;
  assert.ok(errors3.includes("NO_STATIONS"));
});

test("duplicate corpID -> DUPLICATE_CORP; bad cashCents -> NEGATIVE_CASH", () => {
  const dup = {
    ...BASE,
    corporations: [
      { ...BASE.corporations[0], corpID: "c1" },
      { ...BASE.corporations[0], corpID: "c1" },
    ],
  };
  assert.ok(validateWorldManifest(dup).errors.includes("DUPLICATE_CORP"));

  const neg = {
    ...BASE,
    corporations: [{ ...BASE.corporations[0], cashCents: -1 }],
  };
  assert.ok(validateWorldManifest(neg).errors.includes("NEGATIVE_CASH"));

  const inf = {
    ...BASE,
    corporations: [{ ...BASE.corporations[0], cashCents: Infinity }],
  };
  assert.ok(validateWorldManifest(inf).errors.includes("NEGATIVE_CASH"));

  const str = {
    ...BASE,
    corporations: [{ ...BASE.corporations[0], cashCents: "5000" }],
  };
  assert.ok(validateWorldManifest(str).errors.includes("NEGATIVE_CASH"));
});

test("unbounded cash, unknown station, spend cap over cash, invalid job slots", () => {
  const unbounded = {
    ...BASE,
    corporations: [{ ...BASE.corporations[0], cashCents: 2000000000000 }],
  };
  assert.ok(validateWorldManifest(unbounded).errors.includes("UNBOUNDED_CASH"));

  const unknown = {
    ...BASE,
    corporations: [{ ...BASE.corporations[0], homeStationID: "s9" }],
  };
  assert.ok(validateWorldManifest(unknown).errors.includes("UNKNOWN_STATION"));

  const spendCap = {
    ...BASE,
    corporations: [
      {
        ...BASE.corporations[0],
        cashCents: 100000000,
        dailySpendCapCents: 200000000,
      },
    ],
  };
  assert.ok(validateWorldManifest(spendCap).errors.includes("SPEND_CAP_OVER_CASH"));

  const jobSlots = {
    ...BASE,
    corporations: [{ ...BASE.corporations[0], maxActiveJobs: 99 }],
  };
  assert.ok(validateWorldManifest(jobSlots).errors.includes("INVALID_JOB_SLOTS"));
});

test("error codes are sorted and de-duplicated", () => {
  const twoBad = {
    ...BASE,
    corporations: [
      { ...BASE.corporations[0], cashCents: -1 },
      { ...BASE.corporations[0], cashCents: "5000" },
    ],
  };
  const errors = validateWorldManifest(twoBad).errors;
  assert.equal(errors.filter((e) => e === "NEGATIVE_CASH").length, 1);
  assert.deepEqual(errors, [...new Set(errors)].sort());
});

test("createWorldManifest(valid) returns a frozen object with version 1, bootstrap true, correct totals", () => {
  const manifest = createWorldManifest(BASE);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.bootstrap, true);
  assert.deepEqual(manifest.totals, {
    corporations: 1,
    stations: 2,
    cashCents: 5000000000,
  });
  assert.equal(Object.isFrozen(manifest), true);
});

test("createWorldManifest(invalid) throws TypeError whose message contains 'invalid world manifest'", () => {
  assert.throws(
    () => createWorldManifest({ ...BASE, worldSeed: undefined }),
    (err) => {
      assert.ok(err instanceof TypeError);
      assert.ok(err.message.includes("invalid world manifest"));
      return true;
    }
  );
});

test("MAX_BOOTSTRAP_CASH_CENTS is 1000000000000 and a manifest at exactly that cash value is valid", () => {
  assert.equal(MAX_BOOTSTRAP_CASH_CENTS, 1000000000000);

  const exact = {
    ...BASE,
    corporations: [{ ...BASE.corporations[0], cashCents: 1000000000000 }],
  };
  assert.ok(validateWorldManifest(exact).ok);
});


