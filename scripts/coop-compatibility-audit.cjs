#!/usr/bin/env node
"use strict";

// Read-only compatibility inventory. Never installs an overlay, loads EveJS
// runtime services, changes the SDE or contacts a remote server.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PIN = "c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const CLIENT_BUILD = 3396210;
const REQUIRED = Object.freeze({
  contractMgr: "server/src/services/_other/contractMgrService.js",
  contractProxy: "server/src/services/_other/contractProxyService.js",
  lpService: "server/src/services/corporation/lpService.js",
  lpStoreMgr: "server/src/services/evermarks/lpStoreMgrService.js",
  abyssalMgr: "server/src/services/activity/abyssalMgrService.js",
  gateway: "server/src/_secondary/express/gatewayServices/compatibilityGatewayService.js",
  sdeCreator: "tools/DatabaseCreator/database-creator.js",
  baseService: "server/src/services/baseService.js",
  serviceManager: "server/src/services/serviceManager.js",
});

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function readSource(codePath, relativePath) {
  const base = fs.realpathSync(codePath);
  const candidate = path.join(base, relativePath);
  if (!isInside(base, candidate) || !fs.existsSync(candidate)) return null;
  const actual = fs.realpathSync(candidate);
  if (!isInside(base, actual) || !fs.statSync(actual).isFile()) return null;
  return fs.readFileSync(actual, "utf8");
}

function collectServiceFiles(codePath) {
  const root = path.join(fs.realpathSync(codePath), "server", "src", "services");
  if (!fs.existsSync(root)) return [];
  const found = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(dir, entry.name);
      // Do not follow symlinks into unrelated or private trees.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && /Service\.js$/.test(entry.name)) {
        found.push(path.relative(fs.realpathSync(codePath), entryPath).split(path.sep).join("/"));
      }
    }
  }
  visit(root);
  return found.sort();
}

function extractDeclaredRpc(source) {
  const methods = new Set();
  // This finds direct source declarations only, NOT proven dispatched calls.
  const regex = /^\s*(?:async\s+)?Handle_([A-Za-z_$][\w$]*)\s*\(/gm;
  let match;
  while ((match = regex.exec(source))) methods.add(match[1]);
  return [...methods].sort();
}

function extractServiceName(source) {
  const match = source.match(/\bsuper\(\s*["']([^"']+)["']\s*\)/);
  return match ? match[1] : null;
}

function testSourceContract(key, source, pattern, interpretation, group) {
  return {
    id: key,
    category: group,
    status: source === null ? "SOURCE_MISSING" : (pattern.test(source) ? "SOURCE_OBSERVED" : "SOURCE_DRIFT"),
    interpretation,
  };
}

function analyzeSdeManifest(manifest, expectedBuild = CLIENT_BUILD) {
  if (manifest === null) return { status: "NOT_INSPECTED", expectedBuild };
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { status: "INVALID_MANIFEST", expectedBuild };
  }
  const build = manifest.build;
  const metaBuild = manifest.sdeMeta && manifest.sdeMeta.buildNumber;
  const sourceUrl = manifest.sdeUrl;
  const urlBuild = typeof sourceUrl === "string"
    ? /eve-online-static-data-(\d+)-jsonl\.zip/.exec(sourceUrl)
    : null;
  // Never accept a caller-supplied manifest whose three provenance fields disagree.
  const compatible = Number.isSafeInteger(build) && build === expectedBuild &&
    Number.isSafeInteger(metaBuild) && metaBuild === expectedBuild &&
    urlBuild !== null && Number(urlBuild[1]) === expectedBuild;
  return {
    status: compatible ? "BUILD_MATCH" : "BUILD_MISMATCH",
    expectedBuild,
    manifestBuild: build ?? null,
    sdeMetaBuild: metaBuild ?? null,
    urlBuild: urlBuild ? Number(urlBuild[1]) : null,
    placeholderTableCount: Array.isArray(manifest.placeholderTables)
      ? manifest.placeholderTables.length : null,
  };
}

