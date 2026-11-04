import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The client's market window lets a pilot pick "Corporation" as the wallet. Until now
// every such request died on assertPersonalMarketOnly:
//   "Corporation market orders are not wired into corporation wallets and hangars yet."
// (measured live 2026-11-04, owner 140000005, corporation 98000001). An IMMEDIATE sale
// now pays its proceeds into the corporation wallet through accountService's own
// transferCharacterBalanceToCorporation (journal entries on both sides + rollback), and
// only the CEO or a director may do it. Resting corporation orders still need corporate
// hangar escrow, so they keep an explicit refusal instead of silently selling personal
// stock as a corporation order.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const marketSource = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/services/market/marketProxyService.js"), "utf8");
const accountSource = fs.readFileSync(path.join(
  forkRoot, "Code/server/src/services/account/accountService.js"), "utf8");

function sellHandlerBody() {
  const start = marketSource.indexOf("async Handle_PlaceMultiSellOrder(");
  const end = marketSource.indexOf("async Handle_PlacePlexSellOrder(", start);
  return marketSource.slice(start, end);
}

test("an immediate corporation sale is no longer refused as 'not wired'", () => {
  const body = sellHandlerBody();
  assert.ok(!/assertPersonalMarketOnly\(useCorp\)/.test(body),
    "the personal-only guard must not run for the sell handler any more");
  assert.match(body, /resolveCorpMarketWallet\(session\)/);
  assert.match(body, /moveSaleProceedsToCorporation/);
});

test("only the corporation CEO or a director may sell into the corporation wallet", () => {
  const helper = marketSource.slice(
    marketSource.indexOf("function resolveCorpMarketWallet"),
    marketSource.indexOf("function moveSaleProceedsToCorporation"),
  );
  assert.match(helper, /corporation\.ceoID\) === characterID/);
  assert.match(helper, /CORPORATION_DIRECTOR_ROLE/);
  assert.match(helper, /NO_DIRECTOR_ROLE/);
  assert.match(marketSource, /CORPORATION_DIRECTOR_ROLE = 1n/,
    "director is role bit 0 in the client's corp role mask");
});

test("resting corporation sell orders are refused with an explanation, not silently sold", () => {
  const body = sellHandlerBody();
  assert.match(body, /durationDays, 0\) > 0/);
  assert.match(body, /corporate hangar escrow/);
});

test("proceeds move through the account service's transfer primitive", () => {
  assert.match(accountSource, /AccountService\.transferCharacterBalanceToCorporation = transferCharacterBalanceToCorporation;/);
  const helper = marketSource.slice(
    marketSource.indexOf("function moveSaleProceedsToCorporation"),
    marketSource.indexOf("function getStructureMarketLocation"),
  );
  assert.match(helper, /transferCharacterBalanceToCorporation/);
  assert.match(helper, /CORPORATION_WALLET_KEY_START/);
});

test("the sell result reports the gross the wallet was really credited", () => {
  assert.match(marketSource, /totalGross: roundIsk\(sellResult\.totalGross \|\| 0\)/);
  assert.match(sellHandlerBody(), /proceedsToCorp = roundIsk\(proceedsToCorp \+ Number\(result\.totalGross\)\)/);
});
