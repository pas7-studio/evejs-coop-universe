# Delivery roadmap — agent-ready tasks
> **2026-10-25 native-mechanics discovery / parallel-agent checkpoint:**
> [24-mechanic upstream-to-co-op gap audit](EVEJS_NATIVE_MECHANICS_COOP_GAP_AUDIT_20261025.md)
> [First implementation: native item/courier contracts + LP Store standing gates](COOP_NATIVE_CONTRACTS_LP_STORE_V1.md), source-tested and pending real two-client/escrow replay acceptance.
> [Native exploration + shared bookmarks / wormhole two-player acceptance](COOP_EXPLORATION_NATIVE_GAP_20261025.md) — source audit, live unverified; coordinate any beyonce changes with fleet-warp owner.
> and [current P0 progress, blockers and agent ownership handoff](COOP_PARALLEL_AGENT_HANDOFF_20261025.md).
> These are source-level findings and acceptance requirements, **not** claims
> of completed two-client gameplay. The duplicate mission-helper call was tested as idempotent against pinned source; consolidate it and still run full overlay preflight before deployment.


> **2026-10-25: Coop Economy + Progression V1 proposal** — the authoritative
> step-by-step implementation specification for native fleet, item/ship gifts,
> per-player shared mission credit, actual ore-to-blueprint industry, market
> liquidity, NPC mining/crafting, faction reputation, native Alpha/Omega
> subscriptions and 6x skill training is in
> [COOP_ECONOMY_PROGRESSION_V1.md](COOP_ECONOMY_PROGRESSION_V1.md).
> Proposal only: full multiplayer/industry/economy gates remain UNVERIFIED.
> Do not enable in-progress shared dungeon hooks or deploy to real worlds.


Status definitions: **TODO** not started; **BLOCKED** dependency outstanding; **IMPLEMENTED_UNVERIFIED** code exists but live evidence is missing; **DONE** actual acceptance evidence recorded. The gameplay test order is in GAMEPLAY_TESTING.md.

## Owner-defined execution order and current gameplay blocker (2026-10-25)

The owner has prioritized **actual local gameplay acceptance now**. Headless
native NPCs must be evidenced before client-dependent tests. The later
P0 two-client stage still requires compatible authorized clients:
- P0: real server + 2 compatible clients, shared fleet warp/combat/loot,
  safe reconnect without losing ships.
- P1: native NPC transit between systems and real NPC market buy/sell
  orders. Native NPC stargate approach and an opt-in same-ship transfer
  implementation are now in this branch but are **disabled and not
  live-verified**; actual NPC market orders remain deferred.

The owner has explicitly prohibited **GitHub Actions and remote CI**.
All GitHub workflow files have been removed. Keep local test scripts
available; do not reintroduce automatic remote runs.

**P0 no-NPC recovery addition:** A real SDE-backed scene is scheduled
for later materialization retries even if its initial native spawn
produced zero identity links. Added system-specific native mining
startup policy witness to headless event and World report so disabled
or excluded Perimeter fleet seeding is distinguished from absent SDE
belts. This does not force a fleet, alter world data or reset named
pilot identity. 64/64 relevant isolated regression tests PASS.
**Physical named NPCs and client gameplay remain unverified.**

**P0 implementation follow-up (awaiting local client test):** repaired
real NPC name broadcasts in `coopNpcPresentation` to the existing
EveJS slim-item API, with retry on failure and no repeat on success.
Materializer now reports saturated native spawn capacity, caught
upstream spawn exceptions, identity registry write failures and
same-ship recovery without duplicates. Headless scene count and
stock fleet bindings reject player/static objects; new boot-attempt
witness distinguishes a scheduled timer from completed native scene
attempts. **53/53 isolated presentation/materialization/report/headless
tests PASS; this is not an in-game NPC appearance proof.**
The next gate remains a fresh `World -WorldSystemID 30000144`
and then visual NPC confirmation in a real authorized client.

**2026-10-25 tested blocker update:** Headless event stream and boot
request are confirmed live at tester revision `a087167`. The reported
`World` failure selected Jita 30000142, which legitimately has no
asteroid belts. Mining must be tested on Perimeter 30000144 (three SDE
belts). This feature branch now distinguishes system-specific real SDE
zero-belt status, accepts real named non-miners in beltless systems,
and emits precise materializer spawn failures. **No real named NPC,
mining ore growth, moving fleet or client gameplay has yet passed.**
Use `World -WorldSystemID 30000144` on the updated overlay. Do not
repeat npm audit or previous backend checks to replace this result.

