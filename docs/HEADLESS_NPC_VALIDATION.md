# Client-free native NPC activity gate (manual only)

**State:** implementation in the feature branch; **not yet validated** against a
live pinned EveJS Docker container. It is not proof of playable EVE-client combat.
GitHub Actions / remote CI are explicitly prohibited by the repository owner.

## Purpose

The previous verification reported Docker healthy, real native NPC flags enabled,
and two TCP connections, but produced no `coop-events.jsonl` without an EVE
client login. These facts are useful transport checks, not living-world evidence.

LivingCoop now requests headless native scene initialization for the two configured
systems; it emits `living-headless-boot-requested` immediately and per-system
`living-headless-boot-system` results. A missing belt, physical mining ship or
linked named NPC remains **PENDING**, never fabricated. A system containing an
actual linked native NPC may still run its patrol/piracy/civilian activity if
the separate mining readiness gate is incomplete.

Once native identity links are ready, `coopNativeActivity` inspects authoritative
EveJS scene entities and controllers **without changing any ship state**. Each
sample uses one process-local previous position/cargo snapshot, and measures:

- **`observedMovement`**: named NPC ships physically moved at least 100 m
  between distinct samples, comparing actual native entity coordinates.
- **`oreGrowth`**: authenticated named-NPC cargo (module 0, real type ID)
  increased in the EveJS inventory store since a previous native sample.
  This can include transfer, and **does not alone prove laser mining**.
- **`engagedNativeNpcs`**: an actual named NPC controller has a current
  target whose entity exists in the authoritative scene. This is
  target selection, **not evidence of damage, hits, or a kill**.
- **`physicalNpcShips`**: actual linked ship entities that exist; verified
  player session ship IDs are excluded, even if a stale NPC link exists.

The sampler emits `living-native-activity` evidence for changes (and
infrequent quiet heartbeats). It never spawns ships, writes cargo, fabricates
positions, changes standings or issues a combat order.

## Manual Windows run sequence

Only on a compatible, explicitly authorized **local** EveJS setup. Make backups
of the game data and the co-op state before deploying new overlay code.
Do not expose server/database ports to LAN or Internet.

```powershell
# In the checked-out feature branch of evejs-coop-universe:
node --test tests/coop-native-activity.test.mjs tests/coop-world-report.test.mjs
node --check integration/coopNativeActivity.cjs
node --check integration/coopVirtualWorldRuntime.cjs
node --check scripts/coop-world-report.cjs

# Use your actual pinned EveJS Code directory:
.\scripts\Local-Two-Client-Test.ps1 -Action CoopStart -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Local-Two-Client-Test.ps1 -Action World -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

The `World` action now invokes the report with `--require-activity`. An early
attempt can legitimately return `AWAITING_NATIVE_ACTIVITY`; repeat the
read-only World check after the native simulation has processed more ticks.
To diagnose failures, inspect the ordinary `-Action Logs` output and the
event log inside the server container; never infer success from flags alone.

## Acceptance matrix

| Observation | Legitimate interpretation |
| --- | --- |
| `living-headless-boot-requested` only | Scheduled, **not initialized** |
| `PENDING_NATIVE_SCENE` | Some required native scene entities missing |
| `NATIVE_SCENE_READY` | Physical scene/belts/mining ships/named NPCs exist |
| `NO_PHYSICAL_ACTIVITY_EVIDENCE` | No observed motion or native interaction |
| `PARTIAL_NATIVE_ACTIVITY` | Motion **or** cargo/target, not both |
| `MOVEMENT_AND_INTERACTION_OBSERVED` | Physical motion and cargo growth or controller target measured |
| `READY_FOR_CLIENT_PLAYTEST` with `--require-activity` | Server-side activity gate passed, **not client gameplay** |
| `AWAITING_NATIVE_ACTIVITY` | Scene exists; activity gate not proven |
| Docker healthy and TCP PASS | Transport-only evidence, **not NPC gameplay** |

The strict World gate requires physical NPCs, stock mining/mining belts,
real named NPC links and **both** observed motion **and** a real cargo growth
or controller-target event within the evidence window. Statuses never claim
native damage, fleet cooperation, wreck loot, two-client rendering or remote
multiplayer works. The original 67 local/27 upstream PASS report predates
this branch; do not reuse those counts as validation for this change.

## Native NPC-to-NPC damage, wreck and loot verification (new P1 slice)

Read-only combat health sampling runs every 5 seconds by default (bounded to 2–15 seconds via `EVEJS_COOP_NATIVE_COMBAT_SAMPLE_MS`), independently of the 30-second virtual economy loop. This reduces missed short-lived fights without issuing gameplay orders.

This version observes **actual EveJS health layers** through
`getEntityMaxHealthLayers` and `getEntityCurrentHealthLayers`.
The read-only `coopNativeCombatEvidence` monitor compares separate snapshots
of a **named native NPC ship** and records a positive HP reduction. It notes
which other named NPCs currently have that victim as their native controller
target, but **a target lock does not establish the killer's identity**.

The native EveJS wreck callback is also checked against both:
- the native NPC wreck record (same `wreckID`, source native ship and system)
  and a real `nativeNpcWreck` entity in the EveJS scene;
- `nativeNpcStore.listNativeWreckItemsForWreck`, with genuine item IDs,
  type IDs, positive quantities and matching wreck owner references.

A verified wreck may be **empty**. This is a genuine native wreck but is
not called a loot drop. If the store or physical wreck disagrees, the NPC
loss/economy callback now fails closed and reports the discrepancy.

Events:
- `living-native-combat-damage` — a measured HP loss of a named NPC,
  with *possible* native NPC target correlation and no fabricated damage;
- `living-native-wreck-evidence` — physical wreck and stored loot validation,
  or an explicit failing status.

Run manually only:

```powershell
node --test tests/coop-native-combat-evidence.test.mjs tests/coop-world-report.test.mjs
node --check integration/coopNativeCombatEvidence.cjs
.\scripts\Local-Two-Client-Test.ps1 -Action Combat -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

