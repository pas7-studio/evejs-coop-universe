#!/usr/bin/env node
"use strict";
// Client contract register.
//
// The client is the specification. `docs/client-contracts/calls.json` is the list of every
// `RemoteSvc('service').Method` the pinned client build actually issues, extracted from its
// own bytecode, together with the modules that issue them. This script compares that list
// with what the server answers and writes `docs/CLIENT_CONTRACT_STATUS.md`:
//
//   MISSING   - the service or handler does not exist, so baseService answers null
//   STUB      - the handler exists but returns only a constant null / empty answer
//   NULLABLE  - the handler can return null on some path (legitimate only when the client
//               guards it; the register says which ones were checked)
//   OK        - the handler builds a real answer
//
// Nothing here inspects the client at runtime: re-read the client to refresh calls.json.
//
//   node scripts/coop-client-contracts.cjs            # print the summary
//   node scripts/coop-client-contracts.cjs --write    # rewrite the register
//   node scripts/coop-client-contracts.cjs --check    # fail on a new MISSING/STUB
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CALLS = path.join(ROOT, "docs/client-contracts/calls.json");
const BASELINE = path.join(ROOT, "docs/client-contracts/baseline.json");
const REGISTER = path.join(ROOT, "docs/CLIENT_CONTRACT_STATUS.md");
const FORK = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const SERVER_SRC = path.join(FORK, "Code/server/src");

// The client tolerates a null answer only where it checks first. These were read by hand in
// the decompiled call sites and are the reason a STUB can still be acceptable today.
const GUARDED_STUBS = Object.freeze({
  "map.GetDeadspaceAgentsMap": "starModeHandler: `if dungeons is None: return`",
  "map.GetDeadspaceComplexMap": "starModeHandler: `if dungeons is None: return`",
  "map.GetMyExtraMapInfo": "starModeHandler: `if corp is not None`",
  "charMgr.GetCohortsForCharacter": "a list is passed to gatekeeper, never indexed",
  "charUnboundMgr.GetCharacterLockType": "`if lockTypeID is not None`",
  "charUnboundMgr.CancelCharacterDeletePrepare": "fire-and-forget proxy call",
  "charMgr.GetCohortsForCharacter ": "list, never indexed",
  "userSvc.GetSessionPlaytimeMinutes": "wrapped in try/except in userSvc",
  "petitioner.ClaimPetition": "py2 `None > 0` is False, the window just reloads",
  "pvpFilamentMgr.GetMostRecentEvent": "the filament UI hides the event block when empty",
  "pvpFilamentMgr.GetNextEventDate": "the filament UI hides the event block when empty",
  "pvpFilamentMgr.GetLeaderboard": "the UI shows an empty leaderboard",
  "pvpFilamentMgr.LeavePVPQueue": "fire-and-forget",
  "clientStatLogger.LogString": "fire-and-forget proxy",
  "pingService.Ping": "fire-and-forget proxy",
  "eventLog.LogPlayerRequestedDisconnect": "fire-and-forget proxy",
  "localizationServer.UpdateLocalizationQAWrap": "QA only",
  "publicQaToolsServer.MoveMeTo": "QA only, wrapped in try/except UserError",
  "publicQaToolsServer.SlashCmd": "QA only",
  "node_graph.process_client_blackboard_request": "QA node graph only",
  "node_graph.qa_subscribe": "QA only",
  "node_graph.qa_unsubscribe": "QA only",
  "node_graph.qa_start_node": "QA only",
  "node_graph.qa_stop_node": "QA only",
  "node_graph.qa_stop_node_graph": "QA only",
  "node_graph.qa_stop_active_nodes": "QA only",
  "operationsManager.process_client_event": "telemetry, fire-and-forget",
  "milestoneMgr.ProcessCharacterLogon": "fire-and-forget",
  "survey.PerformSurveyChecks": "fire-and-forget",
  "survey.ClaimSurveyRewards": "fire-and-forget",
  "industryMonitor.DisconnectJob": "fire-and-forget",
  "structureDeployment.Unanchor": "fire-and-forget, the structure refresh tells the truth",
  "structureDeployment.CancelUnanchor": "fire-and-forget",
  "structureDeployment.RenameStructure": "fire-and-forget, then structureDirectory refresh",
  "petitioner.MarkAsRead": "fire-and-forget, local list updated first",
  "petitioner.DeletePetition": "fire-and-forget, the window reloads",
  "petitioner.CancelPetition": "fire-and-forget, the window reloads",
  "petitioner.ClosePetition": "fire-and-forget, the window reloads",
  "petitioner.UnClaimPetition": "fire-and-forget, the window reloads",
  "petitioner.AddPetitionRating": "fire-and-forget",
  "petitioner.UpdatePetitionRating": "fire-and-forget",
  "browserLockdownSvc.GetFlaggedSitesList": "wrapped in try/except, falls back to the local file",
  "bountyProxy.GMReimburseBounties": "GM only",
  "bountyProxy.GMClearBountyCache": "GM only",
  "mailMgr.GetBody": "needs a mailID argument, null is the correct answer for a missing mail",
  "warsInfoMgr.GetPublicWarInfo": "null for an unknown warID is the documented answer",
});

