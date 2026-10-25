# COOP-10 — Native EWAR, logistics and command bursts (Chat 10)

Pinned source: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Initial repository HEAD during review: `bb3ff00dcf3605c5b6ff7bdf5bd01e4b47be1adb`. All source claims are **review evidence only**, not proof of a running game.

## Native ownership inventory

| Mechanics | Pinned source | Relevant authoritative contract |
| --- | --- | --- |
| Warp scrambler/disruptor, web, target painter | `space/modules/hostileModuleRuntime.js` | native target lock, surface range/falloff, Dogma strength, aggregate warp and velocity effects |
| Sensor damp, tracking/guidance disruption | same | Dogma weapon and target modifiers with stacking penalties |
| Energy neutralizer and nosferatu | same | actual cycle capacitor read/write, native resistance/signature and target locks |
| ECM, ECM burst | `space/modules/jammerModuleRuntime.js` | sensor-type strength, probabilistic jam, lock clearing and duration |
| Remote shield/armor/hull and capacitor transfer, remote sensor/tracking boosters | `space/modules/assistanceModuleRuntime.js` | actual target state and lock, native module capacitor cost and duration |
| Command bursts | `space/modules/commandBurstRuntime.js` | charge compatibility, fleet/allied recipients, range, timed native Dogma modifier collections |
| NPC target/utility/support behavior | `space/npc/npcBehaviorLoop.js`, `npcHostileUtilityCatalog.js` | native pseudo-session, real module activation, friendly assistance targets; NPC retreat checks real warp scramble |

Source contract token check performed against all **five exact pinned module files** via GitHub connector: all expected tokens present and all four new patch anchors unique. **Not equivalent** to real game tests.

## Confirmed defects and isolated fixes

1. Standard NOS eligibility in `resolveNosTransferAllowed` compares absolute GJ (`sourceCapAmount + 1e-6 < targetCapAmount`); correct is attacker capacitor fraction **strictly lower** than target fraction, using effective native capacities and native callback amounts. `nosOverride` is already checked by native code before this line and is preserved. The corrected helper fails closed on missing/invalid/out-of-range cap state. Actual transfer, cycle timing and Dogma amount remain native.
2. `executeAssistanceModuleCycle` reported full requested shield, armor or hull repair as `appliedAmount` even if the real condition state only changed by a fraction due to already nearly full HP. Corrected helper derives the receipt from actual **before/after native conditionState** and actual capacity. It does **not** change HP, repair costs or timing. Native capacitor transfer already reports capped `appliedAmount` and is not altered.

**Isolated files, not integrated into the shared installer:**
- `integration/coopEwarDogmaCorrections.cjs` — pure stateless code, no invented Dogma bonuses.
- `scripts/coop-ewar-dogma-patch.cjs` — reversible source transformer (single-statement replacements, default-OFF flag, LF/CRLF).
- `scripts/coop-ewar-native-audit.cjs` — read-only presence audit, explicitly never gameplay PASS.
- `tests/coop-ewar-dogma-corrections.test.mjs`, `tests/coop-ewar-native-audit.test.mjs`, `tests/coop-ewar-native-pinned.test.mjs` — unit/negative, source-shaped and optional real pinned-source checks.

## Precise integration contract for Chat 01 (central runtime owner)

**Required module deployment:** add `coopEwarDogmaCorrections` to the existing `names` array in `scripts/patch-evejs-coop.cjs`, mapping `.cjs` to `Code/server/src/space/coopEwarDogmaCorrections.js` as with the other modules. No additional registry, timer or state machine.

**Required native specs:** add empty `patches:[]` entries for
`server/src/space/modules/hostileModuleRuntime.js` and
`server/src/space/modules/assistanceModuleRuntime.js`; ensure each appears exactly once.

**Required transform:** in central `transform(source,spec,remove)`, once per corresponding spec, invoke
`require('./coop-ewar-dogma-patch.cjs').patchEwarDogma(text,spec.file,{remove})`.
Treat an unknown/missing/multiple anchor as a hard preflight failure, not best-effort patching.

**Activation:** `EVEJS_COOP_NATIVE_EWAR_CORRECTIONS=1` (default **OFF**). OFF returns the original native behavior even with the hook installed. Chat 01 owns deployment scripts, flags and bootstrap; do not modify them independently.

**Validation before enabling:** pinned `EVEJS_COOP_CODE_PATH=<Code> node --test tests/coop-ewar-native-pinned.test.mjs`; `node scripts/patch-evejs-coop.cjs --code-path <Code> --dry-run`; exact roundtrip/unpatch, overlay drift test, Node native module-cycle integration, two real authorized accounts/ships, source/target capacitor and HP values, online/offline NPC utility behavior, disconnect/death effect expiration, warp tackle vs native warp request, burst eligibility and existing fleet, cap cost, charge consumption, target range/locks, multi-module stacking, ship swap, reconnect and restart.

### Required gameplay acceptance matrix (not performed)

- **Tackle:** A scrams B, B tries warp and MWD/MJD; disruptor blocks warp but not MWD; deactivation/range loss restores abilities. Additional warp-core strength and repeated source applications must be measured in native Dogma state.
- **Web/paint/damp/tracking disruption:** measure actual target velocity/signature/lock range/scan resolution and turret hit mechanics; multiple modules stack by actual modifier order and penalty; no fabricated bonuses.
- **ECM:** repeat deterministic server-side sensor/resistance/roll cases, jam duration and allowed lock targets, then confirm observed target-loss and reacquire in client.
- **Neut/NOS:** cap costs and amounts correspond to actual native module cycle, cap limits and resistances; verify mixed-capacity NOS eligibility and `nosOverride`.
- **Logistics:** cross-player target locks, remote repairs against partially/fully damaged allies, actual pre/post shield/armor/hull; cap sender pays native module cost, recipient gains no more than actual native amount; unauthorized/invalid targets rejected.
- **Command bursts:** charge consumed only on real cycle, friendly recipients in range, expiration, stacking and modifiers match actual Dogma; disconnected/other-fleet/remote players are excluded.
- **NPC:** NPC hostile EWAR and NPC assistance decisions must be native (`npcBehaviorLoop`) and should affect real player/NPC hulls; retreat while scrambled must fail.

## Evidence and blockers

Local isolated `node --test` for the two runnable suites: **16 PASS, 0 FAIL**. Source-present check against pinned upstream files through the GitHub connector: **5/5 families present**, all replacement lines unique. The real pinned-source test requires a local EveJS Code checkout and is **SKIPPED** here. Docker, active clients, resource persistence, module effects in live game, overlay dry-run and restart were **NOT RUN**. Status: **CODE_PREPARED / INTEGRATION_BLOCKED / LIVE_UNVERIFIED**, not DONE.

Do not turn flags ON or claim the full combat-role assignment complete while Chat 01 integration and two-client live tests are missing. Publishing these isolated helpers and tests to main does not deploy or enable the corrections. No native modules or central runtime were changed in this Chat 10 commit.
