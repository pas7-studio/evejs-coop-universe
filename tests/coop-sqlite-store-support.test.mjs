import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { gameStoreTransact, rawTransactor } from "./_support/sqliteStore.mjs";
import { withEnv } from "./_support/env.mjs";

// The whole point of the helper: a caller reads its receipt from the transact
// claim, so the shape it receives must be the mutation's return value and not
// the writer's {result,changed} envelope.
function open() {
  const db = new DatabaseSync(":memory:");
  db.exec('CREATE TABLE "identityState"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  return db;
}

test("gameStoreTransact answers with the mutation's own return value", () => {
  withEnv(null, { EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" });
  const db = open();
  try {
    const rows = gameStoreTransact(() => db);
    const receipt = rows.transact(["identityState"], (tx) => {
      tx.put("identityState", "cargo", { cargoID: 501 });
      return { status: "COMMITTED", cargoID: 501 };
    });
    assert.deepEqual(receipt, { status: "COMMITTED", cargoID: 501 });
    assert.equal("changed" in receipt, false, "no writer envelope may leak through");
    assert.equal(
      JSON.parse(db.prepare('SELECT json FROM "identityState" WHERE key=?').get("cargo").json).cargoID,
      501,
    );
  } finally {
    db.close();
  }
});

test("a rejected mutation commits nothing and propagates its error", () => {
  withEnv(null, { EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" });
  const db = open();
  try {
    const rows = gameStoreTransact(() => db);
    assert.throws(
      () => rows.transact(["identityState"], (tx) => {
        tx.put("identityState", "cargo", { cargoID: 501 });
        throw new Error("NATIVE_CARGO_UNVERIFIED");
      }),
      /NATIVE_CARGO_UNVERIFIED/,
    );
    assert.equal(db.prepare('SELECT json FROM "identityState" WHERE key=?').get("cargo"), undefined);
  } finally {
    db.close();
  }
});

test("rawTransactor keeps the {result,changed} envelope for tests that assert it", () => {
  withEnv(null, { EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" });
  const db = open();
  try {
    const writer = rawTransactor(() => db);
    const answer = writer.transact(["identityState"], (tx) => {
      tx.put("identityState", "a", { v: 1 });
      return "MUTATION_VALUE";
    });
    assert.equal(answer.result, "MUTATION_VALUE");
    assert.deepEqual(answer.changed, { identityState: ["a"] });
  } finally {
    db.close();
  }
});

test("the provider is read per transaction, so a reopened database keeps working", () => {
  withEnv(null, { EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1" });
  let db = open();
  try {
    const rows = gameStoreTransact(() => db);
    rows.transact(["identityState"], (tx) => tx.put("identityState", "a", { v: 1 }));
    db.close();
    db = open();
    rows.transact(["identityState"], (tx) => tx.put("identityState", "b", { v: 2 }));
    assert.equal(db.prepare('SELECT count(*) AS n FROM "identityState"').get().n, 1);
  } finally {
    db.close();
  }
});
