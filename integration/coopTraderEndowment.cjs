"use strict";
// COOP-ENDOW: the owner's explicit, one-shot endowment for the trading corporation.
//
// Owner statement 2026-11-05: "I wanted to give them that much because I cannot sell my own things -
// this is my way to play, have fun and earn; it is not my fault the economy here is complex and we
// have not implemented it yet."
//
// This is the ONLY place in the fork that puts new ISK into the world, and it is deliberately
// shaped so it can never happen by accident:
//
//   * it only runs when EVEJS_COOP_TRADER_ENDOWMENT=1 and an amount is configured;
//   * it applies ONCE: a durable receipt (`<file>`) records the corporation, the amount and the
//     wallet before/after, and a second run refuses with ALREADY_ENDOWED;
//   * it writes through the same native corporation wallet API every other ISK movement uses
//     (coopCorpWallet applyDelta), so the balance never becomes a non-canonical number;
//   * it announces itself: a `space.trader-endowment` coop event with the corporation, the amount
//     and both balances, plus an `OWNER_ENDOWMENT` reason in the receipt.
//
// Nothing here trades. The trader still buys only real asks at <= 90 % of a real reference price, so
// the endowment decides how much the corporation CAN buy, never what it buys.
const fs = require("node:fs");
const path = require("node:path");

const probe = require(path.join(__dirname, "coopRuntimeProbe"));

const DIVISION = "1000";
const isk = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) / 100 : null;
};

function loadWallet() {
  try {
    return require(path.join(__dirname, "coopCorpWallet.cjs"));
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND")
      return require(path.join(__dirname, "coopCorpWallet"));
    throw error;
  }
}

function readReceipt(file) {
  try {
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    return receipt && Number(receipt.version) === 1 ? receipt : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeReceipt(file, receipt) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(receipt));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function createEndowment({
  file,
  amountISK,
  corporationID,
  gameStore = null,
  corporationState = null,
  walletApi = null,
  now = () => Date.now(),
  env = process.env,
} = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw Error("ENDOWMENT_RECEIPT_PATH_REQUIRED");
  const enabled = () => env.EVEJS_COOP_TRADER_ENDOWMENT === "1";

  // Applies the endowment once. Returns the decision without touching the wallet when it must not.
  function apply() {
    if (!enabled()) return { status: "DISABLED", reason: "EVEJS_COOP_TRADER_ENDOWMENT_NOT_SET" };
    const amount = isk(amountISK);
    if (!Number.isSafeInteger(Number(corporationID)) || Number(corporationID) <= 0)
      return { status: "BLOCKED", reason: "ENDOWMENT_CORPORATION_INVALID" };
    if (amount === null || amount <= 0)
      return { status: "BLOCKED", reason: "ENDOWMENT_AMOUNT_INVALID" };
    let previous;
    try {
      previous = readReceipt(file);
    } catch (error) {
      // A corrupt receipt must stop the run: re-applying would endow twice.
      return { status: "BLOCKED", reason: "ENDOWMENT_RECEIPT_UNREADABLE" };
    }
    if (previous) {
      return { status: "ALREADY_ENDOWED", corporationID: Number(previous.corporationID),
        amountISK: Number(previous.amountISK), afterISK: Number(previous.afterISK),
        at: Number(previous.at) };
    }
    const wallet = walletApi || loadWallet();
    const read = wallet.readWallet({ corporationState, gameStore,
      corporationID: Number(corporationID) });
    if (!read || read.status !== "OK")
      return { status: "BLOCKED", reason: String(read && read.status || "CORP_WALLET_UNAVAILABLE") };
    const before = isk(read.divisions && read.divisions[DIVISION] && read.divisions[DIVISION].balance);
    if (before === null) return { status: "BLOCKED", reason: "CORP_WALLET_INVALID" };
    const written = wallet.applyDelta({ corporationState, gameStore,
      corporationID: Number(corporationID), division: DIVISION, delta: amount });
    if (!written || written.status !== "OK")
      return { status: "BLOCKED",
        reason: String(written && (written.reason || written.status) || "CORP_CREDIT_FAILED") };
    const after = isk(written.balance) === null ? isk(before + amount) : isk(written.balance);
    const receipt = {
      version: 1,
      status: "ENDOWED",
      reason: "OWNER_ENDOWMENT",
      corporationID: Number(corporationID),
      division: DIVISION,
      amountISK: amount,
      beforeISK: before,
      afterISK: after,
      at: now(),
    };
    try {
      writeReceipt(file, receipt);
    } catch (error) {
      // Money already moved: refuse to repeat it by writing what we can, and say so loudly.
      probe.observe("space.trader-endowment", null, null,
        { ...receipt, status: "ENDOWED_RECEIPT_NOT_WRITTEN",
          error: String(error && error.message || error).slice(0, 90) });
      return { ...receipt, status: "ENDOWED_RECEIPT_NOT_WRITTEN",
        error: String(error && error.message || error).slice(0, 90) };
    }
    probe.observe("space.trader-endowment", null, null, receipt);
    return receipt;
  }

  return Object.freeze({ apply, receipt: () => readReceipt(file) });
}

module.exports = { createEndowment, DIVISION };
