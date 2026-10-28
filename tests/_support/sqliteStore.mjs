// ES module face of ./sqliteStore.cjs, which owns the two GameStore contracts:
// the raw writer answers {result,changed}, the GameStore adapter answers with the
// mutation's own return value, and confusing them reads as a plausible status
// instead of an error. The CommonJS implementation is the real one so a fixture
// can also build the store inside a generated child source string.
//
//   const rows = gameStoreTransact(() => db);
//   service({ gameStore: { ...rows, isPoisoned: () => false } });
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const { gameStoreTransact, rawTransactor } = require("./sqliteStore.cjs");