The `Combat` command uses `--require-combat`. It requires an NPC victim
with a real HP drop, another named NPC's native target correlation, a
matching source ship in a **physical verified native wreck**, and
**nonempty native persisted items** in the same observation window.
Possible statuses include `AWAITING_NPC_COMBAT_LOOT`,
`DAMAGE_ONLY`, `WRECK_ONLY`, `CORRELATED_DAMAGE_WITH_EMPTY_WRECK`,
and `CORRELATED_DAMAGE_WRECK_AND_LOOT`. A fully correlated result is
strong server-side evidence, but it still does **not** identify the specific
weapon or ship that delivered the fatal hit. Authoritative attacker-ID
instrumentation would be necessary to prove exact killer attribution.

**Not verified in live Docker.** The new isolated combat-evidence module
tests pass locally. End-to-end pinned EveJS runtime, player client rendering,
loot pickup, NPC tactical weapon operation and real multiplayer remain
unverified. No GitHub Actions / CI were installed or used.

## Recoverability of NPC simulation phases

The 30-second LivingCoop scheduler now isolates native travel, economy,
depot sync, patrol routing, piracy, tactics, local recognition, civilian
orders, physical activity sampling and reconciliation. Optional subsystem
errors are reported through `living-world-phase-failed` and do not stop
the remaining phases. Native mining/depot errors during scene observation
likewise cannot prevent named NPC materialization. A partially corrupt
persistent state file is not silently reset; inspect logs and restore
from an authorized backup instead of deleting volumes.

## Known limitations / next gate

- A client-free native-controller target does not prove weapon hits. Add
  actual native damage-layer deltas tied to combat attribution when verified.
- Some NPCs may legitimately remain idle: absence of observed motion is
  evidence not collected, not permission to create scripted fake movement.
- The exact pinned EveJS startup hooks and physical NPC behavior must be
  checked in a real running container. **No live runtime execution was done
  from this conversation's environment.**
- EVE client compatibility, licensing, two-user fleet warp, shared combat,
  loot, and disconnect/reconnect remain separately deferred.
- Network exposure remains prohibited pending the previously reported
  npm vulnerability review and original upstream/local-only constraints.