**Current manual verification gate: headless telemetry is confirmed;
verify Perimeter physical NPC mining/activity and named entity links.** Start with
[GAMEPLAY_TESTING](GAMEPLAY_TESTING.md), **not** backend regressions,
network source audits or npm scans. The owner's 2026-10-25 report on
`cc5ce83` established 72 local / 27 upstream backend checks and healthy
containers, but `/var/lib/evejs/coop-events.jsonl` is missing.
Run `-Action DiagnoseWorld` **read-only** before `-Action World`.
See [HEADLESS_NPC_VALIDATION](HEADLESS_NPC_VALIDATION.md). Do not claim that
a healthy server or existing NPC object is a moving/interactive NPC.
Require real native coordinate changes plus cargo growth or a controller
target. This branch adds the sampler and strict local World report, but
no live Docker-native activity has been verified yet.

**Native NPC trading with real EveJS seeded market (P1, guarded):**
Physical named traders and haulers can sell existing native cargo to actual
`source="seed"` buy orders via market daemon `FillOrder` and buy seeded
station stock via `AdjustSeedStock` using only previously earned NPC ISK.
Transactions revalidate physical station proximity, source inventory,
real ship cargo capacity, exact price and remote acknowledgements. The
same native ship's cargo cache and durable store are synchronized before
ledger settlement. Per-pilot transaction journals prevent automatic
double-fills after uncertain RPC responses. Both the market flag and
buy/sell type allowlists are empty/OFF by default. 13/13 transaction
and 24/24 report assertions passed in isolation. **This is NOT a
personal NPC-owned market order/escrow implementation, and no real
Docker/client market trade has been confirmed.**
See [NATIVE_NPC_MARKET](NATIVE_NPC_MARKET.md).

**New physical NPC stargate transition implementation (P1, gated):**
Named traders and patrols can use real reciprocal EveJS stargate pairs and
native warp orders. A separately opt-in native transfer preserves the same
entity ID, controller, HP, fitted modules and cargo in the target system
with a per-pilot recovery journal, compensating rollback and durable
identity relocation only after real arrival. Recovery precedes identity
pruning on startup. 9/9 gate-navigation, 10/10 transfer and 4/4 identity
isolated checks passed. **Both feature flags remain OFF; there is no
real Docker or client proof of stargate travel.** See
[NATIVE_NPC_GATE_TRAVEL](NATIVE_NPC_GATE_TRAVEL.md).

**Headless reliability and fast-kill evidence:** incomplete native worlds
continue boot attempts after the initial six, using bounded 5–15 minute
backoff. Worlds without native mining no longer import that service
at bootstrap. The physical NPC capacity exemption is now tied to
live EveJS fleet entity IDs, not a potentially stale role string.
A real native death between HP sample intervals can contribute an
observed terminal shield/armor/hull decrease from EveJS's original
ship entity, but only against a fresh prior physical sample.
The strict combat report rejects mismatched named pilot/entity IDs
and requires time-ordered HP and wreck evidence. These changes have
41/41 isolated JS checks and pinned overlay round-trip validation,
**not** a live Docker game-client test.

**Stock NPC materialization blocker addressed:** native EveJS miners and
haulers previously exhausted the co-op NPC limit (default two), leaving
zero free slots for pirates. Corrected capacity accounting and tested
native-mining versus fallback cases. Implemented optional native
destruction-source attribution: the distinct `FinalBlow` local
gate cannot pass without an explicitly provided EveJS destruction
attacker matched to real weapon/HP/wreck/loot evidence. Whether EveJS
supplies that parameter on real kills is **not yet tested in Docker**.

**Native NPC combat blocker addressed in code:** the pinned engine's generic
NPC-vs-NPC friendly-target check is now bypassed **only** for actual linked
opposing-faction native ships with valid attack or fresh retaliation intent.
Real successful native weapon activation/missile launch telemetry must match
observed native HP loss and a physical loot-bearing wreck for the strict local
Combat gate. This is still **not** actual Docker/playable-client confirmation
or exact final-blow attribution. See `docs/HEADLESS_NPC_VALIDATION.md`.

