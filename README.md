# EveJS Co-op Universe

**A private, 2++-player "living universe" on top of [EveJS](https://github.com/gameboys84/EveJS):
one authoritative server, autonomous NPC pilots that really mine, haul, trade, fight
and die, and persistent consequences two or more players can join in on.**

> Independent, unofficial project. Not affiliated with CCP Games, EveJS or the
> X-Eve maintainers. No game client, client binary, proprietary asset, certificate,
> database or credential is distributed here, and none may be redistributed.
> An open-source server license does **not** license CCP's client — client
> modification, remote play and redistribution each need their own legal review.

## Where this comes from

- **Base engine — our fork:** [pas7-studio/EveJS](https://github.com/pas7-studio/EveJS),
  branch `coop/pas7std`, forked from [gameboys84/EveJS](https://github.com/gameboys84/EveJS)
  at `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` (EVE 24.01 build **3396210**).
  We continue that engine ourselves — it is no longer a pristine upstream plus a
  replay overlay — and build it as the local `evejs-local` Docker image. See that
  repo's `FORK.md`; everything stays localhost-only.
- **Idea source:** [X-Eve Living Universe](https://github.com/kaiwren986/evejs-living-universe)
  (patch v0.2.2 against EveJS v0.12.3.1). Its "virtual NPCs outside the scene,
  physical NPCs inside it" model is the concept this repo grew from — **it is not
  vendored**, and `EveJS main` is not the archive that patch expects.
- **Everything else in this repo is ours:** tests, orchestration, compose
  overrides, evidence and doctrine — plus 10 atomic patches kept only as
  proposals for the original author, 6 Rust bridges, ~645 test files and 224
  scripts.

## What is proven, and what is not

| Area | State |
| --- | --- |
| Overlay installs on the pin (`OVERLAY_OK`), 10 L1 patches apply/reverse cleanly | **Verified locally** |
| Local overlay + isolated upstream contract suite | **Green at the recorded revisions** (`state/NOW.md` snapshot: 542 pass / 0 fail); re-run for the current tree |
| Headless boot, native spawn, mining cycle, native haul, station delivery | **Observed live on the agent work stack** |
| First sale → treasury sweep → paid refinery → mineral/ore sale chain | **In progress** — mining, haul and station delivery are live; the sale/treasury/refinery half is not yet green |
| Named NPC persistence across a restart | Durable records exist; live restart QA still open |
| NPC-owned player-market orders, gate/system transfer of a named NPC | Implemented, **flag-gated OFF**, unverified live |
| Faction warfare campaign, structures as objectives | Real records, campaign still stuck in `PREPARING` (fleet presence) |
| **Visible client gameplay, at least two independent accounts, shared grid** | **NOT VERIFIED** — needs a compatible, lawfully obtained EVE client and a human |

A green backend, a TCP socket check or a unit test is never gameplay evidence.
The only accepted sequence is [docs/GAMEPLAY_TESTING.md](docs/GAMEPLAY_TESTING.md)
with its [report template](docs/GAMEPLAY_TEST_REPORT_TEMPLATE.md).

**Player count:** the design targets a small group of **2 or more** players. Nothing in
the overlay hard-codes two — "two clients" is only the *minimum* acceptance bar, because
that is the smallest number that can prove a shared world.

## How to run

### Two stacks: play and work (read [docs/TWO_STACKS_PLAY_AND_WORK.md](docs/TWO_STACKS_PLAY_AND_WORK.md) first)

| | PLAY (owner + one friend) | WORK (agents, proofs) |
| --- | --- | --- |
| Compose project | `evejs` | `evejs-agents` |
| Ports (loopback) | `443/5222/26000-26002/40110` | `28443/25222/28000-28002/41110` |
| Volumes | `evejs-data`, `evejs-images` | `evejs-agents-*` |
| Access | SSH tunnel for the friend | local only |
| Pacing | real | x5 (`EVEJS_COOP_TIME_SCALE=5`) |

**Never deploy, rebuild, recreate, restart, `down` or merge into `evejs` unless the
owner explicitly asks for a restart window.** Prove everything on `evejs-agents`.

```powershell
cd R:\GitRepository\pas7std\evejs-coop-universe

.\scripts\Start-Agents-Stack.ps1 -Action Status   # read-only health
.\scripts\Start-Agents-Stack.ps1 -Action Seed     # ONCE per fresh volume (market rebuild)
.\scripts\Start-Agents-Stack.ps1 -Action Up       # start the work world
.\scripts\Start-Agents-Stack.ps1 -Action Down
```

### Build, gate, deploy, accept (all local, no CI)

```sh
# repo-side + structural + disposable GameStore gates -> LOOP_GATE_PASS
scripts/coop-loop-gate.sh --code-path 'C:\Games\EveCoop\upstream-evejs\Code'

# overlay check (must print OVERLAY_OK) / install into the pinned checkout
node scripts/coop-deploy.cjs --checkout 'C:\Games\EveCoop\upstream-evejs\Code' --check
node scripts/coop-deploy.cjs --checkout 'C:\Games\EveCoop\upstream-evejs\Code' --build

# mining -> haul -> station -> sale, plus a restart proof -> LOOP_PASS
scripts/restart-acceptance.sh --wait-load-min 20 --after-restart 240
```

Local regression suite (equivalent of the removed CI):

```powershell
.\scripts\Verify-Local-Coop.ps1
```

First installation only: [docs/FIRST_RUN.md](docs/FIRST_RUN.md). For an existing
world use the read-only `-Action DiagnoseWorld` / `-Action World` probes described in
[docs/PLAY_COOP_NOW.md](docs/PLAY_COOP_NOW.md) instead of redeploying.

## What the co-op overlay adds

All server-side, opt-in via env flags ([docs/coop-flags.json](docs/coop-flags.json)),
default OFF unless the runbook says otherwise.

- **Living NPC fleet:** named, durable, physically present miners, haulers, traders,
  patrols and pirates with persistent identity, memory, chatter and real weapon cycles.
- **Closed economy loop:** native mining → partial/full haul → station delivery →
  sale → corporation treasury → paid refinery → mineral sale, every step atomic and
  restart-safe, with an exact refusal reason for every blocked step.
- **NPC combat with receipts:** native hostility between physically linked rival
  factions, wrecks, stored loot, kills credited only on real weapon + HP evidence.
- **PvE for 2++ players:** native raids and sites, duo mission
  instances, boss loot custody, escort contracts with real warp, attendance,
  rescue and settlement fences.
- **Market depth:** NPC buyers/sellers, player↔player fills, escrow, refunds, taxes,
  cancellation, partial fills and crash recovery through native GameStore + Rust.
- **War and territory:** faction warfare fronts, campaigns, muster/fleet reserves,
  engagement warp, structure objectives, sovereignty projection, merit and bounties.
- **Player-side systems:** industry and manufacturing, structures, wormholes/Pochven,
  salvage, clones, skills, standings/LP, PI, fittings, exploration/scanning, EWAR,
  crime/CONCORD consequences.
- **Operator and agent surfaces:** in-process admin bridge, read-only MCP servers for
  the running compose project and the local EVE client, `coop-events.jsonl` telemetry
  with an explicit `status`/`reason` on every runtime decision.

## What is ours (inventory)

| Path | Contents |
| --- | --- |
| `integration/*.cjs` | L2 co-op modules, one owner per record, env-gated |
| `patches/upstream/0001..0010` | L1 atomic stock fixes, pinned by `sha256`, reversible via `scripts/apply-upstream-patches.cjs` |
| `rust/*.rs` | native GameStore/wallet settlement helpers |
| `scripts/` | deploy, check, audit, acceptance, state publishing (224 files) |
| `tests/` | overlay + contract suites (645 files, `node --test`) |
| `mcp/` | server + client MCP tools used for read-only live evidence |
| `docs/` | doctrine, runbooks, per-feature contracts and the `WORKLOG` |
| `state/` | generated, redacted `NOW.md` + digests + ledger for cloud sessions |
| `qa/` | acceptance matrices, defect handoffs, operator evidence templates |

**Layer rule** (binding, [docs/UPSTREAM_PATCH_SERIES.md](docs/UPSTREAM_PATCH_SERIES.md)):
a stock bug becomes an `L1` patch, a co-op rule becomes an `L2` overlay module plus one
hook line, a new stateful mechanism becomes an `L3` runtime. Never a second patching
mechanism, never a hand-edited world to make an acceptance pass, and every commit gets
a `scripts/log-change.cjs` entry in [docs/WORKLOG.md](docs/WORKLOG.md).

Consequences of that rule: the pinned EveJS tree keeps its stock behaviour unless an
`L2` flag is switched on, every `L1` patch can be reversed and is pinned by `sha256`,
and no feature here exists only as an undocumented string edit inside a checkout.

## Documentation map

- [docs/AGENT_START_HERE.md](docs/AGENT_START_HERE.md) + [state/NOW.md](state/NOW.md) — current state, last run, next action
- [docs/DEVELOPMENT_DOCTRINE.md](docs/DEVELOPMENT_DOCTRINE.md) — binding overlay rules
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — topology, boundaries, failure cases
- [docs/COOP_LOOP_ACCEPTANCE.md](docs/COOP_LOOP_ACCEPTANCE.md) — the mining→sale gates
- [docs/ROADMAP.md](docs/ROADMAP.md) — prioritised work with task IDs
- [docs/GAMEPLAY_TESTING.md](docs/GAMEPLAY_TESTING.md) — how to prove actual gameplay
- [docs/RELEASE_GATES.md](docs/RELEASE_GATES.md) — what must be true before "playable"
- [docs/UPSTREAM.md](docs/UPSTREAM.md) — upstreams, compatibility, contribution policy
- [docs/PUBLIC_ENDPOINT_PROTONVPN.md](docs/PUBLIC_ENDPOINT_PROTONVPN.md) — remote player:
  ProtonVPN port carries SSH, host/friend bring-up, symptom→fix table
- [docs/MARKET_SEED_ECONOMY_DESIGN.md](docs/MARKET_SEED_ECONOMY_DESIGN.md) — market seed audit,
  invariants, faction sectors, executed reseed

## Rules of this repository

- **No CI, no remote automation.** Every gate is a local script with recorded evidence.
- **No fabricated PASS.** Missing telemetry is `BLOCKED_TELEMETRY`, a missing client is
  `BLOCKED_CLIENT_UNAVAILABLE`; never substitute a unit test or a health check.
- **No npm audit / dependency-upgrade runs** as gameplay validation; the seven known
  advisories are a separate security track and all services stay loopback-only.
- **No public hosting**, no auth/DRM bypass, no CCP asset redistribution, no VPN gateway
  promised as working.

## Licensing and contributions

No third-party source is copied into this repository. EveJS upstream is AGPL-3.0-only;
X-Eve licenses its own contributions separately. Keep attribution when importing
anything, review provenance first, and send small, tested, reproducible changes
upstream when they are genuine upstream fixes.
