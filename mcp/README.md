# Local MCP servers (server + client)

Two dependency-free MCP servers speak newline-delimited JSON-RPC over stdio, so
the agent can read the live co-op world and the player's own client without any
shell password-handling or guesswork.

No npm package is required: `mcp/lib/mcpServer.cjs` implements `initialize`,
`ping`, `tools/list` and `tools/call` (with argument schema checks). Tools take
injected `exec`/`fs`/`env`, so the whole surface is unit-testable without Docker
or a running EVE client.

## Start

```bash
node mcp/server-mcp.cjs     # containers, telemetry, fleet, game store
node mcp/client-mcp.cjs     # process, gamelog, chat logs, overview profile
node mcp/smoke.cjs server server_status "events --event living-hauler-loaded"
node mcp/smoke.cjs client client_status overview_tabs
```

Register in `opencode.json` (repo root) as two `local` MCP servers; the server
one needs `EVEJS_COMPOSE_DIR`, `EVEJS_SERVER_CONTAINER` and
`EVEJS_COMPOSE_PROJECT`.

## Server tools

| tool | what it proves | mutation |
| --- | --- | --- |
| `server_status` | compose containers + last telemetry event | read-only |
| `server_logs` | container log tail, optional regex | read-only |
| `events` | `coop-events.jsonl` filtered by name/system/recency | read-only |
| `alife_summary` | event counts, named blockers, actors, trades | read-only |
| `alife_timeline` | fleet-seeded → cargo-loaded → warp → delivered → trade | read-only |
| `fleet_state` | persisted pilots, roles, native links, ore | read-only |
| `economy` | per-system ore/demand, per-pilot credits and jobs | read-only |
| `world_data` | native game store collections (bounded read) | read-only |
| `container_exec` | diagnostic command inside the server container | needs `confirm: true` |
| `restart_server` | restart the `server` or `market` service | needs `confirm: true` |

## Client tools

| tool | what it proves | mutation |
| --- | --- | --- |
| `client_status` | exefile.exe pid, character settings, log freshness | read-only |
| `client_console` | newest gamelog, optional regex | read-only |
| `client_chat` | Local/corp/custom chatlog, UTF-16/UTF-8/cp1251 autodetect | read-only |
| `overview_tabs` | tab/bracket labels readable from `core_user_3.dat` | read-only |
| `overview_rename_tab` | rename a label, same byte length only, with backup | needs `confirm: true` |
| `install_profile` | stage an exported overview YAML for the client to import | needs `confirm: true` |
| `client_launch` | start `Play.bat` when the client is not running | needs `confirm: true` |

The client UI is never automated: importing an overview profile stays a human
click, and `overview_rename_tab` edits the settings file only at identical byte
length, with a `.bak` copy, and refuses while the client runs.

## Overview profile generator

`scripts/gen-alife-overview.cjs` turns a real client export into the co-op
profile. Visibility is decided by preset *group lists*, not by faction: pirate
and miner hulls are ordinary ship groups 25–31, so a preset that omits them
shows an empty sky even though the server really spawned the NPCs. The script
clones the `Common` group list into `NPC` and `Mining` presets, keeps every
other exported section byte-for-byte, and refuses to write a profile that lost a
section or a ship group.

```bash
node scripts/gen-alife-overview.cjs            # Documents/EVE/Overview/alife.yaml
```

Import in the client: Overview window → hamburger → Import → `alife.yaml`.
