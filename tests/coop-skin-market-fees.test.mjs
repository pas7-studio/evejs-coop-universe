import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The skin market quotes: broker fee per listing duration, sales tax and the buyer fee. They must
// come from one policy, or the window would quote two different numbers for the same purchase.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const fees = require(path.join(forkRoot, "Code/server/src/space/coopSkinMarketFees.js"));
const {
  SKIN_MARKET_FEES_PROTO_ROOT,
  createSkinMarketFeesGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/skinMarketFeesGatewayService.js"));

const API = "eve_public.cosmetic.market.api";
const service = createSkinMarketFeesGatewayService({skinMarketFees: fees});

const call = (typeName) => service.handleRequest(typeName, {
  payload: {value: Buffer.alloc(0)},
  authoritative_context: {identity: {character: {sequential: 7}}},
});
const decode = (typeName, buffer) =>
  SKIN_MARKET_FEES_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));

test("broker fees are the real rates, per duration", () => {
  const result = call(`${API}.GetBrokerFeesRequest`);
  assert.equal(result.statusCode, 200);
  const body = decode(`${API}.GetBrokerFeesResponse`, result.responsePayloadBuffer);
  assert.equal(body.broker_fees.length, fees.BROKER_FEE_RATES.length);
  const first = body.broker_fees[0];
  assert.equal(Number(first.duration.seconds), 86400);
  assert.equal(Number(first.fee.units), 0, "sint64 decodes as a Long");
  assert.equal(first.fee.nanos, 10_000_000, "1 % expressed in nanos");
  assert.equal(body.broker_fees_per_duration.length, body.broker_fees.length,
    "the per-duration branch quotes the same rates");
  for (const row of body.broker_fees) {
    assert.ok(Number(row.duration.seconds) > 0, "a duration-less fee is not a quote");
  }
});

test("tax and buyer fee come from the same policy", () => {
  const tax = decode(`${API}.GetTaxRateResponse`, call(`${API}.GetTaxRateRequest`).responsePayloadBuffer);
  assert.equal(Number(tax.tax_rate.units), 0);
  assert.equal(tax.tax_rate.nanos, fees.TAX_RATE_NANOS);

  const buyer = decode(`${API}.GetBuyerFeeResponse`, call(`${API}.GetBuyerFeeRequest`).responsePayloadBuffer);
  assert.equal(Number(buyer.buyer_fee.loyalty_points.amount), fees.BUYER_FEES[0].defaultFee,
    "a skin this world mints is tier 1, so the quote is the tier-1 default");
});

test("the buyer fee definition lists every tier with default and branded fees", () => {
  const body = decode(`${API}.GetBuyerFeesDefinitionResponse`,
    call(`${API}.GetBuyerFeesDefinitionRequest`).responsePayloadBuffer);
  assert.equal(body.buyer_fees_version, fees.BUYER_FEE_VERSION);
  assert.equal(body.buyer_fees.length, fees.BUYER_FEES.length);
  for (const [index, row] of body.buyer_fees.entries()) {
    assert.equal(row.skin_tier.level, fees.BUYER_FEES[index].tier);
    assert.equal(Number(row.default_fee.loyalty_points.amount), fees.BUYER_FEES[index].defaultFee);
    assert.equal(Number(row.branded_fee.loyalty_points.amount), fees.BUYER_FEES[index].brandedFee);
  }
});
