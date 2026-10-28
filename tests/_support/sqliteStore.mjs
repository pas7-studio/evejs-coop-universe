// One SQLite writer claim in the shape the production GameStore exposes.
//
// Two different contracts live here, and mistaking one for the other produces a
// false "no receipt" answer rather than an error:
//
//   integration/coopGameStoreAtomic.cjs  createSqliteAdapter(db).claimTransactor()
//       -> transact(tables, fn) === {result, changed}   (raw writer envelope)
//   the same module                      createGameStoreAdapter(...)
//       -> transact(tables, fn) === the mutation's own return value
//
// Callers such as coopNativeHaulTransferAtomic read their commit receipt straight
// from the claim (outcome.cargoID / outcome.afterHash), so a test that hands them
// the raw writer sees ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED even though the
// row, the receipt and the source debit are all correct on disk. Every real
// SQLite fixture used to re-implement the same one-line unwrap; this is the
// single owner of that knowledge.
//
//   const rows = gameStoreTransact(() => db);
//   service({ gameStore: { ...rows, isPoisoned: () => false } });
//
// `getDb` is called on every transaction, so a fixture that closes and reopens
// its database keeps working as long as it returns the current handle.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSqliteAdapter } = require("../../integration/coopGameStoreAtomic.cjs");

/** The claimed SQLite writer wrapped as the GameStore `transact` contract. */
export function gameStoreTransact(getDb) {
  if (typeof getDb !== "function") throw new Error("SQLITE_PROVIDER_REQUIRED");
  const writer = createSqliteAdapter(getDb).claimTransactor();
  return Object.freeze({
    transact: (tables, mutation) => writer.transact(tables, mutation).result,
  });
}

/** The raw claim, for fixtures that must assert the {result,changed} envelope. */
export function rawTransactor(getDb) {
  if (typeof getDb !== "function") throw new Error("SQLITE_PROVIDER_REQUIRED");
  return createSqliteAdapter(getDb).claimTransactor();
}
