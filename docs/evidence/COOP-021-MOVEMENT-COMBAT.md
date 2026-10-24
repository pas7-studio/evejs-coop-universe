# COOP-020 / COOP-021 — movement and combat gates

Upstream reviewed: [gameboys84/EveJS](https://github.com/gameboys84/EveJS) at `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Now wired into CI

CI installs dependencies under `Code/server` with `npm ci --no-audit --no-fund` before running server-side tests. It then executes:

1. `verifyMovementRemovalParity.js` — object removal/observer Destiny visibility.
2. `verifyJoltsObserverParity.js` — Destiny observer sequencing.
3. `verifyOwnerDamageMovementParity.js` — owner damage vs movement/missile clock state.
4. `verifyTargetKillModuleTeardown.js` — cleanup of active module effects when targets are destroyed.
5. `tests/upstream-two-observers.test.mjs` — synthetic A/B observer notification and isolation assertions against the real EveJS scene prototype.
6. `tests/upstream-session-registry.test.mjs` — actual session registry contract tests.

## CI evidence gate

**Configured, but run result not verified.** Do not mark as PASS until a GitHub Actions execution shows success. A failed dependency install means none of the later integration tests has run; distinguish CI infrastructure failures from assertion failures.

## Next required game-level tests

- Authoritative scene populated with two distinct ships and sessions.
- Motion of A replicated to entitled B without duplicate Destiny updates.
- B's targeting/damage effects delivered only to entitled observers.
- Disconnect and reconnect A while B remains in same scene.
- Integration with an appropriately licensed and compatible client plus the Living Universe NPC worker.
- Only then examine VPN client endpoint routing and safe gateway access.

## Run locally

```powershell
$env:EVEJS_CODE_PATH='C:\Games\EveCoop\upstream-evejs\Code'
cd C:\Games\EveCoop\upstream-evejs\Code\server
npm ci
node scripts\verifyOwnerDamageMovementParity.js
node scripts\verifyTargetKillModuleTeardown.js
cd C:\Games\EveCoopProject
node --test .\tests\upstream-two-observers.test.mjs
```

No client modifications, exposed ports, or proprietary client assets are required for these server-side checks.
