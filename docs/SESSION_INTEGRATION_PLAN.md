# COOP-013 — session integration plan, source-first

**State:** design only. Do not count standalone `lab/` results as evidence of EveJS multiplayer.

## Objective

Prove two independent game identities can occupy the same authoritative solar-system simulation, exchange state and NPC observations, and reconnect without corrupting world or account state.

## Inventory before implementation

For a pinned EveJS SHA, collect file:line locations and call path for:

1. Game TCP entrypoint and session accept / close handlers.
2. Authentication, account ownership, character selection, multiple clients from one host, duplicate-login policy.
3. Character/system/grid ownership and event subscription/removal.
4. Broadcast/interest management and any global singleton player/client assumptions.
5. Chat/XMPP identity binding, logout and reconnect cleanup.
6. Persistent inventory, damage, wallet and shared market mutations.
7. Optional X-Eve materialization pipeline: visible NPC events and tick budgets.

Write findings to `docs/evidence/COOP-013.md` and include exact upstream commit. No claim of session support until actual integration tests pass.

## Proposed test seams

Use dependency injection around sockets and storage to test **server-side** gameplay sessions with mock transports. Keep test command independent of proprietary client files. Test:

- A/B logins create unique session and character IDs; duplicate login follows an explicit policy.
- A/B enter same solar system; world emits identical authoritative entity events to both.
- A moves/undocks; B receives the relevant event exactly once; duplicate/replayed commands do not duplicate state changes.
- Disconnect A: B stays online; A's subscriptions and pending actions are cleaned up.
- Reconnect A: no duplicated ships, inventory transactions or NPC tick workers.
- Malformed command and unauthorized account action rejected with no data leakage.
- Under X-Eve: deterministic, seedable NPC presence and economy effects survive restart; tests cover both observer and off-grid behavior.

## Integration boundaries

Existing `lab/co-op-session-lab.mjs` only establishes a reusable idea for *two distinct TCP streams*. Do not graft its trivial JSON framing/auth onto EveJS's existing protocol. Real game framing, login and security must remain owned by the game's established pipeline.

## Remote/VPN implementation gate

Upstream targets 127.0.0.1, and launcher currently checks this. Do not change client binaries or expose game ports without permission and a security review. VPN transport alone is not a substitute for authentication, protocol-aware endpoint advertisement, TLS validation, or per-session isolation.

## Definition of done

Actual EveJS code changes + reproducible server-side integration tests + references to passing CI + documented remaining client-side limitations. A README-only change does **not** close COOP-013.
