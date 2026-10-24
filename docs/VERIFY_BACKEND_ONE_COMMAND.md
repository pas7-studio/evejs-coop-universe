# One-command server verification for agents (Windows 11)

This is the client-free **backend gate** for one EveJS server and two simultaneous TCP sessions. It does not pretend to authenticate two EVE accounts or run NPC gameplay. No proprietary client is necessary. Read the exact PASS/FAIL report rather than assuming success because the scripts launched.

## Prerequisites

Docker Desktop in Linux-container mode, Git, Node.js 22+, PowerShell 5.1+, an existing `C:\Games\EveCoop\upstream-evejs\Code` checkout, and the local project checked out to `C:\Games\EveCoopProject`. Do not mix the X-Eve patch with main; these are separate compatibility baselines.

## Agent command (from the project repo)

```powershell
cd C:\Games\EveCoopProject
git pull

# First deployment: once, if the market/bootstrap has not been prepared.
.\scripts\Local-Two-Client-Test.ps1 -Action Prepare

# Backend gate: boot, validate safety, real TCP sockets, regression tests, collect evidence.
.\scripts\Verify-Local-Coop.ps1 -StartBackend -HealthTimeoutSeconds 360
```

For the **real EveJS scene/registry** test suite, first install the upstream server dependencies (once, or after lockfile changes):

```powershell
cd C:\Games\EveCoop\upstream-evejs\Code\server
npm ci
cd C:\Games\EveCoopProject
.\scripts\Verify-Local-Coop.ps1 -IncludeUpstreamTests -HealthTimeoutSeconds 360
```

Run with both switches to start and test in one command:

```powershell
.\scripts\Verify-Local-Coop.ps1 -StartBackend -IncludeUpstreamTests
```

## Evidence and interpretation

Each run writes `test-results/verify-YYYYMMDD-HHMMSS/` containing `report.json`, `revisions.txt`, TCP/scene test logs, Compose safety results, Docker state and backend logs. Exit 0 = all selected checks passed. Nonzero = one or more failed/blocked.

**What counts as success:** loopback-only Compose ports, backend health, two concurrent accepted raw TCP sockets, and optional synthetic server-side EveJS scene tests. **What is NOT verified:** EVE protocol handshake, two actual authorized accounts, shared movement, weapons, NPCs, or the proprietary client. Those gates must remain blocked until actual clients are tested.

If unsuccessful, agents should paste the redacted `report.json` and the failing step's log, not rerun market rebuild or delete Docker volumes. Never publish unredacted logs.

## Shared-space integrity diagnostics

The backend gate now includes `tests/coop-scene-audit.test.mjs` (deterministic read-only auditor regression suite) and, with `-IncludeUpstreamTests`, `tests/upstream-coop-scene-audit.test.mjs` against an actual EveJS `SolarSystemScene` plus the real session registry.

The reusable `scripts/coop-scene-audit.mjs` exports `auditCoopScene(scene, {minimumPilots, registryLookup})`. Supply the current scene and optionally the authoritative `registry.findSessionByCharacterID`. The JSON-safe output reports PASS/FAIL, live pilots and ship IDs, reciprocal visibility, stale sessions, duplicate identities or ships, missing ship entities, and registry mismatch. Visibility asymmetry is a warning rather than a hard failure because bubble visibility can transition asynchronously. The audit performs no scene mutations.

**Acceptance boundary:** this is an in-process snapshot of server state; it is not a simulation tick, network login, movement physics or client compatibility proof. Upstream integration tests require the pinned EveJS checkout and its dependencies.

## Fail-closed compatibility and dependency gates

The verifier **requires the tested EveJS commit** `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` by default. An unexpected upstream revision is a hard failure, not an unlabelled PASS. For an intentional exploratory run only, supply `-AllowUnpinnedUpstream`, which emits a visible WARNING; never use its report to certify the pinned baseline.

Node.js 22+ and `-HealthTimeoutSeconds` in the range 15–900 are mandatory. If the standalone regression tests fail, the backend test gate is BLOCKED instead of running a misleading real-port probe. If `-IncludeUpstreamTests` is requested and `Code/server/node_modules` is absent, the report marks that stage BLOCKED rather than silently skipping it.

The upstream code revision and project revision are captured in `revisions.txt`; copy only redacted `report.json` and relevant failing logs back to the agent. The actual TCP check is strictly a transport smoke test and the synthetic in-process checks are not proof that two real EVE accounts can log in.

## Actual EveJS reconnect path (verified from pinned source)

Do **not** wire `scripts/coop-reconnect-guard.mjs` into the live login path. That module is a standalone model/contract fixture and does not persist a character or account state. The actual upstream already implements takeover/disconnect:
- `Code/server/src/services/character/charService.js`: `evictPriorSession()` invokes the canonical disconnect then unregisters and destroys the displaced session's socket.
- `Code/server/src/network/tcp/index.js`: both socket `close` and `error` invoke disconnect and unregister.
- `Code/server/src/services/_shared/sessionDisconnect.js`: `persistCharacterLogoffState()` records ship state (including emergency warp rules), `spaceRuntime.detachSession()` removes the observer, and chat/trade/presence are cleaned up.

These assertions are in `tests/upstream-live-reconnect-contract.test.mjs`, run by CI and `Verify-Local-Coop.ps1 -IncludeUpstreamTests`. They are **static source-contract checks**, not execution of disconnect against a real database. Do not claim persistence PASS until the server E2E test demonstrates restored ship state for a reconnected account.