The native NPC fight/retreat/reinforcement slice has code and tests, but
still requires live server/client verification. The active reviewable
work is **P1 personal NPC memory** and the **P2 factual faction chronicle**.
See [NPC memory and faction chronicle](NPC_MEMORY_AND_FACTION_CHRONICLE.md)
for exact code scope, independent tests, proof requirements and remaining
work. Neither the P0 gate nor complete persistent faction warfare is
claimed done by these code changes.

**Co-op P0 native fleet warp hardening (code now in feature branch):**
Added an opt-in guard to pinned EveJS `BeyonceService._warpFleetFollowers`
that accepts only actual scene-ready physical peer ships in the same
solar system and retains upstream commander hierarchy and opt-out.
The party report distinguishes real native follower warp orders from
verified arrivals. 10/10 guard + 3/3 report isolated tests passed,
reversible source patch checked. **Two real clients have not yet
verified shared warp or arrival.** See
[COOP_FLEET_WARP](COOP_FLEET_WARP.md).

**Durable native NPC identity slice — IMPLEMENTED_UNVERIFIED.**
The original co-op named spawn used transient EveJS store rows, so
`coop-npc-links.json` survived restart but the native entity/controller
did not. Added opt-in durable native named hulls on explicit LivingCoop
deployment, mixed transient/durable ID collision protection and
pre-prune same-ID materialization from persisted EveJS entity/controller.
Incomplete or conflicting persistent records fail closed. A genuine
same-pilot wreck from after ship linkage permits clone recovery;
stale wrecks do not. Unit tests and pinned-source patch checks pass,
**but the real Docker restart and in-client NPC continuity remain
unverified**. See [NATIVE_NPC_DURABILITY](NATIVE_NPC_DURABILITY.md).
Next operator gate: approved local overlay deployment, real World
physical NPC evidence, controlled stop/restart retaining `evejs-data`,
same-ID restoration, then visible NPC proof. No CI or remote deployment.

## P0 — establish trustworthy baseline

### COOP-001 — reproducible upstream inventory [TODO]
Inspect a **pinned** EveJS SHA. Produce `docs/evidence/UPSTREAM_INVENTORY.md` with setup script paths, services, dependency versions, ports, license attribution, and source links. Verify every command in `SETUP_WINDOWS.md` against selected revision. **DoD:** commands verified, unknowns clearly marked, no copied proprietary artifacts.

### COOP-002 — local-only backend bootstrap [PARTIAL: healthy services verified on cc5ce83; restart persistence not yet evidenced]
Reproduce Docker game and market health on Windows/Linux containers; capture `compose ps` and sanitized logs. Optional gameplay validation only where client permissions permit. **DoD:** init 0, services healthy, restart persistence verified, detailed failure troubleshooting.

### COOP-003 — X-Eve compatibility gate [BLOCKED: exact approved baseline]
Confirm v0.12.3.1 archive matches X-Eve documented SHA-256; cleanly install v0.2.2 on a throwaway tree; run installer and verifier. Document rollback and independent smoke tests. **DoD:** reproducible verification, no mutation of unrelated EveJS main, no client redistribution.

### COOP-004 — legal / license assessment [TODO]
Review CCP EULA and licenses, write what is and isn't authorized, contact relevant maintainers for baseline provenance and request any needed permissions. **DoD:** documented permission boundaries; if permission absent, remote EVE-client co-op tasks remain blocked and alternative independently licensed client considered.

## P1 — network and multiplayer architecture

### COOP-010 — networking source audit [TODO]
Produce file:line call graph for all TCP/HTTP(S)/XMPP listeners, advertised endpoints, session/login paths and embedded `127.0.0.1` values. **DoD:** port matrix grounded in code, config injection points, two-client concurrency risks and tests; no network exposure.

### COOP-011 — private-VPN transport laboratory [TODO]
Demonstrate two-device mesh VPN + disposable **non-game** echo TCP endpoint. Document peer allowlist, host firewall rules, latency, relay/fallback, deny tests. **DoD:** two devices connect; unauthorized peers blocked; no EveJS ports published.

### COOP-012 — configurable listeners and endpoint advertisement [BLOCKED: COOP-004, COOP-010]
Implement default-off, interface-scoped network settings; no wildcard bind; ensure protocol-level advertised addresses and TLS identities correct. **DoD:** localhost regression tests, refusal to bind non-VPN/public interface, negative security tests.

