import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The owner's decision (2026-11-05): "I wanted to give the traders that much because I cannot sell my
// own things - this is my way to play and earn." The endowment is the one place in the fork that puts
// new ISK into the world, so these tests pin the guards: explicit flag, one shot, real wallet API,
// durable receipt, and a clear refusal for every unsafe state.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { createEndowment } = require(path.join(forkRoot, "Code/server/src/space/coopTraderEndowment.js"));

const receiptPath = () => path.join(os.tmpdir(),
  `endowment-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

function fakeWallet({ balance = 4_867_000, failOn = null } = {}) {
  const writes = [];
  return {
    writes,
    readWallet: () => (failOn === "read"
      ? { status: "CORP_WALLET_UNAVAILABLE" }
      : { status: "OK", divisions: { "1000": { balance } } }),
    applyDelta: ({ corporationID, division, delta }) => {
      if (failOn === "write") return { status: "CORP_CREDIT_FAILED" };
      writes.push({ corporationID, division, delta });
      return { status: "OK", balance: balance + delta };
    },
  };
}

test("without the flag nothing happens at all", () => {
  const file = receiptPath();
  const wallet = fakeWallet();
  const endowment = createEndowment({ file, amountISK: 50_000_000_000, corporationID: 1000035,
    walletApi: wallet, env: {} });
  assert.equal(endowment.apply().status, "DISABLED");
  assert.equal(wallet.writes.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("it credits the real corporate wallet once and records the receipt", () => {
  const file = receiptPath();
  const wallet = fakeWallet({ balance: 4_867_000 });
  const endowment = createEndowment({ file, amountISK: 50_000_000_000, corporationID: 1000035,
    walletApi: wallet, env: { EVEJS_COOP_TRADER_ENDOWMENT: "1" }, now: () => 1_700_000_000_000 });
  const first = endowment.apply();
  assert.equal(first.status, "ENDOWED");
  assert.equal(wallet.writes.length, 1);
  assert.deepEqual(wallet.writes[0], { corporationID: 1000035, division: "1000", delta: 50_000_000_000 });
  assert.equal(first.beforeISK, 4_867_000);
  assert.equal(first.afterISK, 50_004_867_000);
  assert.equal(first.reason, "OWNER_ENDOWMENT");
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(receipt.corporationID, 1000035);
  assert.equal(receipt.amountISK, 50_000_000_000);
  assert.equal(receipt.status, "ENDOWED");
  fs.rmSync(file, { force: true });
});

test("a second run is refused: the money is never applied twice", () => {
  const file = receiptPath();
  const wallet = fakeWallet();
  const env = { EVEJS_COOP_TRADER_ENDOWMENT: "1" };
  const make = () => createEndowment({ file, amountISK: 50_000_000_000, corporationID: 1000035,
    walletApi: wallet, env, now: () => 1 });
  assert.equal(make().apply().status, "ENDOWED");
  const second = make().apply();
  assert.equal(second.status, "ALREADY_ENDOWED");
  assert.equal(wallet.writes.length, 1, "one credit, ever");
  fs.rmSync(file, { force: true });
});

test("a corrupt receipt blocks instead of endowing again", () => {
  const file = receiptPath();
  fs.writeFileSync(file, "{ this is not json");
  const wallet = fakeWallet();
  const endowment = createEndowment({ file, amountISK: 50_000_000_000, corporationID: 1000035,
    walletApi: wallet, env: { EVEJS_COOP_TRADER_ENDOWMENT: "1" } });
  assert.equal(endowment.apply().reason, "ENDOWMENT_RECEIPT_UNREADABLE");
  assert.equal(wallet.writes.length, 0);
  fs.rmSync(file, { force: true });
});

test("a bad amount or corporation is refused before the wallet is touched", () => {
  for (const args of [
    { amountISK: 0, corporationID: 1000035 },
    { amountISK: -5, corporationID: 1000035 },
    { amountISK: "not a number", corporationID: 1000035 },
    { amountISK: 1000, corporationID: 0 },
    { amountISK: 1000, corporationID: 1.5 },
  ]) {
    const wallet = fakeWallet();
    const file = receiptPath();
    const endowment = createEndowment({ file, walletApi: wallet,
      env: { EVEJS_COOP_TRADER_ENDOWMENT: "1" }, ...args });
    assert.equal(endowment.apply().status, "BLOCKED");
    assert.equal(wallet.writes.length, 0, "no wallet write without a valid decision");
    fs.rmSync(file, { force: true });
  }
});

test("an unreadable or refusing wallet leaves the receipt unwritten", () => {
  for (const failOn of ["read", "write"]) {
    const file = receiptPath();
    const wallet = fakeWallet({ failOn });
    const endowment = createEndowment({ file, amountISK: 50_000_000_000, corporationID: 1000035,
      walletApi: wallet, env: { EVEJS_COOP_TRADER_ENDOWMENT: "1" } });
    const outcome = endowment.apply();
    assert.equal(outcome.status, "BLOCKED");
    assert.equal(fs.existsSync(file), false, "no receipt for money that never moved");
  }
});
