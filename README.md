# EveJS Co-op Universe

**Status: substantial pinned EveJS integration code exists, but two-client gameplay and friend-PC access remain unverified.**

A community-oriented **two-player cooperative world** concept built *around* [EveJS](https://github.com/gameboys84/EveJS), with an optional future integration of [X-Eve Living Universe](https://github.com/kaiwren986/evejs-living-universe). Our goal is one authoritative game world for two friends, populated by persistent NPC pilots, corporations and an evolving economy.

> Independent, unofficial project. Not affiliated with CCP Games, EveJS or X-Eve maintainers. **Do not distribute game clients, modified client binaries, proprietary assets, certificates, private configuration or databases.** The EVE client terms and upstream licensing need review/permission before client modification, remote multiplayer deployment or redistribution. An open-source server license does **not** authorize use of CCP's client.

## How to verify the actual game (not just Docker)

**Cloud session with no access to this PC? Read [`state/NOW.md`](state/NOW.md)
first** (plus [docs/AGENT_START_HERE.md](docs/AGENT_START_HERE.md)): it is the
generated, redacted snapshot of the last local test run, overlay state, gate
status and next action. Refresh it locally with
`.\scripts\Publish-SessionState.ps1`.

**Start with [Gameplay acceptance and agent instructions](docs/GAMEPLAY_TESTING.md).**
The companion [gameplay report template](docs/GAMEPLAY_TEST_REPORT_TEMPLATE.md)
separates genuine NPC and client observations from unit tests and TCP sockets.

The first 2026-10-25 backend run at `cc5ce83` passed **72 local / 27 upstream
contracts**. A later live run at `a087167` verified **headless event logging**
and healthy server/market but still found **0 named NPCs and no proved
physical activity**. The `World` gate mistakenly selected **Jita 30000142**,
which legitimately has zero asteroid belts. Mineable scenes are now
checked explicitly in **Perimeter 30000144**, which has real belts.
This still does **not** prove NPC or two-player gameplay. For a running deployed overlay:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Local-Two-Client-Test.ps1 -Action World -WorldSystemID 30000144 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

`DiagnoseWorld` is read-only and checks the running container's flags,
installed overlay files, log path and startup diagnostics. `World` is
a **server-native scene/activity check**; no client is needed for the
initial `living-headless-boot-requested` event. After that, actual
rendering, targeting and two-player gameplay require a compatible,
independently authorized EVE client and human confirmation.

**Do not rerun npm audit for gameplay validation**. Seven previously
reported dependency advisories are a separate security-remediation
track; the game remains loopback-only. No GitHub Actions/remote CI.

Named NPC restart safety is documented in
[NATIVE_NPC_DURABILITY.md](docs/NATIVE_NPC_DURABILITY.md).
The new durable-hull implementation is still **unverified in a live
restart**; do not substitute saved identity files for real native
ship continuity.

## What this repository contains

**Executable, optional server-side integration overlay and Windows runbooks.** This repo contains NPC/world modules, reversible source hooks, deployment scripts, and read-only live two-pilot evidence tools. It does **not** include a proprietary EVE client, a standalone complete game server, or a verified VPN gateway. Do not mistake a committed integration for proven end-to-end gameplay.

- [Setup on Windows 11](docs/SETUP_WINDOWS.md) – verified upstream commands, prerequisites, smoke tests, blockers.
- [Development doctrine](docs/DEVELOPMENT_DOCTRINE.md) – **binding**: how the overlay may touch the pinned server, upgrade runbook for a new upstream SHA, anti-footgun list.
- [Architecture and private co-op design](docs/ARCHITECTURE.md) – host/client topology, VPN, networking discovery, security, failure cases.
- [Delivery roadmap and agent tasks](docs/ROADMAP.md) – prioritized, independently testable engineering work.
- [Upstreams, compatibility and contribution policy](docs/UPSTREAM.md).

## Concept

- **One host:** authoritative game logic, world persistence, economy and NPC simulation.
- **Two human clients:** independent accounts in the *same* world, no second authoritative game server.
- **VPN transport:** WireGuard/Tailscale for private connectivity, **not** public port forwarding. Actual remote-client compatibility has *not* been implemented or established.
- **Living universe:** virtual NPCs outside observed scenes, physical NPCs where players can interact; real persistent consequences.
- **Community-first:** upstream-friendly patches, issue reports and tests. Avoid undocumented binary modifications and vendoring third-party assets.

## Compatibility snapshot (2026-10-24)

| Item | Known state |
| --- | --- |
| [gameboys84/EveJS](https://github.com/gameboys84/EveJS) | EVE 24.01 build **3396210** target; upstream README specifies **localhost-only** and Docker setup |
| [X-Eve Living Universe](https://github.com/kaiwren986/evejs-living-universe) | Patch v0.2.2 targets **one exact EveJS v0.12.3.1 archive**, SHA-256 below |
| Windows 11 / Docker Desktop | Recommended **localhost baseline**, subject to compatible legal client availability |
| Two PCs through VPN | **NOT SUPPORTED / NOT VERIFIED** in current upstream |
| NPC economy and AI | Documented by patch author; **not verified by this project** |

Expected v0.12.3.1 archive hash per X-Eve authors:

```text
1DEB61A51F808D9F2B330214DA64EC297D9EE5F96EE4B8265692A65F35EEFC1E
```

**Important:** `gameboys84/EveJS` main is *not* automatically the v0.12.3.1 archive accepted by the X-Eve installer. Never force a patch into a mismatched tree.

## Play together in a living universe (experimental)

The default [game-night setup](docs/PLAY_COOP_NOW.md) runs one native
EveJS server with **autonomous named miners, haulers, traders, patrols and
pirates**. Explore and fight ships that already belong to the world:
**no player-triggered PvE arena, no automatic waves**. NPCs have
persistent identities, physical movement, real native combat and wrecks,
and a recorded recovery delay after their ship is destroyed.

For an **existing deployed universe**, follow the single [gameplay acceptance sequence](docs/GAMEPLAY_TESTING.md) above. Do not redeploy as the first test. After World PASS, confirm one authorized client manually, then two clients.

The first-time upstream database preparation is documented separately.
The live simulation now **reuses EveJS's actual NPC mining fleets**,
mineable asteroid depletion, native ore cargo, mining haulers and
aggression-response AI. Named pirates may attack existing ore-bearing
NPC ships, creating unscripted fights that players can join. Hauler ore
moves through the native NPC cargo store and becomes real EveJS wreck
loot on destruction. The game-night overlay now also records player
attacks and verified pirate-defense kills in **EveJS's actual standings
system**, changing the size of mining-fleet security responses.
**Independent NPC-owned player-market orders remain unverified.** The optional seed-market transaction adapter is disabled by default and has only isolated tests; see [Native NPC Market](docs/NATIVE_NPC_MARKET.md).

[Two-PC authenticated loopback tunnel](docs/FRIEND_PC_PRIVATE_TUNNEL.md)
is experimental. Neither real two-client game rendering nor friend-PC
TLS/login has been live-verified.

## First milestone

1. Run the base game services **locally only** according to [SETUP_WINDOWS](docs/SETUP_WINDOWS.md).
2. Record reproducible smoke tests and failures, including the client/build provenance and actual feature support.
3. Obtain a **lawfully usable** compatible baseline and relevant permissions; assess X-Eve patch compatibility.
4. Audit listeners, advertised endpoints, TLS, session management, and input trust boundaries.
5. Only with necessary permissions and security review, prototype a **VPN-only, default-off** co-op gateway with two-user tests.

## Explicit non-goals

Public Internet hosting, bypassing upstream authentication, bypassing CCP licensing/DRM, redistributing CCP content, promising full parity with EVE Online, or replacing EVE with a proprietary fork without tracking licenses.

## Licensing and contributions

No third-party source has been copied into this repository. Keep each upstream's license and attribution when/if importing lawfully; EveJS states AGPL-3.0-only, while X-Eve licenses original contributions separately. Before importing a patch, review provenance and compatibility. Contributions should be small, reproducible, tested, and submitted upstream when appropriate.

See [UPSTREAM](docs/UPSTREAM.md) for references and caveats.

## Deployment entrypoint (Windows 11)

Use [FIRST_RUN.md](docs/FIRST_RUN.md) **only for a fresh installation**. For the existing, already-deployed world use [GAMEPLAY_TESTING.md](docs/GAMEPLAY_TESTING.md) and preserve the upstream working tree, local test adapters and persistent volumes. Never repeat one-time initialization to diagnose missing NPC events.

## One-PC server + two-client test for agents

See [TWO_CLIENTS_ONE_PC.md](docs/TWO_CLIENTS_ONE_PC.md) for copy-paste Windows commands to prepare one Docker server, start two client launchers, inspect health, collect logs and stop safely. Actual two-client gameplay is **not yet validated**.

## Agent backend gate (no proprietary client required)

Run the optional [backend verifier](docs/VERIFY_BACKEND_ONE_COMMAND.md) on a new installation or when backend changes require regression checking. The 2026-10-25 backend evidence is already recorded for its tested revision. Do not rerun it as a substitute for gameplay: a backend PASS is not an NPC or two-player PASS.
