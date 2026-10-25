"use strict";
// Messages a courier pilot sends to the contract issuer. Pure text: nothing
// here sends anything, so the wording can be reviewed before it reaches a
// player. Delivery (in-game mail or a private chat line) is wired by the
// courier phase once the overlay can be installed again.
//
// Kinds:
//   accepted    - took the contract, package secured
//   departing   - undocked, on the way
//   delivered   - arrived, package handed over
//   failed      - courier lost the cargo (collateral goes to the issuer)
//   counter     - terms rejected, with a concrete price instead
const KINDS = Object.freeze(["accepted", "departing", "delivered", "failed", "counter"]);

function isk(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0 ISK";
  return Math.round(numeric).toLocaleString("en-US") + " ISK";
}

function pilotName(context) {
  return String(context && context.pilotName || "Courier");
}

function contractRef(context) {
  return String(context && context.contractID || "");
}

function buildNotice(kind, context) {
  if (!KINDS.includes(kind)) {
    return { status: "NO_NOTICE", reason: "unknown kind: " + kind };
  }
  const ctx = context || {};
  const name = pilotName(ctx);
  const id = contractRef(ctx);
  const volume = Number(ctx.volumeM3) || 0;
  const from = String(ctx.fromStationName || "origin");
  const to = String(ctx.toStationName || "destination");

  if (kind === "accepted") {
    return {
      status: "NOTICE",
      kind,
      subject: `Contract ${id} accepted`,
      body:
        `${name} here. I have accepted your contract ${id} and secured the sealed package ` +
        `(${Math.round(volume).toLocaleString("en-US")} m3) at ${from}. ` +
        `I will depart for ${to} and message you when I am under way.`,
    };
  }
  if (kind === "departing") {
    return {
      status: "NOTICE",
      kind,
      subject: `Contract ${id}: under way`,
      body:
        `${name} here. Undocked from ${from} with your package on board and warping to ${to}. ` +
        `Estimated arrival ${String(ctx.etaText || "shortly")}. ` +
        `If anything goes wrong you will hear it from me, not from the wreck.`,
    };
  }
  if (kind === "delivered") {
    return {
      status: "NOTICE",
      kind,
      subject: `Contract ${id} delivered`,
      body:
        `${name} here. Package delivered at ${to}. ` +
        `Thank you for the ${isk(ctx.reward)} - it was a clean run.`,
    };
  }
  if (kind === "failed") {
    return {
      status: "NOTICE",
      kind,
      subject: `Contract ${id}: I lost it`,
      body:
        `${name} here. I was attacked on the way to ${to} and the ship did not survive. ` +
        `The package is gone. Your collateral of ${isk(ctx.collateral)} is yours again, ` +
        `and I am not asking for the ${isk(ctx.reward)}.`,
    };
  }
  // counter
  const offered = Number(ctx.reward) || 0;
  const wanted = Number(ctx.quoteIsk) || 0;
  return {
    status: "NOTICE",
    kind,
    subject: `Contract ${id}: not at this price`,
    body:
      `${name} here. ${Math.round(volume).toLocaleString("en-US")} m3 from ${from} to ${to} ` +
      `for ${isk(offered)} does not cover the fuel and the risk of carrying ` +
      `${isk(ctx.collateral)} of collateral. ` +
      `I can do it for ${isk(wanted)}. Raise the reward to that and I will take it; ` +
      `keep it as it is and I will leave it for someone else.`,
    counterOfferIsk: wanted,
    minimumAcceptableIsk: wanted,
  };
}

// A courier only refuses on price when the reward is below what the published
// quote says the job is worth; otherwise it takes the work.
function negotiate(contract, quote) {
  const reward = Number(contract && contract.reward) || 0;
  const wanted = Number(quote && quote.totalIsk) || 0;
  if (!(wanted > 0)) return { status: "NO_NEGOTIATION", reason: "no quote" };
  if (reward >= wanted) return { status: "ACCEPTABLE", reward, wanted };
  return {
    status: "COUNTER_OFFER",
    reward,
    wanted,
    shortfallIsk: wanted - reward,
    notice: buildNotice("counter", {
      contractID: contract.contractID,
      volumeM3: contract.volume,
      reward,
      quoteIsk: wanted,
      collateral: contract.collateral,
      pilotName: quote.pilotName,
    }),
  };
}

module.exports = { KINDS, buildNotice, negotiate };
