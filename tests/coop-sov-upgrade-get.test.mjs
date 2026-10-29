import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// eve_public.sovereignty.hub.upgrade.api.Get asks for ONE installed upgrade by identifier
// ({hub, installation_type, upgrade_type}) and answers Attributes{definition, power_state} - the
// same two fields GetHubUpgrades already reports per upgrade. It used to be answered by the default
// empty message, i.e. an upgrade with no definition and no power state, which is a lie about a hub
// that may not even carry it.
//
// The gateway service cannot be imported here (it pulls the sovereignty state and the gameStore,
// which the harness refuses in a plain node:test process), so the contract is read from the source
// and the behaviour is measured live in the container - see .opencode/state.md.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const service = () => readFileSync(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/sovereigntyGatewayService.js"), "utf8");
const protos = () => readFileSync(path.join(forkRoot,
  "Code/server/src/services/sovereignty/sovGatewayProto.js"), "utf8");

test("the upgrade Get request is registered and answered from the installed upgrade", () => {
  const text = service();
  assert.match(text, /"eve_public\.sovereignty\.hub\.upgrade\.api\.GetRequest"/,
    "the type must be in HANDLED_REQUEST_TYPES");
  assert.match(text, /types\.upgradeGetRequest/);
  assert.match(text, /types\.upgradeGetResponse/);
  // The answer is the row the hub really carries - never a freshly built definition.
  assert.match(text, /hubUpgrades\.upgrades\.find\(/);
  assert.match(text, /attributes: payload\.upgrades\[0\]\.attributes/);
  // An upgrade the hub does not carry must be refused, not invented.
  assert.match(text, /buildErrorResult\(requestTypeName, 404, "NOT_FOUND"\)/);
});

test("the local proto root declares the request and response messages", () => {
  const text = protos();
  assert.match(text, /upgradeGetRequest: root\.lookupType\(\s*"eve_public\.sovereignty\.hub\.upgrade\.api\.GetRequest",\s*\)/);
  assert.match(text, /upgradeGetResponse: root\.lookupType\(\s*"eve_public\.sovereignty\.hub\.upgrade\.api\.GetResponse",\s*\)/);
});
