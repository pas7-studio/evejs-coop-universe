import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// eve_public.presence.api.{GetCorporation,GetAlliance,GetFaction}: the client
// asks "which corporation / alliance / faction is this character in". Answered
// from the live session, then the durable character record, then the corporation
// record - and NOT_FOUND when the character is unknown, because the client has no
// way to represent "no corporation" (alliance/faction have an explicit empty
// branch, corporation does not).
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const modulePath = path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/presenceGatewayService.js");
const {
  createPresenceGatewayService,
  PRESENCE_PROTO_ROOT,
} = require(modulePath);

function call(service, typeName, characterID) {
  const requestType = PRESENCE_PROTO_ROOT.lookupType(typeName);
  const payload = Buffer.from(requestType
    .encode(requestType.create({character: {sequential: characterID}})).finish());
  return service.handleRequest(typeName, {payload: {value: payload}});
}

function decode(typeName, buffer) {
  return PRESENCE_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));
}

const membership = {
  characterID: 140000107,
  corporationID: 1000044,
  allianceID: 0,
  factionID: 500001,
};
const service = createPresenceGatewayService({
  presenceLookup: (id) => (Number(id) === membership.characterID ? membership : null),
});

test("corporation presence returns the real corporation id", () => {
  const result = call(service, "eve_public.presence.api.GetCorporationRequest",
    membership.characterID);
  assert.equal(result.statusCode, 200);
  assert.equal(result.responseTypeName, "eve_public.presence.api.GetCorporationResponse");
  assert.equal(decode("eve_public.presence.api.GetCorporationResponse",
    result.responsePayloadBuffer).corporation.sequential, 1000044);
});

test("a character without an alliance says so instead of sending zero", () => {
  const result = call(service, "eve_public.presence.api.GetAllianceRequest",
    membership.characterID);
  assert.equal(result.statusCode, 200);
  const body = decode("eve_public.presence.api.GetAllianceResponse",
    result.responsePayloadBuffer);
  assert.equal(body.no_alliance, true);
  assert.equal(body.alliance, null, "the oneof branch must stay unset");
});

test("faction presence returns the militia faction", () => {
  const result = call(service, "eve_public.presence.api.GetFactionRequest",
    membership.characterID);
  const body = decode("eve_public.presence.api.GetFactionResponse",
    result.responsePayloadBuffer);
  // faction.Identifier.sequential is uint64, so protobufjs decodes it as a Long
  assert.equal(Number(body.faction.sequential), 500001);
  assert.equal(body.no_faction, false);
});

test("an unknown character is NOT_FOUND, never a fake zero membership", () => {
  for (const typeName of [
    "eve_public.presence.api.GetCorporationRequest",
    "eve_public.presence.api.GetAllianceRequest",
    "eve_public.presence.api.GetFactionRequest",
  ]) {
    const result = call(service, typeName, 999999999);
    assert.equal(result.statusCode, 5, typeName);
    assert.equal(result.responsePayloadBuffer.length, 0, typeName);
  }
});

test("the lookup prefers a live session and falls back to the durable record", () => {
  const {createMembershipLookup} = require(modulePath);
  const lookup = createMembershipLookup({
    sessions: {findSessionByCharacterID: (id) => (Number(id) === 7 ? {corporationID: 98000001} : null)},
    characters: () => ({
      7: {corporationID: 1000044, allianceID: 99000001, factionID: 500002},
      8: {corporationID: 1000044, allianceID: 0, factionID: 0},
    }),
    corporations: (corporationID) => (Number(corporationID) === 1000044
      ? {allianceID: 99000002, factionID: 500003}
      : null),
  });
  const live = lookup(7);
  assert.equal(live.corporationID, 98000001, "the live session wins over the durable record");
  assert.equal(live.allianceID, 99000001, "the durable record fills a value the session lacks");

  const fallback = lookup(8);
  assert.equal(fallback.allianceID, 99000002, "the corporation record fills a missing alliance");
  assert.equal(fallback.factionID, 500003, "the corporation record fills a missing faction");

  assert.equal(lookup(0), null);
});
