# Client-free native NPC activity gate (manual only)

**State (2026-10-25):** a tester confirmed real headless event logging, but World is still BLOCKED. Jita 30000142 legitimately has **zero SDE asteroid belts**; Perimeter 30000144 has **three**. Validate physical mining in Perimeter, and Jita non-mining NPCs separately. No actual NPC gameplay or client view is yet verified. See [GAMEPLAY_TESTING](GAMEPLAY_TESTING.md).
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

# Existing running server: diagnose missing native events without rebuilds.
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
# Once the real event stream exists: mining test on the real Perimeter belts.
.\scripts\Local-Two-Client-Test.ps1 -Action World -WorldSystemID 30000144 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

The `World` action now invokes the report with `--require-activity`. An early
attempt can legitimately return `AWAITING_NATIVE_ACTIVITY`; observe a
real simulation interval and repeat the read-only World check **once**.
If `/var/lib/evejs/coop-events.jsonl` does not exist, classify it as
`BLOCKED_TELEMETRY` and use `DiagnoseWorld` to inspect the startup hook
and runtime environment; a missing client does **not** explain an absent
headless boot-request event.
To diagnose failures, inspect the ordinary `-Action Logs` output and the
event log inside the server container; never infer success from flags alone.

## 2026-10-25 SDE / native spawn diagnostics

`World` now defaults to **Perimeter**, where genuine asteroid belts exist.
A specifically requested Jita mining test returns
`SYSTEM_HAS_NO_NATIVE_MINING_BELTS` rather than claiming global SDE
corruption. The headless driver reports SDE vs scene belt counts in
`living-native-system-site-readiness`, and explicit resident,
candidate, existing fleet, and `spawnErrors` data in
`living-native-materialization-attempt`.
The 0 named NPC result **remains unverified** until the updated report
explains it.

Do not add artificial belts, clear `evejs-data`, reset virtual
pilot identity, or repeat npm audit to make the test pass.

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
multiplayer works. The owner reported 72 local/27 upstream PASS on project commit `cc5ce83`
(2026-10-25). Those are **backend-only** results and do not validate
subsequent feature commits or actual NPC movement.

## P0 fix: stock native mining fleet no longer consumes co-op spawn slots

`coopNpcMaterializer` previously counted **every** persistent linked native
ship against the `EVEJS_COOP_MATERIALIZE_LIMIT`, including EveJS stock
miners and haulers registered by `coopNativeIndustry`. With the default
limit 2, those two mining ships could fully occupy the budget, preventing
named pirates and patrols from spawning. This explains why valid native raid
logic could be impossible to exercise even in a scene containing a real
mining fleet.

With native mining enabled, an exemption requires **both** a matching
persisted `miner`/`hauler` role **and an entity ID appearing in the actual
live EveJS mining fleet** returned by `coopNativeIndustry`. An old or
spoofed role alone cannot free co-op capacity. Co-op-spawned pirates,
traders and patrols still count. Without native mining, the fallback
retains the original cap across all roles. The bridge remains bounded by a maximum
of 10 additional co-op ships per solar system. Regression tests cover
restart/existing stock links, fallback behavior and no duplicate spawns.

## Optional upstream destruction attacker: separate strict gate

Pinned EveJS routes native ship destruction through
`shipDestruction.destroyShipEntityWithWreck` to
`nativeNpcWreckService.destroyNativeNpcEntityWithWreck`, with an
`options` object. This may contain the actual native
`options.attackerEntity` provided by the upstream destruction caller.
It is not guaranteed to be populated on every kill.

A reversible, read-only hook **after actual wreck spawn** emits
`living-native-destruction-attacker` only for a named victim with a
physical native wreck. The `coopNpcDestructionAttacker` guard verifies:
- victim native ship matches the authoritative wreck source and system;
- actual native wreck entity is present in the scene;
- attacker was explicitly passed in `options.attackerEntity`, is a
  real native ship still present in the scene, and is persistently
  mapped to a different named NPC in that same system;
- neither attacker nor victim is a currently authenticated player's ship.

If native EveJS supplies no attacker, status is
`UPSTREAM_ATTACKER_NOT_PROVIDED` and **no identity is inferred**.
An unrelated controller target, weapon activation, or faction label
must never substitute for the missing native parameter.

Run the **separate** manual strict gate:

