# Release gate — first playable two-player session

This is a release checklist, **not** a declaration of readiness. Snapshot on 2026-10-24.

## Verified by source review

- EveJS exposes TCP handshake + ClientSession + live session registry.
- The scene implementation supports independent observer sessions and Destiny notification dispatch.
- Docker Compose host ports default to loopback-only.
- Existing upstream tests exercise movement removals, Destiny observer notifications and several combat lifecycle details.

## Automated, pending green run

Our Actions workflow pins Node.js 22 and upstream source commit `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. It clones this snapshot, installs `Code/server` dependencies, and runs registry, two-observer, movement, owner-damage and target-kill tests.

The connector's commit workflow-runs lookup only lists PR-triggered runs, so an empty response for our commits **does not establish** whether push-triggered CI ran or passed. A green run must be confirmed directly from [Actions](https://github.com/pas7-studio/evejs-coop-universe/actions).

## Blocking milestones

| Gate | Required evidence | State |
| --- | --- | --- |
| G0 Static build and tests | Link to successful Actions run | UNKNOWN |
| G1 Local backend | Healthy server, market, restart persistence logs | NOT TESTED |
| G2 Two clients | Simultaneous real authorized logins with separate accounts | NOT TESTED |
| G3 Shared grid | Two ships and synchronized movement/combat events | NOT TESTED |
| G4 Living Universe | Pinned compatible baseline, stable NPC progression | BLOCKED BY BASELINE |
| G5 Private networking | Approved transport/auth design and two-PC test | BLOCKED |
| G6 Operator runbook | Documented bootstrap, failure recovery, version locks | PARTIAL |

## Stop criteria

Do not promote a release if any of these occur: unintended public listeners; successful unauthenticated game control; cross-account character/inventory mix-up; duplicate ship on reconnect; non-idempotent disconnect with persistent world corruption; mismatched X-Eve baseline; proprietary client redistributed; licensing/permissions unresolved.

## Next real-engine test

Use an EveJS runtime scene with two player sessions and two separate ships, assert motion and combat visibility, and follow actual dependency/identity interfaces instead of fabricating an EVE client protocol. Do not silently mark a synthetic mock scenario as the completed co-op gate.
