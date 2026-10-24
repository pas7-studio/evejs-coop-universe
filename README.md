# EveJS Co-op Universe

**Status: planning / reproducible localhost baseline, not a working multiplayer fork.**

A community-oriented **two-player cooperative world** concept built *around* [EveJS](https://github.com/gameboys84/EveJS), with an optional future integration of [X-Eve Living Universe](https://github.com/kaiwren986/evejs-living-universe). Our goal is one authoritative game world for two friends, populated by persistent NPC pilots, corporations and an evolving economy.

> Independent, unofficial project. Not affiliated with CCP Games, EveJS or X-Eve maintainers. **Do not distribute game clients, modified client binaries, proprietary assets, certificates, private configuration or databases.** The EVE client terms and upstream licensing need review/permission before client modification, remote multiplayer deployment or redistribution. An open-source server license does **not** authorize use of CCP's client.

## What this repository contains

**Documentation and development tasks only, for now.** No server, patches or VPN-enabled EVE build have been implemented or tested here. Do not mistake this repository for a ready-to-play download.

- [Setup on Windows 11](docs/SETUP_WINDOWS.md) – verified upstream commands, prerequisites, smoke tests, blockers.
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

Start with [FIRST_RUN.md](docs/FIRST_RUN.md). The repository now includes a [read-only prerequisite check](scripts/Preflight.ps1), a [non-destructive upstream clone helper](scripts/Fetch-Upstream.ps1), [agent instructions](AGENTS.md), and a [verification template](docs/TEST_REPORT_TEMPLATE.md). Scripts are newly authored and **have not been executed on your machine**; upstream Docker and client compatibility remain to be confirmed.
