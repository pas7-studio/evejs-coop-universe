# PF-100C — Durable original Player / NPC handoff readback

**2026-11-07 · PR #350 Draft · Personal Fleet OFF · no original engine installation**

PF100B commits the player's replacement capsule title, the ORIGINAL
physical ship-in-space row, and PF58's consumed one-shot handoff record
in one original `GameStore` SQLite transaction. A COMMIT acknowledgment
can nevertheless become uncertain after durable disk write, and a crash
can occur before any live client session or NPC actor is reconciled.

PF100C's `native/coopPersonalFleetOriginalDurableHandoffReadback.cjs`
addresses **only durable evidence collection**, not side effects.

## How it verifies

It requests one read-only `coopAtomicNativeRows.transact` scoped to
`corporationRuntime`, `characters` and `items`:

- Cross-checks original PF54 `ISSUING`, PF58 `CONSUMED` permit and
  ship-level one-shot key, including operation, assignment, original
  hull, owner, pilot, generation, equipment hashes and source PF54
  SHA256 identity.
- Requires the exact physical original stock hull in space with its
  original itemID; **never** creates or imports a new hull.
- Requires the original existing type-670 capsule to remain in the
  hangar, correctly owned and actively selected by the owner's
  individual SQLite character row.
- Verifies the complete original character rowset: canonical keys,
  no contradictory ship aliases, no player still occupying the NPC
  hull and no other character occupying the capsule.
- If every durable read is internally consistent, returns
  `DURABLE_PLAYER_RELEASE_AND_HULL_TRANSFER_CONFIRMED` but explicitly
  sets **`maySpawn:false`**, **`mayPublish:false`**, and
  **`mayRetryAutomatically:false`**.
- If any evidence is missing, conflicting, unreadable or poisoned,
  returns `UNVERIFIED` and **never** grants actor, session or retry
  permission. Completely absent operation returns
  `NO_MATCHING_DURABLE_OPERATION` (also not a retry permit).

The source imports PF58's own original stock-space validator and
PF100B's replacement validator rather than creating parallel
definitions of stock hull semantics. It does not access network
services, mutate rows, install game hooks, or send notifications.
The operator must run it only inside a trusted original server context.

## Testing actually executed

Node 22.16.0, **18/18 PASS** against real isolated `node:sqlite`
`BEGIN IMMEDIATE` and `COMMIT`, with controlled PF58 validator
adapters. Cases cover valid durable result, zero rows, absent/tampered
PF58 permit, mismatched lock, drifted source PF54, wrong player title,
hull/capsule wrong location or ownership, duplicate character claims,
contradictory aliases, malformed character row, wrong capsule name,
poisoned GameStore and ambiguous commit. The fixture exposes a
`put` method which throws if invoked by the inspector; there were
**zero inspector-owned writes**.

This does **not** prove real original EveJS GameStore cache
reconciliation, actual PF58/PF54 runtime implementation, Node SIGKILL
or full WORK gameplay. Original Windows runner is also not executed
in this remote environment. Exact published Git blobs match the
source and test code used locally.

```powershell
.\scripts\pf100\Test-PF100-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

PF100 runner is already invoked from the existing manual PF58 and
PF80 original WORK preflight. No GitHub Actions workflow was added.

## Not a source-owned effect reconciler

PF100C deliberately **does not** do any of the following:
restart an interrupted PF58 `execute`, retry NPC spawn, automatically
ack a player ship change, update a live client session, consume a
capsule, assign a controller, change the PF54 state to `ACTIVE`, or
publish chat/UI notifications.

Missing pieces before activation: authoritative original session
mutation lease and queue, durable effect/ack protocol, exact
postcommit session application and NPC one-shot adoption,
PF54 ACTIVE-state cross-check, native stock ItemStore cache integrity,
concurrent Mining/WAR/Exploration writer coverage, real SIGKILL and
two-client WORK E2E. Do **not** enable Personal Fleet, merge PR #350
or touch PLAY.

Original `pas7-studio/EveJS` write continues to be blocked by 403.