### COOP-013 — independent sessions and shared world [BLOCKED: COOP-004, COOP-010, COOP-012]
Test simultaneous accounts and characters, cross-player scene updates, reconnects, state isolation. Fix singleton/session bugs discovered in audit. **DoD:** 2-player integration suite and session isolation test evidence.

### COOP-014 — co-op gateway security hardening [BLOCKED: COOP-004, COOP-012]
Enforce trusted peer/device policies and explicit game-service allowlist, safe TLS, auth, rate limits, secure logs. Keep admin/market health and DB bound to localhost. **DoD:** negative unauthorized tests, LAN/public refusal, no regressions.

## P2 — real gameplay and NPC depth

### COOP-020 — two-player gameplay matrix [BLOCKED: COOP-013]
Tests: join, Local/Overview, undock, warp, dock, fleet, chat, PvE, trade, disconnect/reconnect, restart. **DoD:** per-feature PASS/FAIL supported by logs/replays, blockers converted into focused tasks.

### COOP-021 — Living Universe behavioral audit [BLOCKED_PHYSICAL_WORLD; headless telemetry PASS on a087167]
Verify pilots, persistence, observed NPC ships, combat, mining, freight, real inventory/market stock, faction effects. **DoD:** assertions based on actual persistent world effects, not UI-only counts.

### COOP-022 — NPC fleet/corp co-op design [BLOCKED: COOP-020, COOP-021]
Design long-term NPC goals, player hires/contracts, fleet roles and tactical participation, resource conservation, visible player consequences and controlled LLM dialogue. **DoD:** gameplay RFC, event/state contracts, simulations, performance budget; no fake chat-based NPCs.

### COOP-023 — overlay engineering doctrine and upgrade safety [PARTIAL: doctrine + read-only drift check landed 2026-10-25; first real upstream SHA upgrade not yet rehearsed]
Write the binding rules for how the overlay may modify the pinned EveJS server, and make them enforceable. Delivered: [DEVELOPMENT_DOCTRINE](DEVELOPMENT_DOCTRINE.md), `patch-evejs-coop.cjs --check` (read-only `PRISTINE/PATCHED/DRIFTED/ANCHOR_MISMATCH` + module `CURRENT/STALE/MISSING`), the pinned-revision register in [UPSTREAM](UPSTREAM.md), and `tests/coop-overlay-drift-check.test.mjs`. Cross-session visibility: `state/NOW.md` + `state/status.json` + `state/ledger.json` + `state/digests/*` are generated by `scripts/coop-state.cjs` and `scripts/Publish-SessionState.ps1` (redacted, ≤40 lines / 4 KB for `NOW.md`), auto-published after server start/stop, `CoopStart`, client launches, `World` and deploy, and available as `-Action Publish`; `node scripts/coop-state.cjs --verify` reports `STATE_STALE`/budget/leak problems. Enforcement wiring: `--check` runs as a post-install gate in `Deploy-Coop-RuntimeProbe.ps1`, is printed by `Diagnose-LivingWorld.ps1`, and `Verify-Local-Coop.ps1` now discovers `tests/*.test.mjs` instead of a hand-written list. Regression noise is explicit via `scripts/coop-test-baseline.cjs` + `docs/evidence/test-baseline.json` (79 files, 525 pass, 0 fail, 16 skipped on 2026-10-25). The check also found and fixed a real defect: the player-damage helper used LF-only anchors and could never patch a CRLF Windows checkout. **DoD:** a rehearsal upgrade to a second upstream SHA completes with `OVERLAY_OK` and a recorded re-anchor evidence file. Remaining debt is listed in doctrine section 10 (inline one-liners violating one-call hooks, per-SHA anchor archive, `--check` inside the built image).

## Execution rules for coding agents

- For **testing gameplay**, read `GAMEPLAY_TESTING.md` first. Use README/ARCHITECTURE/SETUP_WINDOWS/UPSTREAM only if a concrete step requires them; do not substitute one-time setup, networking audits, npm audit or security scans for live NPC verification.
- Work in small reversible code changes only when a documented gameplay blocker requires one. Do not create unnecessary PRs/CI or modify the local upstream test fixtures to make routine gameplay testing pass.
- No claims of feature readiness without test results. Do not mark tasks DONE on documentation alone.
- Do not replace locally restricted bind addresses without the explicit legal/security gates.
- Avoid leaking credentials, user data, copyrighted binaries, server DB or client copies.
- Prefer upstream PRs for generic emulator fixes; keep co-op-specific integrations isolated.
