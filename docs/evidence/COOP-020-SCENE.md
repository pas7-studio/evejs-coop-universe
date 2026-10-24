# COOP-020: EveJS observer and scene verification

Source revision targeted by our GitHub Actions: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` from gameboys84/EveJS. Source reviewed 2026-10-24. The following are actual existing upstream regression scripts, not simulations we invented:

- [Code/server/scripts/verifyMovementRemovalParity.js](https://github.com/gameboys84/EveJS/blob/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/server/scripts/verifyMovementRemovalParity.js) constructs a mock scene containing `sessions: new Map()`, registers an observer session with `scene.sessions.set(session.clientID, session)`, and verifies `broadcastRemoveBall` queues a visibility removal and/or destruction effect.
- [Code/server/scripts/verifyJoltsObserverParity.js](https://github.com/gameboys84/EveJS/blob/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/server/scripts/verifyJoltsObserverParity.js) imports the actual scene runtime and checks observer-targeted Destiny updates.

## Current CI

The repository's `.github/workflows/docs-and-scripts.yml` runs both scripts from a pinned upstream checkout after the isolated sessionRegistry tests. This requires upstream network access and dependencies expected by that checkout. Failure must be investigated; until an actual successful Actions run is inspected, status is **not verified**.

## What the findings imply

EveJS has both a per-character session registry and a scene-local observer model. This reduces the chance we must invent a new multiplayer engine. Existing tests target notification payload parity for synthetic observers, not two actual game clients.

## Next acceptance tests (not implemented yet)

1. Create *two* distinct mock sessions in one real `ensureScene` scene, each with its own `clientID`, `characterID` and ship.
2. Assert an observable entity state change emits exactly one appropriate update to each entitled observer.
3. Assert visibility filtering: an out-of-range observer receives no restricted update.
4. Disconnect A; B remains attached and continues receiving eligible events; no duplicate cleanup.
5. Add deterministic NPC entity materialization after X-Eve integration is lawfully available and pinned, with bounded tick cost.
6. Only after server-level checks, validate authorized client gameplay and remotely connected sessions with security/legal review.

## Explicit non-claims

Passing scene parity tests is **not** proof that two players can undock or warp together, see NPCs, use fleets, chat, or join by VPN. It does not assess CCP-client licensing or remote exposure security.
