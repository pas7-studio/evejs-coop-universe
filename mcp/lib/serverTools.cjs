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
