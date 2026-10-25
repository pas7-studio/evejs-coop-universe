"use strict";
// Read-only co-op coverage planner. Never starts a server, changes flags, or opens SQLite.
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const VALID_STAGES = ["A", "B", "C", "D", "E", "F"];
const SAFE_PATH = /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/;
const SAFE_NAME = /^coop[A-Za-z0-9]+$/;

function validateCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.features) || !Array.isArray(catalog.stages))
    throw Error("CATALOG_SCHEMA_INVALID");
  if (catalog.stages.map(stage => stage.id).join(",") !== VALID_STAGES.join(","))
    throw Error("STAGE_ORDER_INVALID");
  const ids = new Set();
  for (const feature of catalog.features) {
    if (typeof feature.id !== "string" || !/^[a-z][a-z0-9-]+$/.test(feature.id) || ids.has(feature.id))
      throw Error("FEATURE_ID_DUPLICATE_OR_INVALID:" + feature.id);
    ids.add(feature.id);
    if (!VALID_STAGES.includes(feature.stage)) throw Error("FEATURE_STAGE_INVALID:" + feature.id);
    for (const field of ["dependsOn", "nativeEntrypoints", "overlayModules", "installerSpecs", "tests"]) {
      if (!Array.isArray(feature[field]) || new Set(feature[field]).size !== feature[field].length)
        throw Error("FEATURE_FIELD_INVALID:" + feature.id + ":" + field);
    }
    for (const field of ["nativeEntrypoints", "installerSpecs", "tests"]) {
      if (feature[field].some(value => typeof value !== "string" || !SAFE_PATH.test(value) || value.includes("..")))
        throw Error("UNSAFE_PATH:" + feature.id + ":" + field);
    }
    if (feature.overlayModules.some(value => typeof value !== "string" || !SAFE_NAME.test(value)))
      throw Error("MODULE_NAME_INVALID:" + feature.id);
    if (feature.nativeEntrypoints.length === 0 || typeof feature.ownerStore !== "string" || !feature.ownerStore ||
        typeof feature.invariant !== "string" || !feature.invariant)
      throw Error("FEATURE_AUTHORITY_UNDEFINED:" + feature.id);
  }
  for (const feature of catalog.features) for (const dep of feature.dependsOn) {
    const referenced = catalog.features.find(item => item.id === dep);
    if (!referenced) throw Error("UNKNOWN_DEPENDENCY:" + feature.id + ":" + dep);
    if (VALID_STAGES.indexOf(referenced.stage) > VALID_STAGES.indexOf(feature.stage))
      throw Error("FUTURE_DEPENDENCY:" + feature.id + ":" + dep);
  }
  return executionOrder(catalog.features);
}

function executionOrder(features) {
  const byId = new Map(features.map(feature => [feature.id, feature]));
  const visiting = new Set();
  const visited = new Set();
  const order = [];
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw Error("FEATURE_DEPENDENCY_CYCLE:" + id);
    const feature = byId.get(id);
    if (!feature) throw Error("UNKNOWN_DEPENDENCY:" + id);
    visiting.add(id);
    for (const dep of feature.dependsOn) visit(dep);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const feature of features) visit(feature.id);
  return order;
}

