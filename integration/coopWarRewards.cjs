"use strict";
// FW-142: a proven war contribution pays the PILOT, not only their rank.
//
// Owner ask (2026-11-05): "I want real LP, and ISK and reputation too, so this slowly grows
// you and the barricades give you something and the rank grows".
//
// The honest shape of that is small: the merit ledger (`coopWarMeritLedger`) already accepts a
// payout ONLY with an evidence key that names an exact physical event, and it already refuses a
// replay. Every accepted award is therefore a real, uniquely identified contribution, and this
// module turns that into the three currencies the client understands:
//
//   LP      -> the character's real loyalty-point wallet at the militia corporation
//              (services/corporation/lpWalletState.adjustCharacterWalletLPBalance), so the LP
//              store, the LP balance broadcast and every LP surface show it.
//   standing-> the character's real standing with the militia faction
//              (services/character/standingRuntime), clamped to the game's own limits.
//   merit   -> already handled by the ledger; enough merit is what raises the rank.
//
// ISK is deliberately NOT minted here. The only honest source is the war treasury, and a
// treasury payout releases a HELD escrow that was reserved from the faction's real wallet
// (`coopWarTreasury` RESERVE -> PAYOUT). Until a funded reserve exists for this pilot the
// answer is ISK_UNFUNDED with the reason, never an invented balance.
//
// Idempotent by the same evidence key as merit: one contribution pays LP and standing once,
// and a replay returns DUPLICATE instead of paying twice.
const fs = require("node:fs");
const path = require("node:path");
const sibling = (name) => require(path.join(__dirname, name + (fs.existsSync(path.join(__dirname, name + ".js")) ? ".js" : ".cjs")));
const warStore = sibling("coopFactionWarStore");

const TABLE = "corporationRuntime";
const KEY = "coop-faction-war\u001fmerit-rewards-v1";
const MAX_PAID = 8192;
const DEFAULT_LP_PER_MERIT = 5;
const DEFAULT_STANDING_PER_MERIT = 0.02;
const MAX_STANDING_PER_AWARD = 0.5;

const pos = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : 0;
const key = (x) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const num = (x, fallback = 0) => Number.isFinite(Number(x)) ? Number(x) : fallback;

// A pilot id is the war ledger's own identity ("coop-player-<characterID>" for a real player,
// "coop-pilot-NNN" for a virtual one). Only a real player has a wallet and a standing.
function characterIDFromPilotID(pilotID) {
  const match = /^coop-player-([0-9]{3,})$/.exec(String(pilotID || ""));
  return match ? pos(Number(match[1])) : 0;
}

function empty() {
  return { version: 1, paid: {} };
}

function validate(state) {
  if (!state || state.version !== 1 || !state.paid || typeof state.paid !== "object" ||
      Array.isArray(state.paid) || Object.keys(state.paid).length > MAX_PAID) {
    throw Error("WAR_REWARD_LEDGER_INVALID");
  }
  for (const [evidenceKey, row] of Object.entries(state.paid)) {
    if (!key(evidenceKey) || !row || !pos(row.characterID) || !pos(row.factionID) ||
        !Number.isFinite(num(row.lp)) || !Number.isFinite(num(row.standing))) {
      throw Error("WAR_REWARD_PAYOUT_CORRUPT");
    }
  }
  return state;
}

function rates(env = process.env) {
  const lpPerMerit = Math.max(0, Math.min(100, num(env.EVEJS_COOP_WAR_LP_PER_MERIT, DEFAULT_LP_PER_MERIT)));
  const standingPerMerit = Math.max(0, Math.min(1,
    num(env.EVEJS_COOP_WAR_STANDING_PER_MERIT, DEFAULT_STANDING_PER_MERIT)));
  return { lpPerMerit, standingPerMerit };
}

// What one award would pay, before any durable record is touched. Pure, so the campaign page
// and the tests can ask the same question the payout answers.
function quote({ meritDelta, factionID, env = process.env } = {}) {
  const merit = Math.max(0, Math.trunc(num(meritDelta, 0)));
  const { lpPerMerit, standingPerMerit } = rates(env);
  const standing = Math.min(MAX_STANDING_PER_AWARD, standingPerMerit * merit);
  return {
    merit,
    lp: Math.round(lpPerMerit * merit),
    standing: Math.round(standing * 10000) / 10000,
    factionID: pos(factionID),
  };
}