```powershell
node --test tests/coop-npc-materializer.test.mjs tests/coop-npc-destruction-attacker.test.mjs
.\scripts\Local-Two-Client-Test.ps1 -Action FinalBlow -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

The `FinalBlow` action requires `--require-combat --require-weapon
--require-final-attacker`: exact native destruction caller attacker,
matching native weapon event, observed HP loss, same wreck, and
nonempty persisted loot. If upstream does not supply an attacker,
the report returns `AWAITING_UPSTREAM_DESTRUCTION_ATTACKER`.
This is stronger native-source attribution than temporal correlation,
but still requires a **real Docker run** before claiming verified
NPC gameplay, and the native caller's semantics must be validated
before calling it the exact fatal weapon hit.

## Native fast-kill HP proof and resilient headless boot (current)

A physical named NPC can die between periodic 5-second HP observations,
so a valid EveJS wreck may appear without a previously reported lethal
damage sample. The native wreck hook now forwards the **original doomed
ship object** (not a simulated replacement) into the existing
`coopNativeCombatEvidence` monitor. After verifying the physical
wreck and its stored contents, the monitor may report
`NATIVE_TERMINAL_HP_DROP` only when it has a previous **same-system,
same-entity, same-named-pilot HP baseline no older than 30 seconds**.
It compares genuine final shield/armor/structure values and emits no
hit when HP did not decrease, the baseline is stale/missing or identity
differs. The native controller's previous target remains a *correlation*,
not proof of who delivered the final hit.

In this fast-kill case the runtime emits `living-native-combat-damage`
**before** `living-native-wreck-evidence`, so the existing strict
Combat/FinalBlow time-ordered report can use it without reversing events.
Strict report matching now also checks exact persistent victim identity
and, when collected, attacker **entity ID**, to avoid reusing evidence
from a different NPC after an EveJS entity ID is recycled.

Headless startup no longer gives up permanently after six unsuccessful
checks. It retries every 30 seconds at first, then continues at a
bounded **5–15 minute** cadence for unresolved systems, with quiet
periodic diagnostics. It terminates retrying for a system only after
actual scene evidence is available. With `EVEJS_COOP_NATIVE_MINING=1`,
this includes real NPC ships, belts, and live mining hulls. Without
native mining, a named physical NPC and a real static scene waypoint
are sufficient; startup no longer imports the mining service in that
mode. No GitHub-hosted CI is used.

Manual tests added to `Verify-Local-Coop.ps1` include
`tests/coop-headless-retry.test.mjs`; the native combat evidence suite
also covers mid-sample deaths, missing/stale baselines and unchanged HP.
The 41 relevant isolated JavaScript checks passed, but no live Docker
world, native weapon hit or game-client rendering has been verified.

## P1 combat enablement: native friend/foe guard and weapon witnesses

Pinned EveJS `npcBehaviorLoop.isFriendlyCombatTarget` treats almost all NPC
ships as allies, even when an NPC has an explicit attack order against
another NPC. This prevented real NPC↔NPC engagements from progressing
past target validation.

The reversible overlay now introduces `coopNpcHostility` in that exact
native target-validity branch, **only when**
`EVEJS_COOP_RIVAL_NPC_COMBAT=1`. A valid exception requires:
- two actual `nativeNpc` ship entities, both with current EveJS controllers;
- two distinct named `coop-pilot-NNN` identities physically linked to those
  ship entity IDs in the **same system**;
- different factions from the persisted current virtual-world roster;
- a native `manualOrder.type=attack` against that exact target, **or** an
  actual recorded native `lastAggressorID` with timestamp.

Without every condition, EveJS keeps its standard friendly-NPC behavior.
Named pirate raids skip same-faction or unlinked mining targets before
issuing attack orders, preventing accidental intra-faction friendly fire.
No unrestricted NPC auto-aggro or synthetic target may be introduced.

The same reversible upstream patch now records two **genuine source-side**
events when `EVEJS_COOP_NATIVE_WEAPON_EVIDENCE=1`:
- **`missile-launch`** only after EveJS `scene.launchMissile()` returns
  `success=true` for a named NPC and target;
- **`module-activation`** only after EveJS
  `scene.activateGenericModule()` succeeds for the named NPC's real
  weapon module and target.

Both are emitted as `living-native-weapon-event` with the matched named
attacker, victim, native entity IDs, and module/charge type. Neither
an activated module nor a launched missile is evidence of a **hit**.

Combat validation is deliberately **independent of mining/hauling
readiness**: two authentic native NPC ships can fight even when no miners,
haulers or asteroid belts are present. The `World` action retains the
separate mining-economy gate.

The manual `-Action Combat` check now requires `--require-weapon`
in addition to physical HP loss, same-victim native wreck and stored
nonempty loot. It demands an exact attacker/victim identity match
between the weapon witness and the observed HP drop, then correlates
that victim's wreck. Failure reports
`AWAITING_NATIVE_WEAPON_CHAIN`. The fully verified state remains
**server-side evidence**, not proof of exact final-hit attribution,
client rendering, or physically looting the wreck.

The upstream patch was checked for syntax, idempotent installation and
byte-exact reversal against EveJS pin
`c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
The isolated permission, witness and reporting tests passed in a
JavaScript test harness. A real EveJS Docker simulation remains unverified.

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