function inspectCatalog(catalog, {root, registry, codePath, nativeRevision, exists = fs.existsSync} = {}) {
  const order = validateCatalog(catalog);
  if (!root || !registry || !Array.isArray(registry.names) || !Array.isArray(registry.specs))
    throw Error("INSPECTION_CONTEXT_MISSING");
  if (catalog.upstreamPin !== registry.PIN) throw Error("CATALOG_UPSTREAM_PIN_MISMATCH");
  const nativeCheckout = codePath ? {
    revision: nativeRevision || "UNKNOWN",
    status: nativeRevision === catalog.upstreamPin ? "PIN_MATCH" : "PIN_MISMATCH_OR_UNKNOWN"
  } : {status: "NOT_INSPECTED"};
  const installedNames = new Set(registry.names);
  const installedSpecs = new Set(registry.specs.map(spec => spec.file));
  const features = order.map(id => {
    const feature = catalog.features.find(item => item.id === id);
    const gaps = [];
    for (const name of feature.overlayModules) {
      if (!exists(path.join(root, "integration", name + ".cjs"))) gaps.push("MODULE_SOURCE_MISSING:" + name);
      else if (!installedNames.has(name)) gaps.push("MODULE_NOT_REGISTERED:" + name);
    }
    for (const hook of feature.installerSpecs) {
      if (!installedSpecs.has(hook)) gaps.push("NATIVE_SPEC_NOT_REGISTERED:" + hook);
    }
    for (const testFile of feature.tests) {
      if (!exists(path.join(root, testFile))) gaps.push("TEST_FILE_MISSING:" + testFile);
    }
    if (codePath) for (const nativeFile of feature.nativeEntrypoints) {
      if (!exists(path.join(codePath, nativeFile))) gaps.push("PINNED_NATIVE_FILE_MISSING:" + nativeFile);
    }
    // An installed copy/spec is only source-wiring evidence, NOT proof that the
    // feature flag is set, the right native method is hooked, or a client works.
    const status = gaps.length ? "INTEGRATION_GAP" :
      feature.overlayModules.length ? "SOURCE_REGISTERED_LIVE_UNVERIFIED" : "NATIVE_ONLY_LIVE_UNVERIFIED";
    return {
      id, stage: feature.stage, dependsOn: feature.dependsOn,
      status, gaps, ownerStore: feature.ownerStore, invariant: feature.invariant,
      localTests: feature.tests.length ? "PRESENT_NOT_EXECUTED" : "NO_DEDICATED_TEST",
      runtime: "NOT_OBSERVED", twoClient: "NOT_OBSERVED"
    };
  });
  return {
    upstreamPin: catalog.upstreamPin,
    authority: "READ_ONLY_SOURCE_INSPECTION_NOT_GAMEPLAY_PROOF",
    stages: catalog.stages,
    nativeCheckout,
    features,
    counts: {
      total: features.length,
      nativePinMismatch: nativeCheckout.status === "PIN_MISMATCH_OR_UNKNOWN" ? 1 : 0,
      integrationGaps: features.filter(feature => feature.status === "INTEGRATION_GAP").length,
      sourceRegistered: features.filter(feature => feature.status === "SOURCE_REGISTERED_LIVE_UNVERIFIED").length,
      liveVerified: 0
    }
  };
}

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(__dirname, "..");
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "docs/coop-native-feature-catalog.json"), "utf8"));
  const registry = require("./patch-evejs-coop.cjs");
  const at = argv.indexOf("--code-path");
  if (at >= 0 && (!argv[at + 1] || argv[at + 1].startsWith("--"))) throw Error("--code-path requires a directory");
  const codePath = at >= 0 ? path.resolve(argv[at + 1]) : undefined;
  let nativeRevision;
  if (codePath) {
    try { nativeRevision = execFileSync("git", ["-C", codePath, "rev-parse", "HEAD"], {encoding:"utf8", stdio:["ignore","pipe","ignore"]}).trim(); }
    catch { nativeRevision = "UNKNOWN"; }
  }
  const result = inspectCatalog(catalog, {root, registry, codePath, nativeRevision});
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("Co-op native readiness | SOURCE ONLY | pin " + result.upstreamPin.slice(0, 12));
    for (const stage of result.stages) {
      console.log("\n" + stage.id + " " + stage.title);
      for (const feature of result.features.filter(item => item.stage === stage.id)) {
        console.log("  " + feature.id + " : " + feature.status);
        for (const gap of feature.gaps) console.log("    - " + gap);
      }
    }
    console.log("\n" + JSON.stringify(result.counts) + "\nNO CLIENT, SERVER, FLAG, SQLITE OR GAMEPLAY VERIFICATION WAS PERFORMED.");
  }
  if (argv.includes("--strict") && (result.counts.integrationGaps || result.counts.nativePinMismatch)) process.exitCode = 2;
  return result;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error("COOP_READINESS_ERROR:", error.message); process.exitCode = 1; }
}
module.exports = {validateCatalog, executionOrder, inspectCatalog, main};