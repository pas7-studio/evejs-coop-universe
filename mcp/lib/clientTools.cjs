"use strict";
// EVE client-side tools: what the player's own client can tell us (process,
// logs, chat) and the one setting we may touch safely (tab labels in a copied
// profile). The client UI itself is never automated: EVE has no scripting API,
// and importing a profile is a deliberate human click.
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { execArgv, cap } = require("./mcpServer.cjs");

function decode(buffer) {
  if (!buffer || !buffer.length) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  const start = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(start));
  } catch {
    try {
      return new TextDecoder("windows-1251").decode(buffer);
    } catch {
      return buffer.subarray(start).toString("utf8");
    }
  }
}

function createClientTools({
  fs = nodeFs,
  path = nodePath,
  exec = execArgv,
  env = process.env,
  clock = () => Date.now(),
} = {}) {
  const home = env.USERPROFILE || env.HOME || "";
  const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const ccpRoot = path.join(localAppData, "CCP", "EVE");
  const docsEve = path.join(home, "Documents", "EVE");
  const overviewDir = path.join(docsEve, "Overview");

  function settingsDirs() {
    let entries = [];
    try {
      entries = fs.readdirSync(ccpRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isDirectory() && /^w_eve_online_-_\d+_tq_/.test(entry.name))
      .map((entry) => path.join(ccpRoot, entry.name, "settings"))
      .filter((dir) => {
        try {
          return fs.statSync(dir).isDirectory();
        } catch {
          return false;
        }
      });
  }

  function settingsDir() {
    const dirs = settingsDirs();
    if (!dirs.length) throw new Error(`no EVE settings directory under ${ccpRoot}`);
    return dirs[0];
  }

  function statOrNull(file) {
    try {
      return fs.statSync(file);
    } catch {
      return null;
    }
  }

  function newestFile(dir, filter) {
    let best = null;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (filter && !filter(name)) continue;
        const full = path.join(dir, name);
        const stat = statOrNull(full);
        if (!stat || !stat.isFile()) continue;
        if (!best || stat.mtimeMs > best.mtimeMs) best = { file: full, name, mtimeMs: stat.mtimeMs, size: stat.size };
      }
    } catch {
      return null;
    }
    return best;
  }

  function tail(file, lines) {
    const buffer = fs.readFileSync(file);
    const rows = decode(buffer).split(/\r?\n/);
    return rows.slice(-Math.min(Math.max(Number(lines) || 40, 1), 2000));
  }

  function clientRunning() {
    const result = exec(["tasklist", "/FI", "IMAGENAME eq exefile.exe", "/FO", "CSV", "/NH"], { timeoutMs: 20000 });
    const text = `${result.stdout || ""}${result.stderr || ""}`;
    const pid = (text.match(/exefile\.exe","(\d+)"/i) || [])[1];
    return pid ? Number(pid) : null;
  }

  // The launcher has moved between installs: Play.bat existed earlier, today
  // only bin64/exefile.exe is present. Resolve instead of hardcoding one path.
  function launcherCandidates(explicit) {
    const list = [];
    if (explicit) list.push(explicit);
    if (env.EVEJS_CLIENT_LAUNCHER) list.push(env.EVEJS_CLIENT_LAUNCHER);
    const roots = [
      env.EVEJS_CLIENT_ROOT,
      // Well-known installs, skipped when a caller wants deterministic
      // resolution (tests, or a machine with several installs).
      ...(env.EVEJS_CLIENT_ALLOW_DEFAULTS === "0"
        ? []
        : [
            "W:\\EVE Online - 3396210",
            env.ProgramFiles ? path.join(env.ProgramFiles, "EVE Online - 3396210") : "",
            "C:\\EVE\\EVE Online - 3396210",
          ]),
    ].filter(Boolean);
    for (const root of roots) {
      list.push(path.join(root, "tq", "Play.bat"));
      list.push(path.join(root, "tq", "bin64", "exefile.exe"));
    }
    return [...new Set(list)];
  }

  function resolveLauncher(explicit) {
    for (const candidate of launcherCandidates(explicit)) {
      const stat = statOrNull(candidate);
      if (stat && stat.isFile()) return candidate;
    }
    return null;
  }

  const tools = [
    {
      name: "client_status",
      description: "Is the EVE client running, which character, and how fresh are its gamelog and Local chatlog.",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        const dir = settingsDirs()[0];
        const chars = dir
          ? fs.readdirSync(dir).filter((name) => /^core_char_\d+\.dat$/.test(name))
          : [];
        const gamelog = newestFile(path.join(docsEve, "logs", "Gamelogs"));
        const chatlog = newestFile(path.join(docsEve, "logs", "Chatlogs"), (name) => name.startsWith("Local"));
        const pid = clientRunning();
        const age = (ms) => (ms ? `${Math.round((clock() - ms) / 1000)}s ago` : "never");
        return [
          `client process: ${pid ? `running (pid ${pid})` : "not running"}`,
          `settings dir: ${dir || "not found"}`,
          `character files: ${chars.length}${chars.length ? ` (${chars.map((c) => c.replace(/^core_char_|\.dat$/g, "")).join(", ")})` : ""}`,
          gamelog ? `gamelog: ${gamelog.name} ${gamelog.size}B, updated ${age(gamelog.mtimeMs)}` : "gamelog: none",
          chatlog ? `local chatlog: ${chatlog.name} ${chatlog.size}B, updated ${age(chatlog.mtimeMs)}` : "local chatlog: none",
          `overview files: ${overviewFiles().map((f) => `${f.name} (${f.size}B)`).join(", ") || "none"}`,
        ].join("\n");
      },
    },
    {
      name: "client_console",
      description: "Tail the newest EVE gamelog (the client's own console), optionally filtered.",
      inputSchema: {
        type: "object",
        properties: {
          lines: { type: "integer", description: "How many trailing lines (default 60)." },
          grep: { type: "string", description: "Case-insensitive regular expression filter.", maxLength: 200 },
        },
      },
      async handler(args) {
        const newest = newestFile(path.join(docsEve, "logs", "Gamelogs"));
        if (!newest) return "no gamelog yet - the client writes one after login";
        let rows = tail(newest.file, args.lines || 60);
        if (args.grep) {
          const pattern = new RegExp(String(args.grep), "i");
          rows = rows.filter((line) => pattern.test(line));
        }
        return cap(`file: ${newest.name}\n` + rows.join("\n"), 12000);
      },
    },
    {
      name: "client_chat",
      description: "Tail a client chat log (Local by default) so real in-game conversation can be read back.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Chat log prefix, e.g. Local, Corp, 'EveJS Elysian chat'.", maxLength: 60 },
          lines: { type: "integer", description: "How many trailing lines (default 40)." },
        },
      },
      async handler(args) {
        const channel = String(args.channel || "Local");
        const newest = newestFile(path.join(docsEve, "logs", "Chatlogs"), (name) => name.startsWith(channel));
        if (!newest) return `no chat log matching "${channel}"`;
        const rows = tail(newest.file, args.lines || 40).filter((line) => line.trim());
        return cap(`file: ${newest.name}\n` + rows.join("\n"), 12000);
      },
    },
    {
      name: "overview_tabs",
      description: "Read the tab/bracket labels stored in the client's own settings file (best effort, read-only).",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        const dir = settingsDir();
        const file = path.join(dir, "core_user_3.dat");
        const stat = statOrNull(file);
        if (!stat) return `no core_user_3.dat in ${dir}`;
        const text = decode(fs.readFileSync(file));
        const labels = new Set();
        for (const match of text.matchAll(/<color=0x[0-9A-Fa-f]{8}>(?:<fontsize=\d+>)?\s*([^\x00-\x1F<>]{1,40}?)\s*(?:<\/fontsize>)?<\/color>/g)) {
          const label = match[1].replace(/\s+/g, " ").trim();
          if (label && label !== ".") labels.add(label);
        }
        const bracket = [...labels].filter((label) => /^[/\\:*]|^\./.test(label) || /bracket/i.test(label));
        return [
          `file: ${file} (${stat.size}B, updated ${new Date(stat.mtimeMs).toISOString()})`,
          `labelled entries found: ${labels.size}`,
          bracket.length ? `bracket/preset labels:\n${bracket.map((l) => `  ${l}`).join("\n")}` : "no bracket labels parsed",
          `other labels: ${[...labels].filter((l) => !bracket.includes(l)).slice(0, 20).join(" | ") || "none"}`,
          "note: the client keeps overview filters in binary form; labels are readable, presets are not.",
        ].join("\n");
      },
    },
    {
      name: "overview_rename_tab",
      description: "Rename a tab label inside a copy of the client settings file, only when the byte length is identical. Requires confirm: true.",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Exact current label.", maxLength: 60 },
          to: { type: "string", description: "New label with the same UTF-8 byte length.", maxLength: 60 },
          confirm: { type: "boolean", description: "Must be true." },
        },
        required: ["from", "to", "confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true";
        const from = String(args.from);
        const to = String(args.to);
        const fromBytes = Buffer.byteLength(from, "utf8");
        const toBytes = Buffer.byteLength(to, "utf8");
        if (fromBytes !== toBytes) {
          return `refused: "${from}" is ${fromBytes} bytes, "${to}" is ${toBytes}; a different length would corrupt client settings`;
        }
        if (clientRunning()) return "refused: the client is running and owns this file; close it first";
        const file = path.join(settingsDir(), "core_user_3.dat");
        const buffer = fs.readFileSync(file);
        const needle = Buffer.from(from, "utf8");
        const at = buffer.indexOf(needle);
        if (at < 0) return `label "${from}" not found in ${path.basename(file)}`;
        const backup = `${file}.bak-${clock()}`;
        fs.writeFileSync(backup, buffer);
        const next = Buffer.from(buffer);
        Buffer.from(to, "utf8").copy(next, at);
        fs.writeFileSync(file, next);
        return `renamed 1 occurrence at byte ${at}\nbackup: ${backup}`;
      },
    },
    {
      name: "install_profile",
      description: "Copy an overview profile YAML into Documents/EVE/Overview so the client can import it.",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "Absolute path of the profile YAML.", maxLength: 400 },
          name: { type: "string", description: "Target file name (default alife.yaml).", maxLength: 80 },
        },
        required: ["source"],
      },
      async handler(args) {
        const source = path.resolve(String(args.source));
        const name = String(args.name || "alife.yaml");
        if (!/^[A-Za-z0-9._-]+\.yaml$/.test(name)) throw new Error(`unsafe target name: ${name}`);
        const text = fs.readFileSync(source, "utf8");
        if (!/^presets:/m.test(text) || !/^tabSetup:/m.test(text)) {
          throw new Error("refusing: the file does not look like an exported overview profile (presets/tabSetup missing)");
        }
        fs.mkdirSync(overviewDir, { recursive: true });
        const target = path.join(overviewDir, name);
        fs.copyFileSync(source, target);
        return `installed ${Buffer.byteLength(text, "utf8")} bytes -> ${target}\nimport in client: Overview > ... > Settings > Misc > Import`;
      },
    },
    {
      name: "client_launch",
      description: "Start the EVE client (Play.bat) when it is not already running. Requires confirm: true.",
      mutating: true,
      inputSchema: {
        type: "object",
        properties: {
          confirm: { type: "boolean", description: "Must be true." },
          bat: { type: "string", description: "Launcher path (.bat or exefile.exe). Omit to auto-detect.", maxLength: 400 },
        },
        required: ["confirm"],
      },
      async handler(args) {
        if (args.confirm !== true) return "refused: pass confirm: true to launch the client";
        const pid = clientRunning();
        if (pid) return `client already running (pid ${pid})`;
        const launcher = resolveLauncher(args.bat);
        if (!launcher) {
          return [
            "launcher not found. Looked at:",
            ...launcherCandidates(args.bat).map((entry) => `  ${entry}`),
            "pass a launcher path, or set EVEJS_CLIENT_LAUNCHER",
          ].join("\n");
        }
        // EVE must start with the tq directory as cwd; Play.bat did the same.
        const cwd = /[\\/]bin64[\\/]exefile\.exe$/i.test(launcher)
          ? path.dirname(path.dirname(launcher))
          : path.dirname(launcher);
        const result = /\.(bat|cmd)$/i.test(launcher)
          ? exec(["cmd", "/c", "start", "", launcher], { timeoutMs: 20000, cwd })
          : exec(["cmd", "/c", "start", "", launcher], { timeoutMs: 20000, cwd });
        return [
          `launch requested: ${launcher}`,
          `cwd: ${cwd}`,
          `exit: ${result.code}`,
          "the client window belongs to the user; check with client_status",
        ].join("\n");
      },
    },
  ];

  function overviewFiles() {
    let names = [];
    try {
      names = fs.readdirSync(overviewDir).filter((name) => name.endsWith(".yaml"));
    } catch {
      return [];
    }
    return names.map((name) => {
      const stat = statOrNull(path.join(overviewDir, name));
      return { name, size: stat ? stat.size : 0 };
    });
  }

  return { tools, settingsDir, settingsDirs, docsEve, overviewDir, clientRunning, resolveLauncher, launcherCandidates };
}

module.exports = { createClientTools, decode };
