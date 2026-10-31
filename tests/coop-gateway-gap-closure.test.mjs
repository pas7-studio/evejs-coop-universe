// COOP_GATEWAY_GAP_CLOSURE_V1
//
// Six request types the installed client really sends had no explicit answer. Each one is now
// answered with something that is true of this world, and these tests pin the truth:
//   - sequencing quotes charge 0 PLEX (the price is component licences) and quote the duration
//     the store actually uses;
//   - an early-completion quote covers every remaining time and also costs 0 PLEX;
//   - a freelance item delivery says `project_does_not_exist` instead of pretending an escrow;
//   - the Aura-assistant query is NOT_IMPLEMENTED with a reason, never a fabricated answer;
//   - the deprecated planet-configuration list is empty because there are none.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {ENGINE_CODE, skipWithoutEngine} from "./_support/engineCheckout.mjs";

const require = createRequire(import.meta.url);
const SERVICES = path.join(ENGINE_CODE, "server/src/_secondary/express/gatewayServices");

const SEQUENCING_API = "eve_public.cosmetic.ship.skin.thirdparty.sequencing.api";
const DELIVER_API = "eve_public.freelance.contributionmethod.itemdelivery.api";
const ASSISTANT_API = "eve_public.ai.assistant.chat.api";

const envelope = {
  payload: {value: Buffer.alloc(0)},
  authoritative_context: {identity: {character: {sequential: 2119000001}}},
};

function sequencingService(durationMs = 30000) {
  const module = require(path.join(SERVICES, "skinSequencingGatewayService.js"));
  return {
    module,
    service: module.createSkinSequencingGatewayService({
      skinSequencing: {durationMs: () => durationMs},
    }),
  };
}

test("the sequencing quotes are declared and answered", {skip: skipWithoutEngine()}, () => {
  const {service} = sequencingService();
  for (const type of [
    `${SEQUENCING_API}.GetTierPricingRequest`,
    `${SEQUENCING_API}.GetTierDurationsRequest`,
    `${SEQUENCING_API}.GetEarlyCompletionPricingRequest`,
  ]) {
    assert.ok(service.handledRequestTypes.includes(type), `${type} is not handled`);
  }
});

test("a tier price is 0 PLEX: this world charges component licences, not PLEX",
  {skip: skipWithoutEngine()}, () => {
    const {module, service} = sequencingService();
    const answer = service.handleRequest(`${SEQUENCING_API}.GetTierPricingRequest`, envelope);
    assert.equal(answer.statusCode, 200);
    const decoded = module.SEQUENCING_PROTO_ROOT
      .lookupType(answer.responseTypeName)
      .decode(answer.responsePayloadBuffer);
    assert.ok(decoded.prices.length >= 4, "the price table must cover the client's tiers");
    for (const price of decoded.prices) {
      assert.equal(Number(price.plex.total_in_cents), 0, "a sequencing job costs no PLEX here");
    }
    assert.equal(Number(decoded.discount_percentage_applied), 0);
  });

test("a tier duration is the duration the store will really use", {skip: skipWithoutEngine()}, () => {
  const {module, service} = sequencingService(45000);
  const answer = service.handleRequest(`${SEQUENCING_API}.GetTierDurationsRequest`, envelope);
  assert.equal(answer.statusCode, 200);
  const decoded = module.SEQUENCING_PROTO_ROOT
    .lookupType(answer.responseTypeName)
    .decode(answer.responsePayloadBuffer);
  assert.ok(decoded.durations.length >= 4);
  for (const entry of decoded.durations) {
    assert.equal(Number(entry.duration.seconds), 45, "the quoted duration must be the real one");
  }
});

test("an early-completion quote covers every remaining time and costs 0 PLEX",
  {skip: skipWithoutEngine()}, () => {
    const {module, service} = sequencingService(30000);
    const answer = service.handleRequest(
      `${SEQUENCING_API}.GetEarlyCompletionPricingRequest`, envelope);
    assert.equal(answer.statusCode, 200);
    const decoded = module.SEQUENCING_PROTO_ROOT
      .lookupType(answer.responseTypeName)
      .decode(answer.responsePayloadBuffer);
    assert.equal(decoded.prices.length, 1);
    const [price] = decoded.prices;
    assert.equal(Number(price.remaining_greater.seconds), 0, "no remaining time is left unpriced");
    assert.equal(Number(price.remaining_lesser_or_equal.seconds), 30,
      "a whole job's remaining time is covered");
    assert.equal(Number(price.plex.total_in_cents), 0, "expediting is free, so it must say 0");
  });

test("a freelance item delivery answers project_does_not_exist", {skip: skipWithoutEngine()}, () => {
  const service = require(path.join(SERVICES, "freelanceGatewayService.js"))
    .createFreelanceGatewayService({emptyPayload: Buffer.alloc(0)});
  assert.ok(service.handledRequestTypes.includes(`${DELIVER_API}.DeliverRequest`));
  const answer = service.handleRequest(`${DELIVER_API}.DeliverRequest`, envelope);
  assert.equal(answer.statusCode, 200, "the client reads the oneof, not the status code");
  assert.equal(answer.responseTypeName, `${DELIVER_API}.DeliverResponse`);
  // field 13 in a oneof is tag 0x68 + 0x6A? it is 13<<3 = 104 = 0x68 with wire type 2 -> 0x6a
  assert.deepEqual([...answer.responsePayloadBuffer], [0x6a, 0x00],
    "the payload must carry exactly the empty project_does_not_exist branch");
});

test("the deprecated planet-configuration list answers an empty list", {skip: skipWithoutEngine()},
  () => {
    // The service itself reads world data at construction, which an unisolated node:test process
    // must not open. So this pins the two things that can be checked here: the response type is a
    // real type in the shipped proto bundle, and the service declares the call.
    const sovProto = require(path.join(ENGINE_CODE, "server/src/services/sovereignty/sovGatewayProto.js"));
    const type = sovProto.getSovereigntyProtoTypes().planetGetAllConfigurationsResponse;
    assert.ok(type.fullName.endsWith(
      "eve_public.sovereignty.resource.planet.api.GetAllConfigurationsResponse"));
    const encoded = type.encode(type.create({configurations: []})).finish();
    assert.equal(encoded.length, 0, "an empty list is zero bytes: the honest 'there are none'");

    const source = require("node:fs").readFileSync(
      path.join(SERVICES, "sovereigntyGatewayService.js"), "utf8");
    assert.match(source,
      /"eve_public\.sovereignty\.resource\.planet\.api\.GetAllConfigurationsRequest"/);
    assert.match(source, /configurations: \[\]/);
  });

test("the aura-assistant query is NOT_IMPLEMENTED, never a fabricated answer",
  {skip: skipWithoutEngine()}, () => {
    const service = require(path.join(SERVICES, "smallSurfacesGatewayService.js"))
      .createSmallSurfacesGatewayService({});
    assert.ok(service.handledRequestTypes.includes(`${ASSISTANT_API}.QueryRequest`));
    const answer = service.handleRequest(`${ASSISTANT_API}.QueryRequest`, envelope);
    assert.equal(answer.statusCode, 501);
    assert.match(answer.statusMessage, /no AI assistant/);
    assert.equal(answer.responsePayloadBuffer.length, 0);
  });
