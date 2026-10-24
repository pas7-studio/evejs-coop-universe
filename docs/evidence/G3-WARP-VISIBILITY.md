# G3: upstream movement and warp observer parity

Reviewed 2026-10-24 against [EveJS verifyMovementWarpParity.js](https://github.com/gameboys84/EveJS/blob/c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f/Code/server/scripts/verifyMovementWarpParity.js).

The upstream project already has a movement/warp regression script that:
- Builds a real EveJS scene prototype, then tests its movement/warp methods with controlled fake sessions.
- Tests warp preparation and movement command routing.
- Tests `sendSessionlessWarpStartToVisibleSessions` with *visible*, *hidden*, and *socket-destroyed* sessions; expects exactly one warp-start delivery to the eligible observer.
- Verifies that filtering inactive and ineligible observers prevents extraneous Destiny notifications.

We wired this upstream regression into `.github/workflows/docs-and-scripts.yml` after npm dependency installation.

**Evidence boundary:** These are synthetic observer tests for a real EveJS scene method, not a successful two-human co-op flight. The upstream test asserts one eligible recipient out of three, not two eligible recipients simultaneously. Code review is not proof that CI passed.

## Next acceptance assertion for G3

Construct two distinct eligible live sessions (A, B), plus out-of-range C and disconnected D, on a scene prototype; call `sendSessionlessWarpStartToVisibleSessions` with an entity visible to A and B; require exact delivery to A and B and zero to C/D; then remove A and require only B. Use upstream's working fixture and visibility gates. Record CI evidence before claiming PASS.

The game-client authorization, historical-client compatibility, baseline Living Universe patch, and VPN networking remain separate release gates.