const STUB_LIMIT = 4;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

// One file may define several services, each with its own name: the class block decides the
// name, not the file. `super("x")`, `super(name)` plus `constructor(name = "x")`, and a
// subclass that reuses its parent file are all real cases here.
function classBlocks(source) {
  const starts = [];
  for (const match of source.matchAll(/\nclass\s+([A-Za-z0-9_]+)\s+extends\s+([A-Za-z0-9_.]+)/g)) {
    starts.push({ name: match[1], base: match[2], index: match.index });
  }
  return starts.map((entry, position) => ({
    ...entry,
    body: source.slice(entry.index, position + 1 < starts.length ? starts[position + 1].index : source.length),
  }));
}

function nameOfBlock(block) {
  const literal = block.body.match(/super\(\s*"([A-Za-z0-9_]+)"\s*\)/);
  if (literal) return literal[1];
  const defaultName = block.body.match(/constructor\(\s*[A-Za-z]\w*\s*=\s*"([A-Za-z0-9_]+)"/);
  if (defaultName) return defaultName[1];
  const passthrough = block.body.match(/super\(\s*([A-Za-z]\w*)\s*\)/);
  if (passthrough) {
    const parameter = passthrough[1];
    const fallback = block.body.match(new RegExp(`constructor\\(\\s*${parameter}\\s*=\\s*"([A-Za-z0-9_]+)"`));
    if (fallback) return fallback[1];
  }
  return null;
}

// {service: {method: {file, body}}}
function readServer() {
  const services = new Map();
  const blocks = new Map();
  for (const file of walk(SERVER_SRC)) {
    let source;
    try { source = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const block of classBlocks(source)) {
      const service = nameOfBlock(block);
      if (!service) continue;
      const methods = services.get(service) || new Map();
      for (const match of block.body.matchAll(/\n {2}(?:async\s+)?(?:Handle_)?([A-Za-z0-9_]+)\(([^)]*)\)\s*\{/g)) {
        const start = match.index + match[0].length;
        const end = block.body.indexOf("\n  }\n", start);
        methods.set(match[1], { file, body: block.body.slice(start, end < 0 ? block.body.length : end) });
      }
      if (methods.size) services.set(service, methods);
      blocks.set(block.name, { service, methods, base: block.base });
    }
    // A subclass in the same file (StationSvcAlias extends StationService, the monolith
    // wrappers) inherits its parent's handlers, and the client calls both names.
    for (const info of blocks.values()) {
      const parent = blocks.get(info.base);
      if (!parent || parent === info) continue;
      const inherited = services.get(info.service) || new Map();
      for (const [method, entry] of parent.methods) {
        if (!inherited.has(method)) inherited.set(method, entry);
      }
      services.set(info.service, inherited);
    }
  }
  return services;
}

// gRPC gateway coverage: every eve_public.*Request the client can send, against the types the
// local gateway names. Unnamed types are not fatal any more (the gateway answers a default
// encoded 200, fork f256261) but they carry no data, so they belong in the register.
const GATEWAY_TYPES = path.join(ROOT, "docs/client-contracts/gateway-types.json");
const normaliseType = (name) => String(name).replace(".requests_pb2", "");

function gatewayCoverage() {
  if (!fs.existsSync(GATEWAY_TYPES)) return null;
  const types = JSON.parse(fs.readFileSync(GATEWAY_TYPES, "utf8")).types || [];
  const dir = path.join(SERVER_SRC, "_secondary/express/gatewayServices");
  const named = new Set();
  for (const file of walk(dir)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\"(eve_public\.[A-Za-z0-9_.]*?Request)\"/g)) {
      named.add(normaliseType(match[1]));
    }
  }
  // The local gateway also answers a few types inline, without a gateway service: those are
  // handled too and must not be reported as gaps (measured: user.license and cosmetic.ship
  // were counted as missing while the client saw status 200).
  const inline = path.join(SERVER_SRC, "_secondary/express/publicGatewayLocal.js");
  if (fs.existsSync(inline)) {
    const source = fs.readFileSync(inline, "utf8");
    for (const match of source.matchAll(/requestTypeName === "(eve_public\.[A-Za-z0-9_.]*?Request)"/g)) {
      named.add(normaliseType(match[1]));
    }
  }
  // eve_public.Request is the gateway envelope itself, not a request type the client sends.
  const client = [...new Set(types.map(normaliseType))].filter((type) => type !== "eve_public.Request");
  const defaulted = client.filter((type) => !named.has(type));
  return { client, named, defaulted };
}

