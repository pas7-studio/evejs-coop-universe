import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The four "P2P env invariant" blocks used to be copied verbatim into the buy and the
// sell crossing path of the stock market service. They are pure flag assertions, so they
// now live in one module - and the guards must still fire in exactly the old order with
// exactly the old error names, because operators and tests read them.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const guards = require(path.join(forkRoot, "Code/server/src/space/coopPlayerMarketEnvGuards.js"));

const FLAGS = [
  "EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE",
  "EVEJS_COOP_RUST_P2P_CLAIM",
  "EVEJS_COOP_PLAYER_MARKET_FILL_GUARD",
  "EVEJS_COOP_PLAYER_MARKET_ATOMIC",
  "EVEJS_COOP_NATIVE_ATOMIC_ROWS",
  "EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE",
];

function withEnv(values, fn) {
  const saved = {};
  for (const flag of FLAGS) {
    saved[flag] = process.env[flag];
    delete process.env[flag];
    if (values[flag] !== undefined) process.env[flag] = values[flag];
  }
  try {
    return fn();
  } finally {
    for (const flag of FLAGS) {
      if (saved[flag] === undefined) delete process.env[flag];
      else process.env[flag] = saved[flag];
    }
  }
}

test("a settlement fence without the Rust claim refuses, by name", () => {
  withEnv({EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE: "1"}, () => {
    assert.throws(() => guards.assertP2pSettlement(), /P2P_RUST_EXCLUSIVE_CLAIM_REQUIRED/);
  });
  withEnv({EVEJS_COOP_RUST_P2P_CLAIM: "1"}, () => {
    assert.throws(() => guards.assertP2pSettlement(), /P2P_RUST_NATIVE_SETTLEMENT_FENCE_REQUIRED/);
  });
  withEnv({EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE: "1", EVEJS_COOP_RUST_P2P_CLAIM: "1"}, () => {
    assert.throws(() => guards.assertP2pSettlement(), /P2P_SETTLEMENT_REQUIRES_PLAYER_FILL_GUARD/);
  });
  withEnv({EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE: "1", EVEJS_COOP_RUST_P2P_CLAIM: "1",
    EVEJS_COOP_PLAYER_MARKET_FILL_GUARD: "1", EVEJS_COOP_PLAYER_MARKET_ATOMIC: "1",
    EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1"}, () => {
    assert.doesNotThrow(() => guards.assertP2pSettlement());
    assert.doesNotThrow(() => guards.assertP2pAtomic());
  });
});

test("atomic rows and the Rust claim cannot exist one without the other", () => {
  withEnv({EVEJS_COOP_RUST_P2P_CLAIM: "1"}, () => {
    assert.throws(() => guards.assertP2pAtomic(), /P2P_ATOMIC_REQUIRED_WITH_RUST_CLAIMS/);
  });
  withEnv({EVEJS_COOP_PLAYER_MARKET_ATOMIC: "1"}, () => {
    assert.throws(() => guards.assertP2pAtomic(), /P2P_ATOMIC_ALL_NATIVE_FLAGS_REQUIRED/);
  });
  withEnv({}, () => {
    assert.doesNotThrow(() => guards.assertP2pAtomic());
  });
});

test("a prepaid buy reserve needs every guard at once", () => {
  withEnv({EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE: "1"}, () => {
    assert.throws(() => guards.assertBuyReserveEnv(), /P2P_BUY_RESERVE_ALL_GUARDS_REQUIRED/);
  });
  withEnv({EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE: "1", EVEJS_COOP_PLAYER_MARKET_ATOMIC: "1",
    EVEJS_COOP_NATIVE_ATOMIC_ROWS: "1", EVEJS_COOP_RUST_P2P_CLAIM: "1",
    EVEJS_COOP_PLAYER_MARKET_FILL_GUARD: "1", EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE: "1"}, () => {
    assert.doesNotThrow(() => guards.assertBuyReserveEnv());
  });
  withEnv({}, () => {
    assert.doesNotThrow(() => guards.assertBuyReserveEnv());
  });
});