function createWarRewards({
  gameStore = null,
  lpWallet = null,
  standings = null,
  militiaCorporationFor = null,
  clock = () => Date.now(),
  env = process.env,
} = {}) {
  const store = gameStore || require("../gameStore");
  if (typeof store?.coopAtomicNativeRows?.transact !== "function") {
    throw Error("WAR_REWARD_AUTHORITIES_REQUIRED");
  }
  const transact = (fn) => store.coopAtomicNativeRows.transact([TABLE], fn);
  const wallet = lpWallet || require("../services/corporation/lpWalletState");
  const standingRuntime = standings || require("../services/character/standingRuntime");

  function enabled() {
    return env.EVEJS_COOP_FACTION_WAR === "1" && env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1";
  }

  function readPaid(evidenceKey) {
    return transact((tx) => {
      const state = validate(tx.get(TABLE, KEY) || empty());
      return state.paid[String(evidenceKey)] || null;
    });
  }

  // One call per ACCEPTED merit award. The evidence key must be the merit ledger's own key, so
  // the two ledgers can never disagree about whether a contribution happened.
  function payContribution({ characterID, factionID, meritDelta, evidenceKey, militiaCorporationID = 0, meta = {} } = {}) {
    if (!enabled()) return { status: "DISABLED" };
    const character = pos(characterID);
    const faction = pos(factionID);
    if (!character || !faction || !key(String(evidenceKey || ""))) {
      return { status: "BLOCKED", reason: "INVALID_REWARD_IDENTITY" };
    }
    const amount = quote({ meritDelta, factionID: faction, env });
    if (!(amount.merit > 0)) return { status: "BLOCKED", reason: "NO_MERIT" };

    // Reserve the payout row FIRST: a crash after the wallet write must not pay twice.
    let reservation = null;
    try {
      reservation = transact((tx) => {
        const state = validate(tx.get(TABLE, KEY) || empty());
        const paidKey = String(evidenceKey);
        if (state.paid[paidKey]) {
          const prior = state.paid[paidKey];
          return prior.characterID === character && prior.factionID === faction
            ? { status: "DUPLICATE", ...prior }
            : { status: "BLOCKED", reason: "WAR_REWARD_REPLAY_CONFLICT" };
        }
        const row = {
          characterID: character,
          factionID: faction,
          merit: amount.merit,
          lp: amount.lp,
          standing: amount.standing,
          at: Math.max(0, Math.trunc(num(clock(), 0))),
          lpApplied: false,
          standingApplied: false,
          evidence: Object.fromEntries(Object.entries(meta || {})
            .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
            .slice(0, 8)),
        };
        if (Object.keys(state.paid).length >= MAX_PAID) {
          throw Error("WAR_REWARD_LEDGER_FULL");
        }
        state.paid[paidKey] = row;
        validate(state);
        tx.put(TABLE, KEY, state);
        return { status: "RESERVED", ...row };
      });
    } catch (error) {
      return { status: "BLOCKED", reason: String(error && error.message || error) };
    }
    if (reservation.status !== "RESERVED") return reservation;

    const issuer = pos(militiaCorporationID) || pos(reservation.factionID);
    const applied = { lp: 0, standing: 0, isk: 0, iskStatus: "ISK_UNFUNDED" };

    if (reservation.lp > 0) {
      try {
        const result = wallet.adjustCharacterWalletLPBalance(character, issuer, reservation.lp,
          { reason: "faction-war contribution", evidenceKey: String(evidenceKey) });
        if (result && result.success === false && result.errorMsg) {
          applied.lpStatus = String(result.errorMsg);
        } else {
          applied.lp = reservation.lp;
          applied.lpApplied = true;
        }
      } catch (error) {
        applied.lpStatus = String(error && error.message || error);
      }
    }

    if (reservation.standing > 0 && typeof standingRuntime.getCharacterRawStanding === "function" &&
        typeof standingRuntime.setCharacterStanding === "function") {
      try {
        const current = num(standingRuntime.getCharacterRawStanding(character, reservation.factionID), 0);
        const next = Math.max(-10, Math.min(10, Math.round((current + reservation.standing) * 10000) / 10000));
        const result = standingRuntime.setCharacterStanding(character, reservation.factionID, next,
          { reason: "faction-war contribution", evidenceKey: String(evidenceKey) });
        if (result && result.success === false && result.errorMsg) {
          applied.standingStatus = String(result.errorMsg);
        } else {
          applied.standing = Math.round((next - current) * 10000) / 10000;
          applied.standingApplied = true;
        }
      } catch (error) {
        applied.standingStatus = String(error && error.message || error);
      }
    } else if (reservation.standing > 0) {
      applied.standingStatus = "STANDING_RUNTIME_UNAVAILABLE";
    }

    // Mark what really landed. A failed wallet call keeps the row for the operator, but it is
    // never retried blindly on the next tick: the answer names what happened.
    try {
      transact((tx) => {
        const state = validate(tx.get(TABLE, KEY) || empty());
        const row = state.paid[String(evidenceKey)];
        if (!row) return;
        row.lpApplied = applied.lpApplied === true;
        row.standingApplied = applied.standingApplied === true;
        row.lpStatus = applied.lpStatus || (row.lpApplied ? "APPLIED" : "NOT_APPLIED");
        row.standingStatus = applied.standingStatus || (row.standingApplied ? "APPLIED" : "NOT_APPLIED");
        row.settledAt = Math.max(0, Math.trunc(num(clock(), 0)));
        tx.put(TABLE, KEY, state);
      });
    } catch (_error) { /* the wallet already moved; the row keeps its reservation */ }

    return {
      status: "PAID",
      characterID: character,
      factionID: reservation.factionID,
      merit: reservation.merit,
      lp: applied.lp,
      standing: applied.standing,
      isk: 0,
      iskStatus: applied.iskStatus,
      lpStatus: applied.lpStatus || "APPLIED",
      standingStatus: applied.standingStatus || "APPLIED",
    };
  }

  return {
    payContribution,
    quote: (options) => quote({ ...options, env }),
    readPaid,
    rates: () => rates(env),
  };
}

module.exports = {
  DEFAULT_LP_PER_MERIT,
  characterIDFromPilotID,
  DEFAULT_STANDING_PER_MERIT,
  KEY,
  MAX_STANDING_PER_AWARD,
  TABLE,
  createWarRewards,
  empty,
  quote,
  rates,
  warStoreTable: warStore && warStore.TABLE ? warStore.TABLE : TABLE,
  validate,
};
