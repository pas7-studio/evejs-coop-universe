import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {validateCatalog, executionOrder, inspectCatalog} = require("../scripts/coop-feature-readiness.cjs");
const catalog = JSON.parse(fs.readFileSync(new URL("../docs/coop-native-feature-catalog.json", import.meta.url)));
const copy = value => JSON.parse(JSON.stringify(value));
const registry = {
  PIN: catalog.upstreamPin,
  names: [...new Set(catalog.features.flatMap(feature => feature.overlayModules))],
  specs: [...new Set(catalog.features.flatMap(feature => feature.installerSpecs))].map(file => ({file}))
};
const allFilesExist = () => true;

test("dependency order is deterministic and all dependencies precede dependents", () => {
  const order = validateCatalog(catalog);
  assert.equal(order.length, catalog.features.length);
  const at = new Map(order.map((id, index) => [id, index]));
  for (const feature of catalog.features) for (const dependency of feature.dependsOn) {
    assert.ok(at.get(dependency) < at.get(feature.id), `${dependency} must precede ${feature.id}`);
  }
  assert.deepEqual(executionOrder(catalog.features), order);
});

test("missing dependency and stage inversion are rejected before inspection", () => {
  const broken = copy(catalog);
  broken.features[0].dependsOn = ["not-a-feature"];
  assert.throws(() => validateCatalog(broken), /UNKNOWN_DEPENDENCY/);
  const inverted = copy(catalog);
  inverted.features[0].dependsOn = ["faction-warfare"];
  assert.throws(() => validateCatalog(inverted), /FUTURE_DEPENDENCY/);
});

test("cycles, duplicate feature IDs, unsafe paths and invalid module names fail closed", () => {
  const cyc = copy(catalog);
  cyc.features.find(feature => feature.id === "session-authority").dependsOn = ["fleet-travel"];
  assert.throws(() => validateCatalog(cyc), /FEATURE_DEPENDENCY_CYCLE/);
  const dup = copy(catalog);
  dup.features[1].id = dup.features[0].id;
  assert.throws(() => validateCatalog(dup), /FEATURE_ID_DUPLICATE/);
  const unsafe = copy(catalog);
  unsafe.features[0].tests = ["../secret.txt"];
  assert.throws(() => validateCatalog(unsafe), /UNSAFE_PATH/);
  const name = copy(catalog);
  name.features[0].overlayModules = ["../../fake"];
  assert.throws(() => validateCatalog(name), /MODULE_NAME_INVALID/);
});

test("source registration is never mislabeled as runtime or two-client PASS", () => {
  const report = inspectCatalog(catalog, {root: "/virtual", registry, exists: allFilesExist});
  assert.equal(report.counts.integrationGaps, 0);
  assert.equal(report.counts.liveVerified, 0);
  assert.equal(report.authority, "READ_ONLY_SOURCE_INSPECTION_NOT_GAMEPLAY_PROOF");
  for (const feature of report.features) {
    assert.equal(feature.status, "SOURCE_REGISTERED_LIVE_UNVERIFIED");
    assert.equal(feature.runtime, "NOT_OBSERVED");
    assert.equal(feature.twoClient, "NOT_OBSERVED");
    assert.equal(feature.localTests, feature.id === "player-corporations" ? "NO_DEDICATED_TEST" : "PRESENT_NOT_EXECUTED");
  }
});

test("inspector detects missing copy registration, native source spec, and tests independently", () => {
  const f = catalog.features.find(feature => feature.id === "wormhole-travel");
  const local = {schemaVersion: 1, upstreamPin: catalog.upstreamPin, stages: catalog.stages, features: [
    {...f, dependsOn: []}
  ]};
  const unregistered = {...registry, names: registry.names.filter(n => n !== f.overlayModules[0]),
    specs: registry.specs.filter(spec => spec.file !== f.installerSpecs[0])};
  const report = inspectCatalog(local, {
    root: "/virtual", registry: unregistered, codePath: "/pinned", nativeRevision: catalog.upstreamPin,
    exists: file => !file.endsWith(f.tests[0]) && !file.endsWith(f.nativeEntrypoints[0])
  });
  assert.equal(report.counts.integrationGaps, 1);
  assert.equal(report.features[0].status, "INTEGRATION_GAP");
  assert.ok(report.features[0].gaps.some(gap => gap.startsWith("MODULE_NOT_REGISTERED:")));
  assert.ok(report.features[0].gaps.some(gap => gap.startsWith("NATIVE_SPEC_NOT_REGISTERED:")));
  assert.ok(report.features[0].gaps.some(gap => gap.startsWith("TEST_FILE_MISSING:")));
  assert.ok(report.features[0].gaps.some(gap => gap.startsWith("PINNED_NATIVE_FILE_MISSING:")));
});

test("catalog pin must match the single central installer pin", () => {
  assert.throws(() => inspectCatalog(catalog, {root: "/virtual", registry: {...registry, PIN: "wrong"}, exists: allFilesExist}), /CATALOG_UPSTREAM_PIN_MISMATCH/);
});

test("missing native file is not asserted when no real upstream checkout is supplied", () => {
  const report = inspectCatalog(catalog, {root: "/virtual", registry, exists: p => !p.includes("/server/src/")});
  assert.ok(report.features.every(feature => !feature.gaps.some(gap => gap.startsWith("PINNED_NATIVE_FILE_MISSING"))));
});


test("--code-path provenance is independently pinned; unknown checkout never passes", () => {
  const mismatched = inspectCatalog(catalog, {root: "/virtual", registry, codePath: "/other", nativeRevision: "wrong", exists: allFilesExist});
  assert.equal(mismatched.nativeCheckout.status, "PIN_MISMATCH_OR_UNKNOWN");
  assert.equal(mismatched.counts.nativePinMismatch, 1);
  const missing = inspectCatalog(catalog, {root: "/virtual", registry, codePath: "/other", exists: allFilesExist});
  assert.equal(missing.nativeCheckout.revision, "UNKNOWN");
  assert.equal(missing.counts.nativePinMismatch, 1);
  const pinned = inspectCatalog(catalog, {root: "/virtual", registry, codePath: "/pinned", nativeRevision: catalog.upstreamPin, exists: allFilesExist});
  assert.equal(pinned.nativeCheckout.status, "PIN_MATCH");
  assert.equal(pinned.counts.nativePinMismatch, 0);
});