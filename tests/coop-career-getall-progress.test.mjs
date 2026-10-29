import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// The career portal iterates its definitions and dereferences `.progress` on the matching row:
// answering GetAll with an empty list left the client with
// "AttributeError: 'NoneType' object has no attribute 'progress'" (its own alert, 21:59).
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = () => readFileSync(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/compatibilityGatewayService.js"), "utf8");

test("career GetAll answers one zero-progress row per definition", () => {
  const text = source();
  assert.match(text, /eve_public\.career\.goal\.api\.GetAllRequest/);
  assert.match(text, /not_completed: true/);
  assert.match(text, /progress: 0/);
  assert.match(text, /CAREER_GOAL_DEFINITION_STUBS\.map/,
    "one row per definition, never a hand-written list that can drift");
});

test("the response message is declared locally, not looked up eagerly", () => {
  const text = source();
  assert.match(text, /CAREER_PROTO_ROOT = protobuf\.Root\.fromJSON/);
  // an eager lookupType on the shared root throws at require time and takes the gateway down
  assert.doesNotMatch(text, /const careerGoalGetAllResponse = protoRoot\.lookupType\(\s*"eve_public\.career\.goal\.api\.GetAllResponse"/);
  assert.match(text, /require\("protobufjs"\)/);
});
