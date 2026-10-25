# Chat 15 — native NPC combat/tactics authority, 25 October 2026

**Status: CODE_READY / LIVE_UNVERIFIED.** This patch does **not** claim that two client pilots witnessed a native NPC kill or that EVE-equivalent combat is complete. It hardens the existing optional `EVEJS_COOP_NATIVE_TACTICS=1` subsystem, not the pinned EveJS combat engine.

## Baseline and existing mechanisms (do not duplicate)

- Repo baseline before editing: `pas7-studio/evejs-coop-universe@b75b360e76f89edf370ea134f977527cb9666af2`; pinned EveJS `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
- `coopNativeRaids` already issues native `npcRuntime.warpToEntity` / `issueAttackOrder` for real stock miner/hauler hulls with source-checked `coopNativeRaidEligibility`; `coopNpcHuntPolicy` and `coopNpcSquadDirector` add opt-in NPC-vs-NPC target restraint and squad observations.
- `coopNpcHostility` permits narrow linked faction enemies under native attack/retaliation; it does **not** authorize all NPC friendly-fire.
- Native `npcBehaviorLoop`, turret/missile scene cycles, `combat/damage`, and wreck/destruction remain authoritative. `coopNpcWeaponAmmoGate`, `coopNpcAmmoBankAtomic`, `coopNpcFireOutcomeWitness` and their native patch helpers already own ammunition restrictions and exactly-once attempt journals. All related transactional flag gates remain default OFF pending live verification.
- Chat 14's `coopNpcOrderBridge` guards concurrent orders when enabled. Chat 01 owns its invocation and ordering in `coopVirtualWorldRuntime.cjs`.

## Confirmed and fixed tactical safety defects

Original `coopNpcTactics.cjs` treated an assignment with just a positive `entityID`, a `kind:'ship'` object and any `lastAggressorID` as sufficient for NPC reinforcement. It could issue a native command for a player-controlled/fake/recycled ship or stale controller. A successful retreat warp *command* plus 10 seconds could trigger `stopOrder` and later `resumeBehavior` without ever seeing a physical arrival.

The existing module now:

1. Requires one unambiguous named pilot -> exact native ship, matching solar system, native controller, real `itemID`, no player session controlling the hull, and finite physical position. Duplicate pilot/entity claims are rejected rather than first-wins.
2. Requires the victim controller's exact `entityID` and `systemID`, a recent non-future native `lastAggressorID` and a physically present exact NPC or session-verified human aggressor. Same-faction linked attacker cannot trigger reinforcements.
3. Checks rescuer controller ID/system, ongoing warp, current target and manual order before accepting reinforcement. A previous rescue tracks **object identity** of helper, victim and attacker, and cannot attack a different ship reusing the same ID after warp-in.
4. Allows retreat from a physically proven player attack, but no new **NPC-on-player reinforcement attack** without an injected `authorizePlayerDefense` callback returning `true` for the current native identities. Default callback always returns false. Chat 01 must source any approval from native Crimewatch/aggression rights and authenticated client/session state; never set a universal true callback.
5. Maintains retreat in an unresolved state after native warp ACK until the *same real ship* is actually observed out of warp within 100 km of the recorded native station/gate point, having started farther than 150 km. Without that proof, no automatic standdown/recovery is reported and no speculative re-warp is issued. Scramble/ongoing warp still block a new retreat.
6. Returns bounded primitive-only tactics snapshots; live native ship references are retained privately only for the active in-process order. No new scheduler, spawning, module cycle, damage, loot, insurance, ammo debit or reward is added.

Native `issueAttackOrder({allowWeapons:true})` success is **order accepted**, not proof of launched missile, real turret hit, HP reduction, killmail, wreck creation or a client render. This patch intentionally retains the historical event names to avoid changing central telemetry consumers; interpret them strictly as native command ACKs.

## Manual/local verification

```bash
node --check integration/coopNpcTactics.cjs
node --test tests/coop-npc-tactics.test.mjs tests/coop-npc-tactics-native-authority.test.mjs
```

Executed locally under Node 22.16.0 with source-isolated fixtures: **16 PASS, 0 FAIL** (six existing tactical regressions adapted to strict native evidence, 10 additional negative/authority cases). Tests cover identity spoof, duplicate assignments, wrong controller/system, stale/future aggression, busy/warping rescuers, PvP default-deny vs explicitly authorized native session, missing warp arrival, reused target entity ID and friendly-fire. These are **not** live EveJS/Docker/client tests.

## Chat 01 integration handoff (central files NOT edited)

- The current world runtime already constructs `createTactics` and feeds native `scene`, `assignments`, `controllers`, `health`, `isScrambled`, `waypoints`. No new hook is necessary for NPC-vs-NPC tactical safety.
- To allow real NPC patrol assistance against an **aggressing player**, pass an `authorizePlayerDefense({systemID,scene,victim,helper,attacker,session})` callback. It must check the original EveJS native aggression/Crimewatch outcome, current exact session ownership, player aggression permissions, system security, NPC faction standing and no invulnerability, **on every attempted order**. If no reliable native legality API is available, leave it default-deny. Existing pinned NPC autopilot retaliation remains a separate upstream behavior.
- Order arbiter priority still needs Chat 01 to run survival/tackle/ammo checks before raid/patrol, then issue at most one new compatible native command per ship per decision epoch. Chat 15 does not edit `integration/coopVirtualWorldRuntime.cjs`, `scripts/patch-evejs-coop.cjs`, bootstrap or deployment flags.
- Native player damage, NPC damage and terminal kill outcomes should be corroborated with **matching physical scene entity IDs, native successful weapon cycles, actual HP reduction, exact native ammo debit and final stored wreck/loot**. Existing `coopNativeCombatEvidence` is only sampling/correlation, and `coopNpcFireOutcomeWitness` does not atomically settle scene damage.
- Physically verify pirate vs stock convoy, hostile named NPC vs named patrol, player vs NPC, legitimate NPC retaliation against an aggressing player, scramble preventing escape, reinforcement warp arrival and actual post-fight wreck, with two independent authorized clients; check reconnect/restart and resource conservation. No live environment or proprietary client was available here.

**Remaining blockers:** approved disposable EveJS deployment with pinned source, real server SQLite + POSIX ammo journal, current World/FinalBlow evidence, and two-client tests. No persistent data, live game process, proprietary client, GitHub Actions or central hooks changed.