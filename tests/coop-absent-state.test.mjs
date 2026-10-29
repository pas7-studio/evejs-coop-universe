import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// assetholding (asset/entitlement) and payment schedules/codes hold no state in this world:
// no reserve banks, no entitlement rows, no schedules, no redemption codes. The answers say
// that explicitly instead of the default empty message the client renders as "nothing here".
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const servicePath = path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/absentStateGatewayService.js");
const {
  ABSENT_PROTO_ROOT,
  HANDLED_REQUEST_TYPES,
  createAbsentStateGatewayService,
} = require(servicePath);

const service = createAbsentStateGatewayService();
const call = (typeName) => service.handleRequest(typeName, {payload: {value: Buffer.alloc(0)}});

test("the seven absent-domain types are all handled", () => {
  assert.equal(HANDLED_REQUEST_TYPES.length, 7);
  for (const typeName of HANDLED_REQUEST_TYPES) {
    const result = call(typeName);
    assert.ok(result, typeName);
    assert.equal(result.responseTypeName, typeName.replace(/Request$/, "Response"), typeName);
  }
});

test("a specific asset, entitlement or schedule is NOT_FOUND", () => {
  for (const typeName of [
    "eve_public.assetholding.asset.api.GetRequest",
    "eve_public.assetholding.entitlement.api.GetRequest",
    "eve_public.assetholding.entitlement.api.admin.ExpireRequest",
    "eve_public.payment.schedule.api.GetRequest",
  ]) {
    const result = call(typeName);
    assert.equal(result.statusCode, 5, typeName);
    assert.ok(result.statusMessage.length > 0, `${typeName} must explain itself`);
  }
});

test("redeeming something that was never granted is refused, not silently accepted", () => {
  const entitlement = call("eve_public.assetholding.entitlement.api.RedeemRequest");
  assert.equal(entitlement.statusCode, 9);
  assert.match(entitlement.statusMessage, /nothing to redeem/);
  const code = call("eve_public.payment.code.api.RedeemRequest");
  assert.equal(code.statusCode, 9);
  assert.match(code.statusMessage, /not configured/);
});

test("no active schedule of a type is an empty shape, not a fake schedule", () => {
  const result = call("eve_public.payment.schedule.api.GetActiveByTypeRequest");
  assert.equal(result.statusCode, 200);
  const body = ABSENT_PROTO_ROOT
    .lookupType("eve_public.payment.schedule.api.GetActiveByTypeResponse")
    .decode(result.responsePayloadBuffer);
  assert.equal(body.schedule, null, "the optional schedule must stay unset");
});

test("it never answers a type it does not own", () => {
  for (const other of [
    "eve_public.store.offer.api.GetAllRequest",
    "eve_public.stargate.lock.api.admin.GetAllRequest",
    "eve_public.dailygoal.api.GetAllCurrentRequest",
  ]) {
    assert.equal(service.handleRequest(other, {payload: {value: Buffer.alloc(0)}}), null, other);
  }
});
