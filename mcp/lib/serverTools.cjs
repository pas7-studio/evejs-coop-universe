"use strict";
// EveJS server-side tools: read the running world (containers, logs, telemetry,
// native fleet records, game store) and perform explicit, confirmed actions.
// Everything is read-only unless the tool has `mutating: true` and the caller
// passed confirm: true. No tool ever invents gameplay state.
const { execArgv, cap } = require("./mcpServer.cjs");
const audit = require("../../scripts/alife-audit.cjs");

const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}$/;

function createServerTools({
  exec = execArgv,
  container = process.env.EVEJS_SERVER_CONTAINER || "evejs-server-1",
  project = process.env.EVEJS_COMPOSE_PROJECT || "evejs",
  dataDir = "/var/lib/evejs",
  composeDir = process.env.EVEJS_COMPOSE_DIR || "",
  composeFiles = ["compose.yaml", "compose.coop-probe.yaml"],
  clock = () => Date.now(),
} = {}) {
  const docker = (args, options = {}) => exec(["docker", ...args], { timeoutMs: 60000, ...options });
  // The overlay installer's own module list is the single source of truth for
  // "what must be in the container", so the tools cannot drift from it.
  const nodePath = require("node:path");
  const repoRoot = nodePath.resolve(__dirname, "..", "..");
  const integrationDir = nodePath.join(repoRoot, "integration");
  const expected = (() => {
    try {
      const source = require("node:fs").readFileSync(nodePath.join(repoRoot, "scripts", "patch-evejs-coop.cjs"), "utf8");
      const block = source.match(/const names=\[([\s\S]*?)\];/);
      if (!block) return [];
      return [...new Set([...block[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((row) => row[1]))];
    } catch (_error) {
      return [];
    }
  })();
  const inContainer = (script, { timeoutMs = 30000 } = {}) =>
    docker(["exec", container, "sh", "-c", script], { timeoutMs });

  function must(result, what) {
    if (!result.ok) {
      throw new Error(`${what} failed (exit ${result.code}): ${cap(result.stderr || result.stdout, 600)}`);
    }
    return result.stdout;
  }

  function readDataFile(name, maxBytes = 400000) {
    if (!SAFE_NAME.test(String(name || ""))) throw new Error(`unsafe file name: ${name}`);
    return must(inContainer(`head -c ${Number(maxBytes)} ${dataDir}/${name}`), `read ${name}`);
  }

  function readJsonData(name) {
    const raw = readDataFile(name).trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`${name} is not valid JSON: ${error.message}`);
    }
  }

  function tailEvents(lines) {
    const count = Math.min(Math.max(Number(lines) || 3000, 1), 200000);
    return audit.parse(must(inContainer(`tail -n ${count} ${dataDir}/coop-events.jsonl`), "read events"));
  }

  function recent(rows, minutes) {
    if (!minutes) return rows;
    const from = new Date(clock() - Number(minutes) * 60000).toISOString();
    return rows.filter((row) => String(row.at || "") >= from);
  }

  const tools = [
    {
      name: "server_status",
      description: "Container health for the local EveJS compose project plus a one-line ALIFE freshness check.",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        const ps = docker([
          "ps", "-a",
          "--filter", `label=com.docker.compose.project=${project}`,
          "--format", "{{.Names}}\t{{.Status}}",
        ]);
        const lines = must(ps, "docker ps").split(/\r?\n/).filter(Boolean);
        const events = tailEvents(200);
        const last = events.length ? events[events.length - 1] : null;
        return [
          `project=${project} containers=${lines.length}`,
          ...lines.map((line) => `  ${line}`),
          last ? `last event: ${last.at} ${last.event} (system ${last.systemID || "?"})` : "last event: none",
          `telemetry lines sampled: ${events.length}`,
        ].join("\n");
      },
    },
    {
      name: "server_logs",
      description: "Tail container logs and optionally keep only matching lines.",
      inputSchema: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["server", "market"], description: "Which compose service." },
          lines: { type: "integer", description: "How many log lines to read (default 120)." },
          grep: { type: "string", description: "Case-insensitive regular expression filter.", maxLength: 200 },
        },
      },
      async handler(args) {
        const target = args.role === "market" ? `${project}-market-1` : container;
        const count = Math.min(Math.max(Number(args.lines) || 120, 1), 5000);
        const raw = must(docker(["logs", target, "--tail", String(count)]), `logs ${target}`);
        if (!args.grep) return cap(raw, 12000);
        const pattern = new RegExp(String(args.grep), "i");
        const kept = raw.split(/\r?\n/).filter((line) => pattern.test(line));
        return cap(kept.length ? kept.join("\n") : `no line matched ${pattern} in the last ${count} lines`, 12000);
      },
    },
    {
      name: "events",
      description: "Read the append-only coop-events.jsonl telemetry with filters (event name, system, recency).",
      inputSchema: {
        type: "object",
        properties: {
          lines: { type: "integer", description: "How many trailing telemetry lines to load (default 3000)." },
          event: { type: "string", description: "Exact event name or a substring of it.", maxLength: 80 },
          systemID: { type: "integer", description: "Only this solar system." },
          minutes: { type: "integer", description: "Only records newer than N minutes." },
          limit: { type: "integer", description: "How many records to return (default 30, max 200)." },
        },
      },
      async handler(args) {
        const loaded = tailEvents(args.lines || 3000);
        let rows = recent(loaded, args.minutes);
        if (args.event) {
          const needle = String(args.event);
          rows = rows.filter((row) => {
            const name = String(row.event || "");
            return name === needle || name.includes(needle);
          });
        }
        if (args.systemID) rows = rows.filter((row) => Number(row.systemID) === Number(args.systemID));
        const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 200);
        const sample = rows.slice(-limit);
        const head = `telemetry lines loaded=${loaded.length} matched=${rows.length} shown=${sample.length}`;
        return `${head}\n` + sample.map((row) => JSON.stringify(row)).join("\n");
      },
    },
    {
      name: "alife_summary",
      description: "Aggregated ALIFE audit: event counts, named blockers, actors, trades, deliveries.",
      inputSchema: {
        type: "object",
        properties: {
          lines: { type: "integer", description: "Trailing telemetry lines to analyse (default 6000)." },
          top: { type: "integer", description: "How many entries per section (default 8)." },
          minutes: { type: "integer", description: "Only records newer than N minutes." },
        },
      },
      async handler(args) {
        const rows = recent(tailEvents(args.lines || 6000), args.minutes);
        const summary = audit.summarize(rows, { top: Math.min(Math.max(Number(args.top) || 8, 1), 30) });
        return audit.report(summary, { title: "ALIFE audit (live container)" });
      },
    },
    {
      name: "alife_timeline",
      description: "The NPC life chain (fleet-seeded -> cargo-loaded -> warp -> delivered -> trade) as a timeline.",
      inputSchema: {
        type: "object",
        properties: {
          lines: { type: "integer", description: "Trailing telemetry lines to analyse (default 6000)." },
          limit: { type: "integer", description: "How many timeline rows (default 30)." },
        },
      },
      async handler(args) {
        const rows = tailEvents(args.lines || 6000);
        const rowsOut = audit.timeline(rows, { limit: Math.min(Math.max(Number(args.limit) || 30, 1), 200) });
        if (!rowsOut.length) return "no life-chain records in the sampled telemetry";
        return rowsOut.map((row) => row.line).join("\n");
      },
    },
    {
      name: "fleet_state",
      description: "Native co-op fleet as the server persists it: pilots, roles, links to physics entities, ore and credits.",
      inputSchema: {
        type: "object",
        properties: {
          systemID: { type: "integer", description: "Restrict output to one solar system." },
        },
      },
      async handler(args) {
        const world = readJsonData("coop-virtual-world.json") || {};
        const links = (readJsonData("coop-npc-links.json") || {}).links || {};
        const economy = readJsonData("coop-economy.json") || {};
        const pilots = Array.isArray(world.pilots) ? world.pilots : [];
        const systems = new Map();
        for (const pilot of pilots) {
          const id = Number(pilot.systemID);
          if (args.systemID && id !== Number(args.systemID)) continue;
          const link = links[pilot.id] || {};
          const role = link.role || (economy.pilots?.[pilot.id]?.role) || "unknown";
          const entry = systems.get(id) || { systemID: id, roles: new Map(), linked: 0, durable: 0 };
          entry.roles.set(role, (entry.roles.get(role) || 0) + 1);
          if (link.entityID) entry.linked += 1;
          if (link.durable) entry.durable += 1;
          systems.set(id, entry);
        }
        if (!systems.size) return "no pilots matched";
        const out = [];
        for (const entry of systems.values()) {
          const econ = economy.systems?.[entry.systemID] || {};
          const roles = [...entry.roles.entries()].map(([role, count]) => `${role}=${count}`).join(" ");
          out.push(
            `system ${entry.systemID}: pilots=${[...entry.roles.values()].reduce((a, b) => a + b, 0)} ` +
            `linked=${entry.linked} durable=${entry.durable} | ${roles} | ` +
            `ore=${econ.ore ?? "?"} demand=${econ.demand ?? "?"} security=${econ.security ?? "?"} losses=${econ.losses ?? "?"}`,
          );
        }
        return out.join("\n");
      },
    },
    {
      name: "economy",
      description: "Co-op economy ledger: per-system ore/demand and per-pilot credits and completed jobs.",
      inputSchema: {
        type: "object",
        properties: { top: { type: "integer", description: "How many pilots to list (default 10)." } },
      },
      async handler(args) {
        const economy = readJsonData("coop-economy.json") || {};
        const systems = Object.entries(economy.systems || {})
          .map(([id, value]) => `  ${id}: ore=${value.ore} goods=${value.goods} demand=${value.demand} security=${value.security} losses=${value.losses}`);
        const pilots = Object.entries(economy.pilots || {})
          .sort((a, b) => (b[1].completed || 0) - (a[1].completed || 0))
          .slice(0, Math.min(Math.max(Number(args.top) || 10, 1), 60))
          .map(([id, value]) => `  ${id} ${String(value.role || "?").padEnd(8)} credits=${value.credits} completed=${value.completed} cargo=${value.cargo}`);
        return [
          `last update: ${economy.lastAt ? new Date(economy.lastAt).toISOString() : "?"}`,
          "systems",
          ...systems,
          "pilots (by completed jobs)",
          ...pilots,
        ].join("\n");
      },
    },
    {
      name: "world_data",
      description: "Inspect the native game store: list collections, or read one collection document (bounded).",
      inputSchema: {
        type: "object",
        properties: {
          collection: { type: "string", description: "Collection name; omit to list available collections.", maxLength: 80 },
          maxBytes: { type: "integer", description: "Bytes to read for one collection (default 6000, max 60000)." },
        },
      },
      async handler(args) {
        if (!args.collection) {
          const list = must(inContainer(`ls -1 ${dataDir}/gameStore/data 2>/dev/null`), "list gameStore");
          return "gameStore collections:\n" + list.split(/\r?\n/).filter(Boolean).map((line) => `  ${line}`).join("\n");
        }
        if (!SAFE_NAME.test(args.collection)) throw new Error(`unsafe collection name: ${args.collection}`);
        const limit = Math.min(Math.max(Number(args.maxBytes) || 6000, 200), 60000);
        return cap(must(inContainer(`head -c ${limit} ${dataDir}/gameStore/data/${args.collection}`), "read collection"), 12000);
      },
    },
    {
      name: "container_exec",
      description: "Run a diagnostic command inside the co-op server container (requires confirm: true).",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command executed inside the container.", maxLength: 500 },
          confirm: { type: "boolean", description: "Must be true; confirms an intentional action." },
        },
        required: ["command", "confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to run a command in the container";
        const result = inContainer(String(args.command), { timeoutMs: 120000 });
        return [
          `exit=${result.code}`,
          result.stdout ? `--- stdout ---\n${cap(result.stdout, 8000)}` : "",
          result.stderr ? `--- stderr ---\n${cap(result.stderr, 4000)}` : "",
        ].filter(Boolean).join("\n");
      },
    },
    {
      name: "agent_state",
      description: "One read-only probe of a player-like NPC: contract, package location/flag, courier station, hull, persisted leg and delivery history.",
      inputSchema: {
        type: "object",
        properties: {
          contractID: { type: "integer", description: "Contract to inspect (default: first in-progress courier contract)." },
        },
      },
      async handler(args) {
        const script = require("node:fs").readFileSync(require("node:path").join(__dirname, "probe-agent-state.cjs"), "utf8");
        const contractID = Number(args && args.contractID) || 0;
        const execArgs = ["exec", "-i"];
        if (contractID > 0) execArgs.push("-e", "Q_CONTRACT=" + contractID);
        execArgs.push(container, "node", "-");
        const result = docker(execArgs, { input: script, timeoutMs: 90000 });
        if (!result.ok) return "agent_state failed:\n" + cap(result.stderr || result.stdout, 3000);
        const line = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        let probe = {};
        try { probe = JSON.parse(line); } catch (error) { return "agent_state returned non-JSON:\n" + cap(line, 2000); }
        const rows = [];
        if (!probe.contract) {
          rows.push("contract: none", ...(probe.notes || []));
          return rows.join("\n");
        }
        const c = probe.contract;
        rows.push(`contract ${c.contractID}: status=${c.status} (1=IN_PROGRESS, 4=COMPLETED) ${c.volumeM3} m3, reward ${c.reward}, collateral ${c.collateral}`);
        rows.push(`  route: ${c.startStationID} -> ${c.endStationID}, issuer ${c.issuerID}, acceptor ${c.acceptorID}`);
        rows.push(probe.package
          ? `  package ${probe.package.itemID}: owner=${probe.package.ownerID} location=${probe.package.locationID} flag=${probe.package.flagID} (4=station hangar, 5=cargo hold)`
          : "  package: not found");
        if (probe.courier) rows.push(`  courier ${probe.courier.characterName || probe.courier.characterID}: stationID=${probe.courier.stationID} system=${probe.courier.solarSystemID}`);
        if (probe.ship) rows.push(`  hull ${probe.ship.itemID}: location=${probe.ship.locationID} flag=${probe.ship.flagID} capacity=${probe.ship.capacity} m3`);
        rows.push(probe.leg ? `  leg: step=${probe.leg.step} system=${probe.leg.systemID} entity=${probe.leg.entityID}` : "  leg: none persisted");
        if (probe.history) {
          const last = probe.history.lastIncident;
          rows.push(`  history: incidents=${probe.history.incidents}${last ? " (last: " + last.kind + ")" : ""}`);
        }
        return rows.join("\n");
      },
    },
    {
      name: "overlay_status",
      description: "Which co-op overlay modules are actually present in the running container, plus the coop env flags. Read-only.",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        const present = must(inContainer(`ls -1 /app/server/src/space/coop*.js 2>/dev/null | wc -l`), "count overlay modules");
        const missing = must(inContainer(`cd /app/server/src/space && for m in ${expected.join(" ")}; do [ -f \$m.js ] || echo \$m; done`), "list missing modules");
        const env = inContainer("env | grep -E '^EVEJS_COOP' | sort");
        const uptime = must(docker(["ps", "--filter", `name=${container}`, "--format", "{{.Status}}"]), "docker ps").trim();
        const missingList = String(missing || "").split(/\r?\n/).filter(Boolean);
        return [
          `container ${container}: ${uptime || "not running"}`,
          `overlay modules in container: ${String(present || "").trim()} (expected ${expected.length})`,
          missingList.length ? `missing: ${missingList.join(", ")}` : "missing: none",
          "coop env:",
          ...String(env.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => "  " + line),
        ].join("\n");
      },
    },
    {
      name: "deploy_overlay",
      description: "Copy this repository's co-op overlay modules into the running container and optionally restart it (requires confirm: true).",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          modules: { type: "array", items: { type: "string" }, description: "Module names without extension (default: every module registered in scripts/patch-evejs-coop.cjs)." },
          restart: { type: "boolean", description: "Restart the container afterwards (default true)." },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to deploy overlay modules";
        const wanted = Array.isArray(args.modules) && args.modules.length ? args.modules.map(String) : expected;
        const copied = [];
        const skipped = [];
        for (const name of wanted) {
          if (!SAFE_NAME.test(name)) { skipped.push(name + " (unsafe name)"); continue; }
          const source = require("node:path").join(integrationDir, name + ".cjs");
          if (!require("node:fs").existsSync(source)) { skipped.push(name + " (no source)"); continue; }
          const result = docker(["cp", source, `${container}:/app/server/src/space/${name}.js`], { timeoutMs: 60000 });
          if (result.ok) copied.push(name); else skipped.push(name + " (" + cap(result.stderr, 120) + ")");
        }
        let restartLine = "restart: skipped";
        if (args.restart !== false) {
          const result = docker(["restart", container], { timeoutMs: 180000 });
          restartLine = `restart: exit=${result.code}`;
        }
        return [
          `deployed ${copied.length}/${wanted.length} modules into ${container}`,
          skipped.length ? `skipped: ${skipped.join(", ")}` : "skipped: none",
          restartLine,
        ].join("\n");
      },
    },
    {
      name: "admin_command",
      description: "Run one native chat/GM command as a live character (requires confirm: true). Executed inside the server process by coopAdminBridge, so the real session and space runtime are used.",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          characterID: { type: "integer", description: "Character that must be logged in." },
          command: { type: "string", description: "Slash command, e.g. /where, /miner, /tr me pos=x,y,z.", maxLength: 200 },
          waitMs: { type: "integer", description: "How long to wait for the in-server answer (default 15000)." },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["characterID", "command", "confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to run a command as a live character";
        const characterID = Number(args.characterID) || 0;
        const command = String(args.command || "").trim();
        if (!(characterID > 0) || !command) return "characterID and command are required";
        const script = require("node:fs").readFileSync(require("node:path").join(__dirname, "probe-admin-command.cjs"), "utf8");
        const result = docker(
          ["exec", "-i", "-e", "Q_CHAR=" + characterID, "-e", "Q_ACTION=chat_command", "-e", "Q_CMD_B64=" + Buffer.from(command, "utf8").toString("base64"), "-e", "Q_WAIT_MS=" + (Number(args.waitMs) || 20000), container, "node", "-"],
          { input: script, timeoutMs: 90000 },
        );
        const line = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        let answer = {};
        try { answer = JSON.parse(line); } catch (error) { return "admin_command returned non-JSON: " + cap(result.stderr || line, 2000); }
        if (!answer.ok) return `refused: ${answer.error || "unknown error"}`;
        return [`command: ${answer.command}`, `handled: ${answer.handled}`, answer.message ? `message: ${answer.message}` : "message: (none)"].join("\n");
      },
    },
    {
      name: "admin_remove_item",
      description: "Delete one item a character really owns, inside the server process (requires confirm: true). Refuses the active hull.",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          characterID: { type: "integer", description: "Owner character; must be logged in." },
          itemID: { type: "integer", description: "Item to delete." },
          waitMs: { type: "integer", description: "How long to wait for the in-server answer (default 20000)." },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["characterID", "itemID", "confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to delete an item";
        const characterID = Number(args.characterID) || 0;
        const itemID = Number(args.itemID) || 0;
        if (!(characterID > 0) || !(itemID > 0)) return "characterID and itemID are required";
        const script = require("node:fs").readFileSync(require("node:path").join(__dirname, "probe-admin-command.cjs"), "utf8");
        const result = docker(
          ["exec", "-i", "-e", "Q_CHAR=" + characterID, "-e", "Q_ACTION=remove_item", "-e", "Q_ITEM_ID=" + itemID, "-e", "Q_WAIT_MS=" + (Number(args.waitMs) || 20000), container, "node", "-"],
          { input: script, timeoutMs: 90000 },
        );
        const line = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        let answer = {};
        try { answer = JSON.parse(line); } catch (error) { return "admin_remove_item returned non-JSON: " + cap(result.stderr || line, 2000); }
        if (!answer.ok) return `refused: ${answer.error || "unknown error"}`;
        return `removed item ${answer.item && answer.item.itemID} (${answer.item && answer.item.name || "unknown"}, type ${answer.item && answer.item.typeID})`;
      },
    },
    {
      name: "admin_give_item",
      description: "Grant an item or ship hull to a character's station hangar, inside the server process. Works while the character is offline (requires confirm: true).",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          characterID: { type: "integer", description: "Receiving character." },
          typeID: { type: "integer", description: "Item type to grant (32880 = Venture)." },
          quantity: { type: "integer", description: "How many (default 1)." },
          stationID: { type: "integer", description: "Optional station override; defaults to where the character is docked." },
          waitMs: { type: "integer", description: "How long to wait for the in-server answer (default 20000)." },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["characterID", "typeID", "confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to grant an item";
        const characterID = Number(args.characterID) || 0;
        const typeID = Number(args.typeID) || 0;
        if (!(characterID > 0) || !(typeID > 0)) return "characterID and typeID are required";
        const script = require("node:fs").readFileSync(require("node:path").join(__dirname, "probe-admin-command.cjs"), "utf8");
        const execArgs = ["exec", "-i", "-e", "Q_CHAR=" + characterID, "-e", "Q_ACTION=give_item", "-e", "Q_TYPE_ID=" + typeID];
        if (Number(args.quantity) > 0) execArgs.push("-e", "Q_QUANTITY=" + Number(args.quantity));
        if (Number(args.stationID) > 0) execArgs.push("-e", "Q_STATION_ID=" + Number(args.stationID));
        execArgs.push("-e", "Q_WAIT_MS=" + (Number(args.waitMs) || 20000), container, "node", "-");
        const result = docker(execArgs, { input: script, timeoutMs: 90000 });
        const line = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        let answer = {};
        try { answer = JSON.parse(line); } catch (error) { return "admin_give_item returned non-JSON: " + cap(result.stderr || line, 2000); }
        if (!answer.ok) return `refused: ${answer.error || "unknown error"}`;
        return [
          `granted ${answer.name || "item"} (type ${answer.typeID}) x${answer.quantity} to station ${answer.stationID}`,
          answer.itemID ? `itemID: ${answer.itemID}` : "itemID: (not reported)",
          `online: ${answer.online}${answer.notified ? ", client notified" : ""}`,
        ].join("\n");
      },
    },
    {
      name: "admin_board_ship",
      description: "Make an owned, docked ship the active hull. Native and session-free, so it works while the character is offline (requires confirm: true).",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          characterID: { type: "integer", description: "Owning character." },
          itemID: { type: "integer", description: "Ship item to board." },
          waitMs: { type: "integer", description: "How long to wait for the in-server answer (default 20000)." },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["characterID", "itemID", "confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to switch the active hull";
        const characterID = Number(args.characterID) || 0;
        const itemID = Number(args.itemID) || 0;
        if (!(characterID > 0) || !(itemID > 0)) return "characterID and itemID are required";
        const script = require("node:fs").readFileSync(require("node:path").join(__dirname, "probe-admin-command.cjs"), "utf8");
        const result = docker(
          ["exec", "-i", "-e", "Q_CHAR=" + characterID, "-e", "Q_ACTION=board_ship", "-e", "Q_ITEM_ID=" + itemID, "-e", "Q_WAIT_MS=" + (Number(args.waitMs) || 20000), container, "node", "-"],
          { input: script, timeoutMs: 90000 },
        );
        const line = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        let answer = {};
        try { answer = JSON.parse(line); } catch (error) { return "admin_board_ship returned non-JSON: " + cap(result.stderr || line, 2000); }
        if (!answer.ok) return `refused: ${answer.error || "unknown error"}`;
        return `boarded ${answer.name || "ship"} (item ${answer.itemID}) for character ${answer.characterID}`;
      },
    },
    {
      name: "admin_fit_ship",
      description: "Fit modules onto an owned, docked hull: grants each module to the hangar and fits it natively. Works while the character is offline (requires confirm: true).",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          characterID: { type: "integer", description: "Owning character." },
          itemID: { type: "integer", description: "Hull item to fit." },
          modules: {
            type: "array",
            description: "Modules to grant and fit, e.g. [{name:'Miner II', count:2}].",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Module name (or use typeID)." },
                typeID: { type: "integer", description: "Module type ID." },
                count: { type: "integer", description: "How many (default 1)." },
              },
            },
          },
          grant: { type: "boolean", description: "Grant missing modules first (default true). Set false to fit only items already in the hangar." },
          waitMs: { type: "integer", description: "How long to wait for the in-server answer (default 30000)." },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["characterID", "itemID", "modules", "confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to fit a ship";
        const characterID = Number(args.characterID) || 0;
        const itemID = Number(args.itemID) || 0;
        const modules = Array.isArray(args.modules) ? args.modules : [];
        if (!(characterID > 0) || !(itemID > 0) || !modules.length) return "characterID, itemID and modules[] are required";
        const script = require("node:fs").readFileSync(require("node:path").join(__dirname, "probe-admin-command.cjs"), "utf8");
        const payload = Buffer.from(JSON.stringify(modules), "utf8").toString("base64");
        const result = docker(
          ["exec", "-i", "-e", "Q_CHAR=" + characterID, "-e", "Q_ACTION=fit_ship", "-e", "Q_ITEM_ID=" + itemID, "-e", "Q_MODULES_B64=" + payload, "-e", "Q_GRANT=" + (args.grant === false ? "0" : "1"), "-e", "Q_WAIT_MS=" + (Number(args.waitMs) || 30000), container, "node", "-"],
          { input: script, timeoutMs: 120000 },
        );
        const line = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
        let answer = {};
        try { answer = JSON.parse(line); } catch (error) { return "admin_fit_ship returned non-JSON: " + cap(result.stderr || line, 2000); }
        if (!answer.ok) return `refused: ${answer.error || "nothing fitted"}`;
        const rows = (answer.results || []).map((row) => `  ${row.ok ? "OK  " : "FAIL"} ${row.name}${row.fitted ? " x" + row.fitted : ""}${row.error ? " - " + row.error : ""}`);
        return [`fitted ${answer.fitted}/${answer.attempted} modules on hull ${answer.itemID}`, ...rows].join("\n");
      },
    },
    {
      name: "restart_server",
      description: "Restart the co-op server service in this compose project only (requires confirm: true).",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", enum: ["server", "market"], description: "Service to restart (default server)." },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to restart a service";
        const service = args.service === "market" ? "market" : "server";
        const base = ["compose", "-p", project];
        for (const file of composeFiles) base.push("-f", file);
        const result = docker([...base, "restart", service], { timeoutMs: 180000, cwd: composeDir || undefined });
        return `restart ${service}: exit=${result.code}\n${cap(result.stdout || result.stderr, 3000)}`;
      },
    },
  ];

  return { tools, container, project, dataDir };
}

module.exports = { createServerTools, SAFE_NAME };