function inspectManifest(filePath) {
  if (!filePath) return analyzeSdeManifest(null);
  try {
    return analyzeSdeManifest(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    return { status: "INVALID_MANIFEST", expectedBuild: CLIENT_BUILD, error: error.code || "INVALID_JSON" };
  }
}

function inspectCodePath(codePath) {
  const absolute = fs.realpathSync(codePath);
  if (!fs.statSync(absolute).isDirectory()) throw new Error("CODE_PATH_NOT_DIRECTORY");
  const sources = Object.fromEntries(Object.entries(REQUIRED).map(([key, p]) => [key, readSource(absolute, p)]));
  const checks = [
    testSourceContract("RPC_DISPATCH", sources.baseService, /this\[handlerName\]\(args, session, kwargs\)/, "BaseService dynamically dispatches Handle_<method>; declarations do not prove registration or gameplay.", "SERVER"),
    testSourceContract("RPC_REGISTER", sources.serviceManager, /\bregister\(service\)/, "ServiceManager registers instances; file names alone are not registered RPC services.", "SERVER"),
    testSourceContract("CONTRACT_MGR_STUB", sources.contractMgr, /Handle_CreateContract\(\)\s*\{\s*return null;\s*\}/, "contractMgr CreateContract is a stub; inspect contractProxy and routing before declaring contracts absent.", "SERVER"),
    testSourceContract("CONTRACT_PROXY_NATIVE", sources.contractProxy, /Handle_CreateContract\s*\(/, "contractProxy declares native creation; source declaration does not prove durable settlement.", "SERVER"),
    testSourceContract("LP_SVC_STUB", sources.lpService, /Handle_TakeOffer\(\)\s*\{[\s\S]*?return null;\s*\}/, "LPSvc.TakeOffer is a stub; LPStoreMgr has a distinct implementation.", "SERVER"),
    testSourceContract("LP_STORE_NATIVE", sources.lpStoreMgr, /Handle_TakeOfferForCharacter\s*\(/, "LPStoreMgr declares a purchase handler; server and two-client settlement still need proof.", "SERVER"),
    testSourceContract("ABYSS_REJECTED", sources.abyssalMgr, /Abyssal content generation is not available/, "Abyssal entrance deployment deliberately rejects; requires real server mechanics and possibly data.", "SERVER_DATA"),
    testSourceContract("GATEWAY_EMPTY_SUCCESS", sources.gateway, /EMPTY_SUCCESS_RESPONSE_TYPES\s*=\s*new Map/, "Some HTTP/protobuf requests return empty success payloads; they are not feature implementations.", "CLIENT_PROTOCOL"),
    testSourceContract("PINNED_SDE_DEFAULT", sources.sdeCreator,
      /const DEFAULT_BUILD\s*=\s*3396210\s*;/, "DatabaseCreator defaults to the client-era SDE; modern SDE may not be substituted blindly.", "DATA"),
  ];
  const serviceFiles = collectServiceFiles(absolute);
  const surface = serviceFiles.map(file => {
    const source = readSource(absolute, file);
    return { path: file, name: extractServiceName(source || ""), declaredHandlers: extractDeclaredRpc(source || "") };
  });
  const duplicateNames = [];
  const byName = new Map();
  for (const item of surface) {
    if (!item.name) continue;
    if (byName.has(item.name)) duplicateNames.push({ name: item.name, files: [byName.get(item.name), item.path] });
    else byName.set(item.name, item.path);
  }
  return {
    codePath: absolute,
    clientBuild: CLIENT_BUILD,
    checks,
    inventory: {
      sourceServiceFileCount: serviceFiles.length,
      declaredHandlerCount: surface.reduce((n, item) => n + item.declaredHandlers.length, 0),
      unnamedSourceServices: surface.filter(item => !item.name).map(item => item.path),
      duplicateDeclaredServiceNames: duplicateNames,
      services: surface,
    },
  };
}

function resolveCodePath(options) {
  const value = options.codePath;
  if (!value) throw new Error("MISSING_CODE_PATH");
  const absolute = fs.realpathSync(value);
  const repoRoot = path.dirname(absolute);
  const actualSha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
  if (actualSha !== PIN) throw new Error(`UPSTREAM_PIN_MISMATCH expected=${PIN} actual=${actualSha}`);
  // A Code directory must belong to the checked Git root, not a nested unrelated checkout.
  if (path.basename(absolute) !== "Code" || !isInside(repoRoot, absolute) || path.join(repoRoot, "Code") !== absolute) {
    throw new Error("INVALID_CODE_PATH");
  }
  return { absolute, actualSha };
}

function parseArguments(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--require-manifest") options.requireManifest = true;
    else if (arg === "--code-path" || arg === "--manifest") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`MISSING_VALUE ${arg}`);
      options[arg === "--code-path" ? "codePath" : "manifest"] = argv[++i];
    } else throw new Error(`UNKNOWN_ARGUMENT ${arg}`);
  }
  return options;
}

function execute(options) {
  const { absolute, actualSha } = resolveCodePath(options);
  const result = inspectCodePath(absolute);
  result.upstreamSha = actualSha;
  result.sdeManifest = inspectManifest(options.manifest);
  result.status = result.checks.some(check => check.status !== "SOURCE_OBSERVED") ||
    result.inventory.duplicateDeclaredServiceNames.length > 0 ||
    ["BUILD_MISMATCH", "INVALID_MANIFEST"].includes(result.sdeManifest.status) ||
    (options.requireManifest && result.sdeManifest.status === "NOT_INSPECTED")
    ? "BLOCKED_COMPATIBILITY" : "SOURCE_AUDIT_ONLY";
  return result;
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = execute(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`EveJS ${report.upstreamSha} / EVE client build ${report.clientBuild}`);
      console.log(`Declared source services ${report.inventory.sourceServiceFileCount}, handlers ${report.inventory.declaredHandlerCount}`);
      for (const check of report.checks) console.log(`${check.status} ${check.id}: ${check.interpretation}`);
      console.log(`SDE ${report.sdeManifest.status}; status ${report.status}`);
      console.log("No runtime, client or multiplayer gameplay was tested.");
    }
    process.exitCode = report.status === "BLOCKED_COMPATIBILITY" ? 2 : 0;
  } catch (error) {
    console.error(`BLOCKED_COMPATIBILITY: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = {
  PIN, CLIENT_BUILD, REQUIRED, isInside, readSource, collectServiceFiles,
  extractDeclaredRpc, extractServiceName, analyzeSdeManifest, inspectManifest,
  inspectCodePath, resolveCodePath, parseArguments, execute,
};
