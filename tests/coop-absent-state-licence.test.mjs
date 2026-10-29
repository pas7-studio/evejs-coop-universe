import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// eve_public.user.license.api.Get used to fall through to the default empty message, which the client
// decoded into UserLicense(last_modified = 1970) - a record this world never issued. The client's own
// messenger (user_licenses/client/messenger/request_messenger.pyj) treats 404 as "no user license
// found" and returns None, so the honest answer is an explicit NOT_FOUND.
//
// The service imports the payment/user proto root and the gameStore through its siblings, so the
// contract is read from the source here and measured live in the container.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const service = () => readFileSync(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/absentStateGatewayService.js"), "utf8");

test("a user licence lookup is answered with NOT_FOUND and a reason", () => {
  const text = service();
  assert.match(text, /"eve_public\.user\.license\.api\.GetRequest",?\s*\n/,
    "the type is registered");
  assert.match(text, /no user licences exist in this world/);
  assert.match(text, /emptyAnswer\(NOT_FOUND, "no user licences exist in this world",\s*\n\s*"eve_public\.user\.license\.api\.GetResponse"\)/);
});

test("absent records answer the HTTP status the client compares, not a gRPC code", () => {
  // The client's own messengers test `status_code == 404` (httplib) and treat anything else as an
  // unexpected exception, so these answers must be 404/412 - not 5/9.
  const text = service();
  assert.match(text, /const NOT_FOUND = 404;/);
  assert.match(text, /const FAILED_PRECONDITION = 412;/);
  assert.doesNotMatch(text, /const NOT_FOUND = 5;/);
});

test("the licence branch sits inside handleRequest, before the payment-code fallthrough", () => {
  // The type used to be answered by the default-encoded empty response; it now has an explicit branch
  // inside handleRequest instead of falling through to the last catch-all refusal.
  const text = service();
  const handlerStart = text.indexOf("handleRequest(requestTypeName)");
  const licence = text.indexOf('if (requestTypeName === "eve_public.user.license.api.GetRequest")');
  const codeRefusal = text.indexOf('"code redemption is not configured on this world"');
  assert.ok(handlerStart > 0, "handleRequest exists");
  assert.ok(licence > handlerStart, "the branch is inside handleRequest");
  assert.ok(licence < codeRefusal, "it is decided before the catch-all refusal");
});
