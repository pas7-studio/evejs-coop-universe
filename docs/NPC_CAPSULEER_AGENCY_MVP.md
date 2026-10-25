# COOP-024 — Native NPC opportunistic hunting: implementation slice A (2026-10-25)

**Status: IMPLEMENTED_UNVERIFIED; feature OFF by default.** Design authority: [NPC Capsuleer Agency & Hunting V1, draft PR #29](https://github.com/pas7-studio/evejs-coop-universe/pull/29). This PR implements the *first native NPC-on-NPC* decision integration, not player PvP, independent NPC inventories, group contracts or an all-purpose GOAP/HTN agent.

## What actually runs

The existing `coopVirtualWorldRuntime.cjs:advanceNativeRaids()` continues to use native EveJS `npcRuntime.issueAttackOrder` and `warpToEntity` through `coopNativeRaids.cjs`. Its **existing** `isAuthorizedStockMiningRaid` hard gate always executes first. The new **optional** `coopNpcHuntPolicy.assess` is consulted *after* source authorization but *before* the raid director issues a native order, and can decline an otherwise permitted NPC mining raid.

- `coopNpcIntelLedger.cjs`: durable per-named-pilot/per-NPC-target short-lived witnessed proximity evidence, source system and approximate last position, bounded by TTL 90 s and 1,000 entries. Native scene proximity <=200km is required for a fresh observation. No player character/cargo records. Unknown/corrupt state fails closed.
- `coopNpcOpportunityPlanner.cjs`: deterministic conservative scoring based on genuinely witnessed NPC mining/haul role, time-decayed confidence, actual native attacker armor/structure, warp scramble, nearby **physical** NPC patrols and authenticated visible player ships as possible opposition. The output is `RAID`, `WORK`, `RETREAT`, or `SCOUT`, with reason codes; this policy never creates assets, changes HP or awards ISK.
- `coopNpcHuntPolicy.cjs`: bridge between native scene and pure planner; only `nativeNpc === true` source + target; never proposes a player as prey; rejects missing real ship, wrong scene, moved/stale contacts and missing native dogma/scramble evidence.
- `coopVirtualWorldRuntime.cjs`: new default-OFF `EVEJS_COOP_NPC_CAPSULEER_AGENCY=1` gate; no second raid director, no new spawn, no new combat hook, no NPC vs player attack. Existing director's active-raid leases still remain authoritative. Emits bounded `living-npc-opportunity` server observations for decision inspection.
- `scripts/patch-evejs-coop.cjs`: three new source modules enlisted in existing reversible overlay copy list, copied from `integration/*.cjs` to `server/src/space/*.js`. The adapter resolves the appropriate sibling extension in either tree.

## Important truth / limitations

The labels `WORK`, `RETREAT`, and `SCOUT` mean **decline the new offensive order**. They do **not** yet cause new repairs, autonomous income/industry jobs, smart exploration, unconditional safe warp, a full chase decision or a dedicated scheduled work pipeline. Existing patrol/civilian/tactical directors may continue their prior behavior. The native tactical retreat component already handles damage-triggered retreats separately.

The current initial proximity signal is based on native scene presence and distance, **not an audited cloak/sensor/overview module**. It is restricted to real native NPC mining fleet targets and MUST NOT be reused to locate human prey. Exact PvP legality, invulnerability, scanning rights and fair player counterplay remain COOP-024A prerequisites.

The native mining raid director still uses authoritative native NPC ore cargo to select candidates. That inventory is **not** exposed to the new planner, which scores estimated opportunity from witnessed NPC role and guard presence, not hidden exact cargo/fit data. None of its monetary score units represent native ISK. No virtual-world goods are converted to physical stock or loot.

No full cross-director order arbiter, personality-driven careers, native player bounty hunts, inter-system stalking, NPC item reprocessing or social autonomous dialogue is in this slice. Agent tasks COOP-024B..F in the design PR remain open.

## Opt-in test sequence (local disposable world only)

1. Test pure modules: `node --test tests/coop-npc-capsuleer-agency.test.mjs`.
2. Run local full test baseline and pinned overlay apply/remove/dry-run checks against verified EveJS checkout, **without** touching production data. Test `coopNpcHuntPolicy` source under both `.cjs` and installed `.js` layouts.
3. In a disposable local world with two physically materialized native NPC fleets, enable **existing** living world/mining/native raid flags and `EVEJS_COOP_NPC_CAPSULEER_AGENCY=1`. Keep NPC-player hunt **disabled**. Confirm a real 200km grid witness and one real native attack (or abstention). Console event is only an intent witness, not a verified weapon hit.
4. Bring one real NPC patrol or authenticated player's ship within the observed prey's grid. Planner should decline **new** raid orders. The existing combat director remains authoritative for already ongoing combat.
5. Reconnect/restart with the same data in a backed-up disposable volume. Confirm no synthetic NPC ships, cargo grants or hidden player targeting, and no automatic use of stale sightings. Disable flag to verify legacy behavior.
6. Only after native game/client evidence and source audit can this become eligible for owner-approved live rollout. Never adjust seed stock, delete `evejs-data`, run remote CI or silently merge unrelated PRs.

## Verified here

Node 22.16.0 sandbox isolated test: **9 passed / 0 failed**. Includes conservative raid/no-raid scoring; TTL, system and pilot scope; player never being prey; physical nearby patrol/player deterrence; missing health/warps; corrupt durable state; restart; and `.cjs` -> `.js` installed-module loading. Source-code-only connector audit also checked pinned upstream `combat/damage.js` and `hostileModuleRuntime.js` exports used by the runtime adapter.

**NOT YET VERIFIED:** 100%-native full EveJS pinned overlay roundtrip, all repository tests, two-client view, stock NPC weapons/fitting actually dealing damage, materialized convoy in real World or performance at live load. Draft remains unmerged and undeployed.
