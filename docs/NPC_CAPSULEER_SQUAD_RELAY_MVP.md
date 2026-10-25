# COOP-024D — Native NPC squad scouting and coordinated convoy raids (2026-10-25)

**Status:** CODE IMPLEMENTED, ISOLATED TESTED, NATIVE GAMEPLAY UNVERIFIED. This is an opt-in increment following [personal-goals PR #39](https://github.com/pas7-studio/evejs-coop-universe/pull/39). The broader [NPC capsuleer agency design](https://github.com/pas7-studio/evejs-coop-universe/pull/29) is the long-term specification.

## Actual visible gameplay intended

Two or three **existing** named physical pirate NPCs in the same real solar system and faction can divide a convoy opportunity into a scout and one or two strike pilots. The scout must have a live native NPC ship within 180 km of a genuine stock EveJS mining-fleet hull. A squad report requires a **15-second real elapsed relay delay**; contact freshness is 60 seconds. The strike pilots may then order a real native warp/attack using the existing `coopNativeRaids` machinery, subject to every prior legal/physical/risk check. The scout **never issues a squad attack**. No new ship spawns, scripted damage, forced warp, fake ISK or invented loot.

The same target is reserved for the group; group members cannot silently switch to unrelated prey. Real native faction/source authorization applies **to each shooter/target pair before any group target is selected**. If the reporter leaves the prey grid, the report becomes unusable and the group retains a short caution lease; it cannot immediately fall back to an unrestricted attack. Solo pirates retain their previous native gate/raid behavior.

If a player with a genuine active session and a real ship is *visible on the scout's physical grid near the prey*, the existing `coopNpcHuntPolicy` includes that contact as an additional defensive risk and may decline the raid. **The player is never a squad target.**

## Source modifications

- `integration/coopNpcSquadDirector.cjs` (new): memory-bounded per-system/faction squad assignment. Reads only native scene ship IDs and positions, genuine stock mining-fleet candidate IDs, named linked pirate ships and saved faction identities; demands true native `isAuthorizedStockMiningRaid` authorization for each strike pilot. Physical valid grid observation, 15s relay, 60s TTL, max 2 wing attackers, one target per faction/system. Process-local: no claimed durable engagement or transfer.
- `integration/coopNpcHuntPolicy.cjs` (extended): accepts optional verified report *only* when sender and recipient are distinct, uniquely linked same-faction native NPC pirates; report belongs to same system/prey/role and is both aged and delayed correctly; reporter still physically present in sensing range. Counts physically nearby escorts and actual authenticated player contact as risk, never as prey. Prior local-only sighting behavior is unchanged when report absent.
- `integration/coopVirtualWorldRuntime.cjs` (extended): instantiates one squad coordinator under explicit opt-in; scores only ore-positive native fleet candidates (native ore stock is a **technical permission prefilter**, NOT an NPC cargo scan or knowledge leak). Calls native stock raid policy before and inside squad planning. Passes only approved report into existing raid risk assessment, then existing `coopNativeRaids.tick()` issues native warp or attack via `coopNpcOrderArbiter`. Bounded periodic `living-npc-scout-relay` probe contains IDs and ready time, never player/private cargo or target position.
- `scripts/patch-evejs-coop.cjs`: adds one new reversible overlay module, no new L1 native hooks.
- `tests/coop-npc-squad-scout-relay.test.mjs`: 14 deterministic negative/positive regression cases.

## Deployment flags (ALL off by default)

The new squad layer is active **only** when:

```
EVEJS_COOP_NPC_SQUAD_RAIDS=1
EVEJS_COOP_NPC_CAPSULEER_AGENCY=1
EVEJS_COOP_NPC_ORDER_ARBITER=1
```

Existing `EVEJS_COOP_VIRTUAL_WORLD`, `EVEJS_COOP_MATERIALIZE_NPCS`, `EVEJS_COOP_NPC_RAIDS` and native mining-fleet prerequisites remain necessary; `EVEJS_COOP_NPC_PERSONAL_GOALS=1` from PR #39 improves pirate scout/patrol routes but is not required for verifying the squad director in isolation. Do **not** enable these flags on the live server without local owner-approved World testing.

## Evidence / acceptance ladder

- **PASS in this development context:** 14/14 tests from the exact committed `.test.mjs` suite, executed using JavaScript V8 with a small in-memory filesystem shim and the fetched GitHub CJS module sources. These exercise native-shaped mock scenes and callbacks; they are NOT a full Node `node --test` or EveJS boot run.
- Also manually checked 20 direct bounded team/scout assertions and standalone risk cases (unseen remote pirate SCOUT -> authenticated same-faction scout relay RAID -> observed player defense WORK; forged/expired relay SCOUT).
- **NOT DONE:** complete project test baseline, native EveJS pinned overlay dry-run/roundtrip, real simulated scanner/cloak behavior, actual native warp/weapon HP evidence, two real clients, post-restart raid continuity, native cargo theft, salvage, wallets/ISK and performance. Source-only proximity isn't a full ship scanner; not suitable for player hunts.
- **Safety constraints:** never use this source for target acquisition of human player ships. Every candidate remains a physically real *NPC stock mining fleet* ship and must pass `isAuthorizedStockMiningRaid`. Raid completion, kill or loot must come from verified native events, not the team's intent or an attack order.
- **Next engineering gate:** run `node --test tests/coop-npc-squad-scout-relay.test.mjs` and full tests on the real local checkout; test no duplicate routes/attacks when tactical rescue, native gates and worker routes overlap; then see actual scouts, delayed response and native NPC-versus-NPC damage on two clients.

**No `main` merge, CI, Docker restart or `evejs-data` mutation in this PR.**
