// COOP_MONITOR_OWNER_V1
//
// `IndustryMonitor.DisconnectJob` used to delete whatever monitor id the client
// sent: the handler did not even take the session, the stored row had no owner,
// and the row was persisted on every call. Measured consequence: a second client
// could detach the first client's tracked job, and a missing id was reported as a
// success. These tests pin the owner rules that ship in the fork.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
import {ENGINE_CODE, engineAvailable, engineSource, skipWithoutEngine} from "./_support/engineCheckout.mjs";

const require = createRequire(import.meta.url);
const MODULE = path.join(ENGINE_CODE, "server/src/services/industry/industryMonitorOwnership.js");
const load = () => require(MODULE);

test("an unattributed monitor can never be detached", (t) => {
  if (skipWithoutEngine(t)) return;
  const {canDisconnect, isAttributableMonitor} = load();
  assert.equal(isAttributableMonitor({monitorID: 1}), false);
  assert.equal(isAttributableMonitor({monitorID: 1, characterID: 0}), false);
  assert.equal(canDisconnect({monitorID: 1}, 140000005), false);
  assert.equal(canDisconnect({monitorID: 1, characterID: 0}, 140000005), false);
});

test("only the owning character may detach a monitor", (t) => {
  if (skipWithoutEngine(t)) return;
  const {canDisconnect} = load();
  const monitor = {monitorID: 7, characterID: 140000005, activityID: 1, blueprintID: 500};
  assert.equal(canDisconnect(monitor, 140000005), true);
  assert.equal(canDisconnect(monitor, 140000108), false);
  assert.equal(canDisconnect(monitor, 0), false);
  assert.equal(canDisconnect(null, 140000005), false);
});

test("reconnecting the same blueprint reuses the monitor, a different one does not", (t) => {
  if (skipWithoutEngine(t)) return;
  const {isSameMonitor} = load();
  const monitor = {monitorID: 7, characterID: 140000005, activityID: 1, blueprintID: 500};
  assert.equal(isSameMonitor(monitor, {characterID: 140000005, activityID: 1, blueprintID: 500}), true);
  // same character, other blueprint -> a real second monitor
  assert.equal(isSameMonitor(monitor, {characterID: 140000005, activityID: 1, blueprintID: 501}), false);
  // same blueprint, other character -> never reuse someone else's row
  assert.equal(isSameMonitor(monitor, {characterID: 140000108, activityID: 1, blueprintID: 500}), false);
});

test("the handler passes the session and refuses a failed detach", (t) => {
  if (skipWithoutEngine(t)) return;
  const source = engineSource("server/src/services/industry/industryMonitorService.js");
  assert.match(source, /Handle_DisconnectJob\(args, session\)/);
  assert.match(source, /disconnectMonitor\(monitorID, session\)/);
  assert.match(source, /throwWrappedUserError\("CustomNotify"/);
  // The old call shape is gone: no owner-less disconnect anywhere in the service.
  assert.equal(/disconnectMonitor\(monitorID\)\s*;/.test(source), false);
});

test("the runtime state stores the owner and prunes unattributed rows", (t) => {
  if (skipWithoutEngine(t)) return;
  const source = engineSource("server/src/services/industry/industryRuntimeState.js");
  assert.match(source, /characterID,\n\s*activityID,\n\s*blueprintID,/);
  assert.match(source, /isAttributableMonitor\(monitor\)/);
  assert.match(source, /canDisconnect\(monitor, characterID\)/);
  assert.match(source, /errorMsg: "MONITOR_NOT_FOUND"/);
  assert.match(source, /errorMsg: "MONITOR_NOT_OWNED"/);
});

test("engine checkout resolution is explicit", () => {
  if (!engineAvailable) return;
  assert.ok(ENGINE_CODE.length > 0);
});
