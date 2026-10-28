// FW-038 guard: the world's money and its navies sit on opposite sides.
// Measured 2026-10-28: ORE (500014) holds 136.5 M ISK and has NO combat hulls;
// 500001/500004/500011/500020 can field a navy and hold exactly 0 ISK. A faction
// with money must be able to hire a faction with ships, or no war can ever escrow
// a bounty. The decision is pure; it moves no ISK and creates none.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { proposeContracts } = require("../integration/coopWarMercenaryContract.cjs");

const NEED = 2500000; // 25 000 ISK in cents
const capabilities = [
  { factionID: 500004, status: "CAN_FIELD" },
  { factionID: 500011, status: "CAN_FIELD" },
  { factionID: 500014, status: "NO_NAVY" },
];
const treasuries = [
  { factionID: 500014, corporationID: 1000129, balanceCents: 13655429296 },
  { factionID: 500004, corporationID: 1000120, balanceCents: 0 },
  { factionID: 500011, corporationID: 1000138, balanceCents: 0 },
];

test("a funded faction without a navy is paired with a navy that has no money", () => {
  const out = proposeContracts({ capabilities, treasuries, needCents: NEED });
  assert.equal(out.status, "PROPOSED");
  assert.equal(out.proposals.length, 1);
  const p = out.proposals[0];
  assert.equal(p.payerFactionID, 500014);
  assert.equal(p.payerCorporationID, 1000129);
  assert.equal(p.mercenaryFactionID, 500004, "the lowest navy faction is chosen deterministically");
  assert.equal(p.amountCents, NEED);
  assert.equal(p.reason, "NAVY_WITHOUT_TREASURY_PAIRED_WITH_TREASURY_WITHOUT_NAVY");
});

test("nothing is proposed when the payer cannot cover the bounty", () => {
  const out = proposeContracts({
    capabilities, needCents: NEED,
    treasuries: [{ factionID: 500014, corporationID: 1000129, balanceCents: NEED - 1 }],
  });
  assert.equal(out.status, "REFUSED");
  assert.equal(out.reason, "NO_FUNDED_NAVY_PAIR");
});

test("a faction that can fight and pay needs no contract", () => {
  const out = proposeContracts({
    needCents: NEED,
    capabilities: [{ factionID: 500004, status: "CAN_FIELD" }],
    treasuries: [{ factionID: 500004, corporationID: 1000120, balanceCents: 10 * NEED }],
  });
  assert.equal(out.status, "REFUSED");
  assert.equal(out.refusals[0].reason, "ALREADY_SELF_SUFFICIENT");
});

test("an already funded navy is never double-paid, and a need of zero is refused", () => {
  const out = proposeContracts({
    needCents: NEED,
    capabilities: [{ factionID: 500011, status: "CAN_FIELD" }],
    treasuries: [
      { factionID: 500014, corporationID: 1000129, balanceCents: 50 * NEED },
      { factionID: 500011, corporationID: 1000138, balanceCents: 9 * NEED },
    ],
  });
  assert.equal(out.status, "REFUSED");
  assert.equal(out.refusals[0].reason, "PAYEE_ALREADY_FUNDED");
  assert.equal(proposeContracts({ needCents: 0 }).status, "REFUSED");
  assert.equal(proposeContracts({ needCents: NEED }).reason, "NO_FUNDED_NAVY_PAIR");
});
