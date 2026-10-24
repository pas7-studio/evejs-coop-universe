# Delivery roadmap — agent-ready tasks

Status definitions: **TODO** not started; **BLOCKED** dependency outstanding; **DONE** evidence in commit and automated/manual test linked. Nothing below is claimed implemented.

## Owner-defined current execution order (2026-10-24)

The following priority blocks are **deferred**, not cancelled:
- P0: real server + 2 compatible clients, shared fleet warp/combat/loot,
  safe reconnect without losing ships.
- P1: native NPC transit between systems and real NPC market buy/sell
  orders. Native NPC stargate approach and an opt-in same-ship transfer
  implementation are now in this branch but are **disabled and not
  live-verified**; actual NPC market orders remain deferred.

The owner has explicitly prohibited **GitHub Actions and remote CI**.
All GitHub workflow files have been removed. Keep local test scripts
available; do not reintroduce automatic remote runs.

**Current manual verification gate: physical headless NPC activity.** See
[HEADLESS_NPC_VALIDATION](HEADLESS_NPC_VALIDATION.md). Do not claim that
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
buy/sell type allowlists are empty/OFF by default. 12/12 transaction
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

## P0 — establish trustworthy baseline

### COOP-001 — reproducible upstream inventory [TODO]
Inspect a **pinned** EveJS SHA. Produce `docs/evidence/UPSTREAM_INVENTORY.md` with setup script paths, services, dependency versions, ports, license attribution, and source links. Verify every command in `SETUP_WINDOWS.md` against selected revision. **DoD:** commands verified, unknowns clearly marked, no copied proprietary artifacts.

### COOP-002 — local-only backend bootstrap [BLOCKED: lawful compatible build for gameplay]
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

### COOP-021 — Living Universe behavioral audit [BLOCKED: COOP-003]
Verify pilots, persistence, observed NPC ships, combat, mining, freight, real inventory/market stock, faction effects. **DoD:** assertions based on actual persistent world effects, not UI-only counts.

### COOP-022 — NPC fleet/corp co-op design [BLOCKED: COOP-020, COOP-021]
Design long-term NPC goals, player hires/contracts, fleet roles and tactical participation, resource conservation, visible player consequences and controlled LLM dialogue. **DoD:** gameplay RFC, event/state contracts, simulations, performance budget; no fake chat-based NPCs.

## Execution rules for coding agents

- Read README, ARCHITECTURE, SETUP_WINDOWS and UPSTREAM first.
- Work in smallest independent PRs with a hypothesis and reversible change.
- No claims of feature readiness without test results. Do not mark tasks DONE on documentation alone.
- Do not replace locally restricted bind addresses without the explicit legal/security gates.
- Avoid leaking credentials, user data, copyrighted binaries, server DB or client copies.
- Prefer upstream PRs for generic emulator fixes; keep co-op-specific integrations isolated.
