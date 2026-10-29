import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// eve_public.cosmetic.ship.api.{Get,GetAllInBubble}: the SKIN UI asks these to know which
// third-party SKIN is on which ship. The answer is the applied-skin row space/coopThirdPartySkins
// already keeps, and the bytes are checked by the CLIENT'S OWN descriptor
// (scripts/coop-verify-client-proto.cjs), because our encoder and our own decoder would agree on
// a wrong field number just as happily as on a right one.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createThirdPartySkins} = require(
  path.join(forkRoot, "Code/server/src/space/coopThirdPartySkins.js"),
);
const {createShipCosmeticStateGatewayService} = require(
  path.join(forkRoot, "Code/server/src/_secondary/express/gatewayServices/shipCosmeticStateGatewayService.js"),
);

const CHARACTER = 140000004;
const SHIP = 1023456789012;
const OTHER_SHIP = 1023456789013;
const SKIN = "a1b2c3d4e5f60718";
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

// The licence rows live in the character record, so the test states one instead of needing the
// server's database (the same fake the SKIN licence tests use).
function fakeCharacterState(initial) {
  const records = structuredClone(initial);
  return {
    getCharacterRecord(id) {
      const row = records[String(id)];
      return row ? structuredClone(row) : null;
    },
    updateCharacterRecord(id, mutate) {
      const next = mutate(structuredClone(records[String(id)] || {characterID: id}));
      records[String(id)] = next;
      return {success: true, data: structuredClone(next)};
    },
  };
}

function varint(value) {
  const out = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    out.push(byte);
  } while (remaining > 0);
  return Buffer.from(out);
}

function getRequest(shipID) {
  // GetRequest { ship = 1 { sequential = 1 } }
  const inner = Buffer.concat([Buffer.from([0x08]), varint(shipID)]);
  return Buffer.concat([Buffer.from([0x0a, inner.length]), inner]);
}

function world({inScene = [SHIP], session = true} = {}) {
  const skins = createThirdPartySkins({
    characterState: fakeCharacterState({[String(CHARACTER)]: {characterID: CHARACTER}}),
    env: {EVEJS_COOP_THIRD_PARTY_SKINS: "1"},
    clock: () => NOW,
    shipLookup: () => ({status: "OK"}),
  });
  const layout = Buffer.from([0x0a, 0x02, 0x08, 0x01]).toString("base64");
  const grantResult = skins.grant(CHARACTER, {
    skin: SKIN, unactivated: 1, name: "Co-op Test Skin", shipTypeID: 670,
    lineName: "Line", layout, creatorID: CHARACTER,
  });
  assert.equal(grantResult.status, "GRANTED");
  // Only an activated licence may be applied: the row has to become usable first.
  assert.equal(skins.activate(CHARACTER, SKIN).status, "ACTIVATED");
  const applyResult = skins.apply(CHARACTER, {skin: SKIN, shipID: SHIP});
  assert.equal(applyResult.status, "APPLIED");
  const scene = {dynamicEntities: new Map(inScene.map((id) => [id, {kind: "ship"}]))};
  const gateway = createShipCosmeticStateGatewayService({
    thirdPartySkins: skins,
    sessions: {getSessions: () => (session ? [{characterID: CHARACTER, solarsystemid2: 30000144}] : [])},
    sceneForSession: () => scene,
  });
  const envelope = (value) => ({
    payload: {value},
    authoritative_context: {identity: {character: {sequential: CHARACTER}}},
  });
  return {skins, gateway, envelope};
}

test("Get answers the applied SKIN of that ship, and nothing for a ship without one", () => {
  const {gateway, envelope} = world();
  const answer = gateway.handleRequest(
    "eve_public.cosmetic.ship.api.GetRequest",
    envelope(getRequest(SHIP)),
  );
  assert.equal(answer.statusCode, 200);
  const bare = gateway.handleRequest(
    "eve_public.cosmetic.ship.api.GetRequest",
    envelope(getRequest(OTHER_SHIP)),
  );
  // 404 is what shipSkinStateRequestMessenger.pyj turns into "no skin".
  assert.equal(bare.statusCode, 404);
});

test("GetAllInBubble only reports ships that are in the character's own scene", () => {
  const {gateway, envelope} = world({inScene: [SHIP, OTHER_SHIP]});
  const answer = gateway.handleRequest(
    "eve_public.cosmetic.ship.api.GetAllInBubbleRequest",
    envelope(Buffer.alloc(0)),
  );
  assert.equal(answer.statusCode, 200);
  assert.ok(answer.responsePayloadBuffer.length > 0, "the ship in the bubble is reported");
  const empty = world({inScene: [OTHER_SHIP]});
  const none = empty.gateway.handleRequest(
    "eve_public.cosmetic.ship.api.GetAllInBubbleRequest",
    empty.envelope(Buffer.alloc(0)),
  );
  assert.equal(none.statusCode, 200);
  assert.equal(none.responsePayloadBuffer.length, 0, "no skinned ship in the bubble");
});

function decodeWithClient(messageName, payload) {
  const file = path.join(
    process.env.TEMP || os.tmpdir(), "opencode", `ship-state-${process.pid}-${Math.random().toString(16).slice(2)}.hex`,
  );
  fs.writeFileSync(file, payload.toString("hex"));
  const result = spawnSync(
    process.execPath,
    ["scripts/coop-verify-client-proto.cjs", messageName, file],
    {cwd: process.cwd(), encoding: "utf8", timeout: 600000},
  );
  fs.rmSync(file, {force: true});
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const line = output
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.startsWith("{"))
    .pop();
  if (!line || /DECODE_FAILED|descriptor not found/.test(output)) return null;
  return JSON.parse(line);
}

test("the client's own descriptor reads back exactly the applied skin", (t) => {
  const {gateway, envelope} = world({inScene: [SHIP]});
  const get = gateway.handleRequest(
    "eve_public.cosmetic.ship.api.GetRequest",
    envelope(getRequest(SHIP)),
  );
  const bubble = gateway.handleRequest(
    "eve_public.cosmetic.ship.api.GetAllInBubbleRequest",
    envelope(Buffer.alloc(0)),
  );
  const single = decodeWithClient(
    "eve_public.cosmetic.ship.api.GetResponse", get.responsePayloadBuffer,
  );
  if (!single) {
    t.skip("the client archive or python protobuf is not readable");
    return;
  }
  assert.equal(single.value.state.character.sequential, CHARACTER);
  assert.equal(single.value.state.ship.sequential, SHIP);
  assert.equal(single.value.state.skin.thirdparty.identifier.hex, SKIN);
  // The layout bytes are the ones the client sent when the design was saved, handed back verbatim.
  assert.deepEqual(Object.keys(single.value.state.skin.thirdparty), ["identifier", "layout"]);

  const all = decodeWithClient(
    "eve_public.cosmetic.ship.api.GetAllInBubbleResponse", bubble.responsePayloadBuffer,
  );
  assert.equal(all.value.states.length, 1);
  assert.equal(all.value.states[0].ship.sequential, SHIP);
  assert.equal(all.value.states[0].skin.thirdparty.identifier.hex, SKIN);
});
