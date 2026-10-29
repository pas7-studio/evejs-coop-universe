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

test("career GetAll answers one row per definition, from the module that owns the catalogue", () => {
  const text = source();
  assert.match(text, /eve_public\.career\.goal\.api\.GetAllRequest/);
  // The row set is the catalogue owner's snapshot, not a list written here: a hand-written list
  // drifts the moment a definition is added, and the portal iterates the definitions.
  assert.match(text, /careerGoalSnapshotFor\(getActiveCharacterID\(requestEnvelope\)\)/);
  assert.match(text, /space\/coopCareerGoals/, "the catalogue has exactly one owner");
  // Every row must carry what the portal dereferences: progress, and whether it is still open.
  assert.match(text, /progress: entry\.progress/);
  assert.match(text, /not_completed: !entry\.completed/);
  assert.match(text, /goal: \{ uuid: uuidStringToBytes\(entry\.definition\.goalID\) \}/);
});

test("the response message is declared locally, not looked up eagerly", () => {
  const text = source();
  assert.match(text, /CAREER_PROTO_ROOT = protobuf\.Root\.fromJSON/);
  // an eager lookupType on the shared root throws at require time and takes the gateway down
  assert.doesNotMatch(text, /const careerGoalGetAllResponse = protoRoot\.lookupType\(\s*"eve_public\.career\.goal\.api\.GetAllResponse"/);
  assert.match(text, /require\("protobufjs"\)/);
});