function classify(entry) {
  if (!entry) return "MISSING";
  const code = entry.body.split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));
  const constant = code.length <= STUB_LIMIT &&
    /return\s+(null|\[\]|0|""|undefined)\s*;|return\s+build(List|Dict)\(\[\]\)\s*;/.test(entry.body);
  if (constant) return "STUB";
  if (/return\s+null\s*;/.test(entry.body)) return "NULLABLE";
  return "OK";
}

function build() {
  const calls = JSON.parse(fs.readFileSync(CALLS, "utf8")).calls;
  const services = readServer();
  const rows = [];
  for (const [key, info] of Object.entries(calls)) {
    const dot = key.lastIndexOf(".");
    const service = key.slice(0, dot);
    const method = key.slice(dot + 1);
    const entry = services.get(service) && services.get(service).get(method);
    rows.push({
      service, method, key, sites: info.sites,
      module: (info.modules && info.modules[0]) || "",
      status: classify(entry),
      reason: GUARDED_STUBS[key] || "",
      file: entry ? path.relative(SERVER_SRC, entry.file) : "",
    });
  }
  const order = { MISSING: 0, STUB: 1, NULLABLE: 2, OK: 3 };
  rows.sort((left, right) => order[left.status] - order[right.status] || left.key.localeCompare(right.key));
  return rows;
}

