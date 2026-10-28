import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modulePath = path.join("C:", "Games", "EveCoop", "upstream-evejs", "Code", "server", "src", "space",
  "coopNativeStationTripJournal.js");
const present = fs.existsSync(modulePath);
const { createJournal } = present ? require(modulePath) : {};

// Measured on the work stack 2026-10-28: a durable slot repair gave the fleet new hull
// IDs. Forty manifests of earlier trips were already closed (expired or abandoned), but
// their hull list was compared BEFORE the closure check, so every new departure was
// refused ALIFE12_MANIFEST_FLEET_CONFLICT. The fleet sat "loaded" for hours: it never
// delivered, never mined again, and the station drain never got a turn, so the goods it
// had just manufactured could not be sold.
const SYSTEM = 30000145;
const FLEET = 960004642;
const OLD_HAULER = 980000000035; // the hull of the previous generation
const NEW_HAULER = 980000000028; // the hull the repair restored today
const KEY = `${SYSTEM}-${FLEET}-1793192258857`;

const STARTED = 1793192258857;

function journalFor({closed, ack = false, ageMs = 60_000}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alife12-"));
  fs.mkdirSync(path.join(root, "trip-manifests"), { recursive: true });
  fs.mkdirSync(path.join(root, "trip-departure-acks"), { recursive: true });
  fs.writeFileSync(path.join(root, "trip-manifests", `${KEY}.json`), "{}");
  if (closed === "abandoned") {
    fs.writeFileSync(path.join(root, "trip-departure-acks", `${KEY}.abandoned.json`),
      JSON.stringify({ version: 1, status: "ROUTE_ABANDONED", manifestKey: KEY,
        systemID: SYSTEM, fleetID: FLEET }));
  }
  if (closed === "expired") {
    fs.writeFileSync(path.join(root, "trip-departure-acks", `${KEY}.expired.json`),
      JSON.stringify({ version: 1, status: "ROUTE_EXPIRED", manifestKey: KEY,
        systemID: SYSTEM, fleetID: FLEET }));
  }
  if (ack) {
    fs.writeFileSync(path.join(root, "trip-departure-acks", `${KEY}.json`),
      JSON.stringify({ version: 1, status: "WARP_ACK_CONFIRMED", manifestKey: KEY,
        systemID: SYSTEM, fleetID: FLEET, stationID: 60014935, corporationID: 1000129,
        startedAt: STARTED, manifestHash: "0".repeat(64) }));
  }
  const record = { key: KEY, status: "READY", systemID: SYSTEM, fleetID: FLEET,
    stationID: 60014935, corporationID: 1000129, startedAt: STARTED,
    haulerIDs: [OLD_HAULER], cargo: [] };
  const journal = createJournal({
    root,
    manifest: { read: (k) => (k === KEY ? { status: "READY", record } : null) },
    store: { listNativeCargoForEntity: () => [] },
    items: { findWarehouseItem: () => null },
    getNativeEntity: (id) => ({ entityID: id, systemID: SYSTEM }),
    clock: () => STARTED + ageMs,
  });
  return { journal, root };
}

test("a closed route from the previous hulls never blocks a new departure", { skip: !present }, () => {
  for (const closed of ["abandoned", "expired"]) {
    const result = journalFor({ closed }).journal.recover({ systemID: SYSTEM, fleetID: FLEET,
      haulerIDs: [NEW_HAULER] });
    assert.notEqual(result.reason, "ALIFE12_MANIFEST_FLEET_CONFLICT",
      `a ${closed} route must not refuse the departure of the restored fleet`);
  }
});

test("a live route still belongs to its exact hulls", { skip: !present }, () => {
  // The closure rule must not become a licence to re-account another fleet's live trip.
  const result = journalFor({ closed: null }).journal.recover({ systemID: SYSTEM, fleetID: FLEET,
    haulerIDs: [NEW_HAULER] });
  assert.equal(result.status, "NEEDS_OPERATOR_REPAIR");
  assert.equal(result.reason, "ALIFE12_MANIFEST_FLEET_CONFLICT");
});

test("an overdue route of vanished hulls is expired, never left blocking", { skip: !present }, () => {
  // Measured 2026-10-28: a 12:11 route naming hull 980000000032 held fleet 960004641 in
  // "loaded" for hours. It could not be flown (its hulls are gone) and could not be
  // closed either, because the hull check failed before the expiry that closes it. It is
  // now closed by its own durable record and the fleet may plan with the ore it carries.
  const { journal, root } = journalFor({ closed: null, ack: true, ageMs: 5 * 60 * 60 * 1000 });
  const result = journal.recover({ systemID: SYSTEM, fleetID: FLEET, haulerIDs: [NEW_HAULER] });
  assert.notEqual(result.reason, "ALIFE12_MANIFEST_FLEET_CONFLICT",
    "the overdue route must not refuse the trip for ever");
  assert.ok(fs.existsSync(path.join(root, "trip-departure-acks", `${KEY}.expired.json`)),
    "the route is closed by its own durable record");
});
