# Chat 19 + 21 — Advanced PvE and A-Life site defense

**Status:** stage 1 code prepared; no native player-vs-NPC gameplay proof. All changes opt-in, default OFF. No new native spawn, currency, loot or client protocol.

## Native authorities and prior components

- `dungeonUniverseRuntime`, `dungeonUniverseSiteService`, dungeon instance/tracking and site spawn policies own authored anomaly encounters, objectives, rotation, and waves. Avoid a second site allocator or clock.
- `coopFleetMissionJoin`, `coopMissionInstanceProvenance`, `coopFleetDungeonCredit`, and existing native agent mission settlement own two independent mission identities and objective sharing; presence alone never earns money.
- `coopNpcTactics` and the one A-Life tick own existing physical NPC retreat and reinforcement orders. The world order arbiter retains its native lease and unknown-outcome fences.
- Native `GameStore`, `nativeNpcStore`, itemStore, original wreck records, and native wallet/LP/standing writers exclusively own physical loot and rewards.

## Stage 1 — player-triggered NPC self-defense (this PR)

Existing `coopNpcTactics` had an `authorizePlayerDefense` callback but `coopVirtualWorldRuntime` never supplied one, leaving player-triggered reinforcement forbidden by default. This PR wires it using `coopNativeConsequences.resolveVerifiedPlayerID` (native global session/account/ship admission) and the new pure `coopPveRetaliationGuard`.

With `EVEJS_COOP_NATIVE_TACTICS=1` **and** `EVEJS_COOP_PVE_NPC_RETALIATION=1`, the existing tactics loop may call in **already present allied NPC ships** only after a server-owned live controller records a matching native player's aggression within 120 seconds, the same physical ships remain on the scene, the attacker is still authentically logged in, and the aggressor is within 250 km of the victim. Same-faction role checks, NPC ammo gates, cooldowns, actual native attack/warp ACKs, and the existing retreat logic remain in force. A stale session, mismatched victim, expired event, absent responder, ambiguous ownership, or no native attack is denied. There are no invented waves or player-targeting patrols.

**Known limitation:** this is retaliation for named physical A-Life ships, not yet authenticated ownership of a static pirate base. The next stage must bind those ships to original site IDs before a site can direct reinforcements.

## Next stages and acceptance

| Stage | Implementation target | Must be evidenced before DONE |
| --- | --- | --- |
| P0-2 authored sites | Join native anomaly/dungeon `instanceID`, `siteID`, `systemID` and actual materialized pirate defenders; react to real player damage on the same site | Two real players find and enter an authored anomaly; no phantom sites or cross-instance NPC aid |
| P0-3 wave defense | Reuse native dungeon encounter plans for finite waves and deterministic spawn caps; A-Life chooses support posture from local supply and threat; no competing scheduler | Native wave spawned, damaged and destroyed; no extra ships after restart or re-entry |
| P0-4 boss and retreat | Boss is an original authoritative native NPC hull with actual modules, HP, fuel/ammo, behavior changes and a real wreck; fallback to retreat when scrambled/low hull | Orders, actual damage, physical warp/standdown, no scripted kill |
| P0-5 co-op objective and payout | Two separate native character mission receipts with genuine site completion, optional verified combat contribution, one-at-most settlement and original itemStore source/destination custody | Both clients independently see only lawful rewards; reconnect and crash replay never mint duplicates |
| P1 escalation | Enable only when pinned native escalating-path builder returns real authored stages; never fabricate the currently empty rowset | Durable native stage chain, objective and reward with no repeated claim |
| P1 balancing | Different pirate site doctrine, scouts, guard rotations, logistics and aggression memory through existing A-Life | NPC reactions differ by supplies, site danger and observed player actions |

## Manual gates

1. Local Node: `node --test tests/coop-pve-retaliation-guard.test.mjs tests/coop-npc-tactics.test.mjs`; then full overlay dry-run/roundtrip only against an untouched pinned test checkout.
2. Disposable world: start with new flag OFF, verify no player retaliation; flag ON, have authenticated character A damage a real named NPC and observe only pre-existing same-faction ally responding. Character B does not become a target merely by being in the same fleet.
3. Force stale aggressor timestamp, duplicate session, hull swap, disconnect, friendly fire, unavailable ammo, warp scramble, no safe retreat point and a 250-km displacement. Deny new attacks without proven original aggression.
4. Observe successful order **and** native weapon/HP outcome independently. Check retreat arrival and first-party client rendering. This module's six isolated tests are *not* native gameplay evidence.
5. No CI, remote deployment, `main` merge or live-world flag change as part of this PR. Preserve `evejs-data`.