function summary(rows) {
  const counts = { MISSING: 0, STUB: 0, NULLABLE: 0, OK: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function register(rows) {
  const counts = summary(rows);
  const lines = [
    "# Client contract register",
    "",
    "Generated by `node scripts/coop-client-contracts.cjs --write`. Do not edit by hand.",
    "",
    "The client is the specification: `docs/client-contracts/calls.json` holds every",
    "`RemoteSvc('service').Method` the pinned client build (V24.01, compiled 2026-06-16)",
    "actually issues, taken from its own bytecode, with the modules that call it.",
    "",
    "| status | meaning |",
    "| --- | --- |",
    "| MISSING | the service or handler does not exist, so `baseService` answers `null` |",
    "| STUB | the handler exists but answers only a constant `null`/empty value |",
    "| NULLABLE | the handler can answer `null` on some path |",
    "| OK | the handler builds a real answer |",
    "",
    `Total client calls: ${rows.length} · MISSING ${counts.MISSING} · STUB ${counts.STUB} · ` +
      `NULLABLE ${counts.NULLABLE} · OK ${counts.OK}`,
    "",
  ];
  for (const status of ["MISSING", "STUB", "NULLABLE"]) {
    const group = rows.filter((row) => row.status === status);
    if (!group.length) continue;
    lines.push(`## ${status} (${group.length})`, "");
    lines.push("| call | sites | client module | server file | why it is acceptable today |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of group) {
      const module = row.module ? row.module.split("/").pop() : "";
      lines.push(`| \`${row.key}\` | ${row.sites} | ${module} | ${row.file || "-"} | ${row.reason || "**unreviewed**"} |`);
    }
    lines.push("");
  }
  const gateway = gatewayCoverage();
  if (gateway) {
    lines.push(`## gRPC gateway types (${gateway.client.length} client request types, ` +
      `${gateway.named.size} names known to the gateway, ` +
      `${gateway.defaulted.length} of those client types defaulted)`, "");
    lines.push("A type no gateway service names is answered with a default-encoded 200");
    lines.push("(`fork f256261`): the client gets a valid empty message instead of a 404 it");
    lines.push("cannot decode, and the gateway logs the type. These carry no data yet:", "");
    for (const type of gateway.defaulted) lines.push(`- \`${type}\``);
    lines.push("");
  }
  lines.push("## Notes", "");
  lines.push("- `eve_public.campaign.api.*` (Agency -> Campaigns) is not a `RemoteSvc` call: the",
    "  gRPC gateway answers every campaign request with `statusCode 200` and an empty payload,",
    "  and the local proto root does not define the campaign messages. Nothing throws; the page",
    "  lists no campaigns. Turning that on is a feature (proto schema + campaign attributes).");
  lines.push("- The gRPC/gateway surfaces are only reachable when the client is started by the",
    "  launcher (`Play.bat`): it exports `http_proxy`/`https_proxy` plus the local CA, so the",
    "  client's HTTPS calls to `public-gateway.evetech.net` are CONNECTed to the local HTTP/2",
    "  listener. A client started straight from `exefile.exe` never touches it (measured: zero",
    "  CONNECT, zero H2, zero proxy requests) and every gateway surface reports",
    "  `ServerException(500, invalid character on request)`.");
  lines.push("- `fwAdvantageGateway.GetSolarSystemScores` is NOT a stub: the co-op hook fills it",
    "  from the war casualty ledger and fleet registry (`EVEJS_COOP_WAR_ADVANTAGE=1`), and the",
    "  values are clamped into the 0..100000 domain `factionwarfare/advantageState.py` accepts.");
  lines.push("- `insurgencyGatewayService` builds real payload shapes for corruption/suppression",
    "  system info, but the progress it reports is zero because this world produces no",
    "  corruption or suppression state: the shapes are correct, the numbers are honest zeros.");
  lines.push("- `insurgencySolarsystem.GetLocalCampaignClientSnapshot` used to answer",
    "  `(solarSystemID, null)` for every system; it now answers the snapshot of a system a live",
    "  campaign really covers (fork `841345f`).");
  lines.push("- Re-run the extraction against the client to refresh `calls.json` after a client",
    "  update. `tq/code.ccp` is a ZIP of `*.pyj` entries and each entry is already a complete",
    "  Python 2.7 `.pyc` (magic included), zlib-compressed:");
  lines.push("");
  lines.push("  ```python");
  lines.push("  import zipfile, zlib");
  lines.push("  from uncompyle6.main import decompile_file");
  lines.push("  z = zipfile.ZipFile(r'W:/EVE Online - 3396210/tq/code.ccp')");
  lines.push("  for name in z.namelist():");
  lines.push("      data = zlib.decompress(z.read(name))        # a valid .pyc, no header surgery");
  lines.push("      if b'RemoteSvc' not in data and b'ProxySvc' not in data:");
  lines.push("          continue                                # 370 of 12527 modules call the server");
  lines.push("      open('m.pyc', 'wb').write(data)");
  lines.push("      with open('m.py', 'w') as out:");
  lines.push("          decompile_file('m.pyc', out)");
  lines.push("  ```");
  lines.push("");
  lines.push("  Install the decompiler with `pip install --target <dir> uncompyle6` (it runs on Python");
  lines.push("  3.12 and reads 2.7 bytecode). Keep only the `.py` text: the `.pyc` files are reproducible");
  lines.push("  from `code.ccp` in seconds and were deleted after use.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const rows = build();
  const counts = summary(rows);
  const mode = process.argv[2] || "";
  if (mode === "--write") {
    fs.writeFileSync(REGISTER, register(rows));
    fs.writeFileSync(BASELINE, JSON.stringify({
      note: "known client-facing stubs; a new entry means a client call got a new placeholder",
      missing: rows.filter((r) => r.status === "MISSING").map((r) => r.key),
      stubs: rows.filter((r) => r.status === "STUB").map((r) => r.key),
    }, null, 2) + "\n");
    console.log(`REGISTER_WRITTEN calls=${rows.length} missing=${counts.MISSING} ` +
      `stub=${counts.STUB} nullable=${counts.NULLABLE} ok=${counts.OK}`);
    return;
  }
  if (mode === "--check") {
    const baseline = fs.existsSync(BASELINE)
      ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
      : { missing: [], stubs: [] };
    const known = new Set([...(baseline.missing || []), ...(baseline.stubs || [])]);
    const fresh = rows
      .filter((row) => row.status === "MISSING" || row.status === "STUB")
      .filter((row) => !known.has(row.key))
      .map((row) => `${row.status} ${row.key}`);
    if (fresh.length) {
      console.error("CLIENT_CONTRACTS_REGRESSION\n" + fresh.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(`CONTRACTS_OK calls=${rows.length} missing=${counts.MISSING} stub=${counts.STUB}`);
    return;
  }
  console.log(`calls=${rows.length} missing=${counts.MISSING} stub=${counts.STUB} ` +
    `nullable=${counts.NULLABLE} ok=${counts.OK}`);
  for (const row of rows.filter((r) => r.status !== "OK").slice(0, 12)) {
    console.log(` ${row.status} ${row.key}`);
  }
}

main();
