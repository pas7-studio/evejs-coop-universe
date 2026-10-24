# Gameplay acceptance: prove the actual EveJS Living Universe

**Owner-requested focus, 2026-10-25:** Validate **the game**, not continuously rediscover security advisories. This document is the authoritative workflow for operators and AI agents asked to "test whether the game works", "verify NPCs", "check World/Party", or "confirm two players". Follow it before general backend verifier or dependency audit runbooks.

## What the 2026-10-25 report actually proves

The operator reported project revision `cc5ce83` and pinned EveJS upstream `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`:

| Gate | Reported result | Meaning |
| --- | --- | --- |
| Local regression | PASS 72/72 | Local contracts/fixtures passed, **not** a live NPC |
| Upstream contract tests | PASS 27/27 | Isolated EveJS contracts, **not** two actual clients |
| Init, server, market | PASS | Healthy infrastructure |
| Compose published ports | PASS (127.0.0.1) | Loopback safety boundary |
| Two TCP sockets and reconnect | PASS | Transport only, not EVE handshake or login |
| Living Universe flags | PASS | Flags present in container; not proof startup hook executed |
| Native gameplay event file | **MISSING** | **BLOCKED_TELEMETRY**, investigate before interpreting World |
| Client login, actual NPC ships/actions, two-player gameplay | **NOT VERIFIED** | No gameplay PASS may be claimed |
| npm audit | 7 advisories: 1 critical, 3 high, 3 moderate | Separate known exposure/security workstream; not the test target |

The operator's **uncommitted local test fixtures** (three adjusted upstream test files and two `.js` bridges for `.cjs` imports) must remain untouched unless they explicitly approve changes. Do not repeatedly "fix" these files, silently discard them, clean the repo, rebuild the market or delete persistent volumes.

**Revision matters:** the tested `cc5ce83` report does not validate any later feature commits in the current PR. Record the **actual checked-out project SHA**, upstream SHA, running Docker image and overlay presence for every new round. Don't reuse a PASS from a different SHA.

## Mandatory agent behavior: testing order and stop rules

1. **Read the existing report.** If regression, upstream contracts, backend health, TCP, safety or npm audit are already documented PASS for the **same deployed revisions and unchanged relevant files**, do not repeat them without a reproducible regression signal or explicit owner request. Never convert an old PASS into a new-SHA PASS.
2. **Never run npm audit, dependency updates, vulnerability scans, penetration tests, package installs or GitHub CI as part of the gameplay test.** The seven existing advisories are a separate tracked security issue. Keep loopback ports; do not expose the server. An explicit separate security request can authorize a separate assessment.
3. Start at the **first unproven gameplay gate**. For this report it is **headless boot/event logging**, not unit tests. Debug only what prevents that gate.
4. If the required compatible, **authorized** EVE client is unavailable, mark `BLOCKED_CLIENT_UNAVAILABLE`; record the backend state as already verified and do **not** endlessly rerun TCP/backend/audit. Never acquire, patch, bypass protections of, or redistribute a proprietary client without authorization.
5. If the client is present, run the **actual login/undock/scene interaction** steps below; a pair of Play.bat windows, connected sockets or NPC unit tests is NOT a gameplay PASS.
6. Each gate ends with an explicit **PASS / FAIL / BLOCKED / NOT_TESTED** and the concrete next action. Do not claim complete verification or repeat unchanged work to fill time. Never fabricate evidence.
7. Do not trigger GitHub Actions/CI, automated remote tests, modify public network binding, merge `main`, wipe Docker named volumes, overwrite local changes or touch real accounts without express owner approval.

## Phase 0 — preserve the existing world

From a **local PowerShell** prompt in the co-op project checkout:

```powershell
$repo = 'C:\Games\EveCoopProject'
$code = 'C:\Games\EveCoop\upstream-evejs\Code'
Set-Location $repo
git rev-parse HEAD
git status --short
git -C (Split-Path -Parent $code) rev-parse HEAD
```

Record the two SHAs. Do **not** `git pull`, `git reset --hard`, `git clean`, run `Prepare`, `market-tools rebuild`, `docker compose down -v` or perform a source update while preserving local upstream fixes/test fixtures. Agree on an isolated update plan before testing a different commit. Keep server/market localhost-only.

`Local-Two-Client-Test.ps1 -Action CoopStart` **deploys and rebuilds the overlay**; do not re-run it just to diagnose missing events unless you have confirmed that the running image is missing the patch and the operator authorized redeployment. `-Action World`, `-Action DiagnoseWorld`, `-Action Party` and `-Action Status` are read-only diagnostics.

## Phase 1 — prove the runtime is recording actual server events (NO CLIENT REQUIRED)

**This phase is the next required action after the 2026-10-25 report.** When the overlay has `EVEJS_COOP_HEADLESS_WORLD_BOOT=1`, `coopVirtualWorldRuntime.start()` should call `scheduleHeadlessWorldBoot()`, which emits `living-headless-boot-requested` immediately. A client is **not needed** to create that specific event. If `/var/lib/evejs/coop-events.jsonl` is missing, do not tell the operator merely to log in.

Run the read-only diagnostic (no rebuild / restart):

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath $code
```

It checks the **running container** rather than trusting a local Compose file: required runtime flags, `EVEJS_COOP_EVENTS_FILE`, installed overlay modules, whether the event file exists and has headless/world event records, and relevant server startup warnings.

**Interpretation and next steps:**

| Finding | Status | Correct next action |
| --- | --- | --- |
| `EVEJS_COOP_EVENTS_FILE` missing/empty | `BLOCKED_TELEMETRY_CONFIG` | Fix **effective running** Compose env; only redeploy with permission |
| Headless/world flags OFF | `BLOCKED_RUNTIME_CONFIG` | Confirm running container really uses LivingCoop overlay |
| `/app/server/src/space/coopVirtualWorldRuntime.js` or `coopRuntimeProbe.js` missing | `BLOCKED_OVERLAY_INSTALL` | Inspect installed overlay and image revision, don't repeat audit |
| Modules and flags present, event file absent | `BLOCKED_TELEMETRY` | Check server startup hook and `[CoopVirtualWorld]`, `[CoopProbe]` warnings; check directory permissions, no blind restarts |
| Event file present but only `living-headless-boot-requested` | `PENDING_NATIVE_BOOT` | Inspect per-system boot error/pending event and native static-data readiness |
| `living-headless-boot-system` present but `PENDING_NATIVE_SCENE` | `BLOCKED_NATIVE_SCENE` | Inspect missing physical ships, belts, static waypoints and source of data |
| Native scene and activity observed | `SERVER_WORLD_EVIDENCED` | Run World; then advance to actual client rendering |

A healthy `server` container + `EVEJS_COOP_* = 1` does **not** imply that the headless startup hook ran successfully. A missing events file is not an absence of a compatible client; it is a runtime instrumentation/startup/storage problem **until diagnosed**. Do not write synthetic sample events to make World pass.

If necessary collect only the **relevant redacted** diagnostic evidence and a small recent server log excerpt. Never publish all environment variables, tokens, character IDs, private IPs, keys, or the full production logs.

## Per-system diagnosis from 2026-10-25: Jita is NOT a mining test

The tester measured **Jita (30000142)** with 66 waypoints, 18 stations,
7 gates and **zero asteroid belts**; this is legitimate per-system SDE,
not evidence that global SDE generation is broken. The route also
includes **Perimeter (30000144)**, which has three genuine SDE belts.
Use `-WorldSystemID 30000144` for the physical mining World gate,
while separately validating Jita NPC patrols/traders. Never manufacture
asteroid entities in Jita.

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action World -WorldSystemID 30000144
```

If Perimeter lacks physical fleet or named NPC assignments, read the
new `systemSiteReadiness` and `nativeMaterializerAttempt` sections of
the World report. `living-native-materialization-attempt` exposes
candidate counts and exact native spawn errors. The first report from
the tester (revision `a087167`) does **not** validate these fixes or
prove that Perimeter will have sufficient ore/active NPCs.

**Jita may become headless-ready with real named non-mining NPCs**, but
its imaginary miners cannot make mining pass. No client is required to
obtain the real server-side bootstrap/scene evidence.

## Phase 2 — prove actual physical NPC scene activity on server (NO CLIENT REQUIRED)

After Phase 1 produces real events, run:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action World -CodePath $code
```

`World` is a **server-side** gate. Its strict `--require-activity` report requires actual EveJS topology/asteroid belt, a real native miner+hauler fleet, at least one **physically present named NPC assignment**, and consecutive scene observations showing real movement **and** native cargo growth or actual targeting. A scheduled bootstrap, flags, virtual NPC counts, static source contracts, two TCP sockets or healthy Docker do not count.

If the evidence file is there but activity is not yet measurable, observe one genuine simulation interval and repeat the **read-only World check** once; if still blocked, capture the exact report status and missing observations rather than repeating all setup steps. Headless scene retries can continue over minutes; don't confuse a pending retry with successful movement.

**Stop condition:** `World PASS` => only **server-side physical activity verified**. `World FAIL` => investigate named native scene reason. No claim yet about the actual client showing that NPC.

Optional more demanding server-only gates, after the relevant organic action actually occurred:
```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action Combat -CodePath $code
.\scripts\Local-Two-Client-Test.ps1 -Action FinalBlow -CodePath $code
```

`Combat` needs verified native NPC weapon event + real HP loss + physical wreck + persisted loot. `FinalBlow` additionally requires EveJS to have **explicitly passed** a native attacker to the wreck path. Their absence is not an excuse to manufacture a battle, spawn a scripted wave or fabricate kill attribution. Keep market / native gate transfer experiments OFF during baseline gameplay acceptance.

## P0 no-NPC scene recovery (new code, not yet live tested)

When a real scene is loaded but its first native NPC spawn fails,
the new `coopHeadlessScenePolicy` keeps it in the periodic
reconciliation set rather than waiting only for the escalating
headless retry timer. The scene must contain actual authoritative
static waypoints; an arbitrary system ID or virtual population is
not sufficient.

After the owner-approved overlay refresh, use read-only
`-Action World -WorldSystemID 30000144` and inspect:
`headlessAttemptCount`, `systemSiteReadiness.trackingForReconcile`,
`systemSiteReadiness.stockMiningStartup.status`,
`nativeMaterializerAttempt.spawnErrors` and the actual native
fleet/cargo/activity. If the startup configuration has excluded
Perimeter, report that exact configuration issue **without**
fabricating a mining fleet or resetting persistent data.

## Physical named NPC reliability — native-client broadcast and durable links

The current P0 overlay now changes `coopNpcPresentation` to call pinned
EveJS's **actual** `scene.broadcastSlimItemChanges([ship])`. The prior
`sendSlimItemChangesToAllSessions` was not implemented by SolarSystemScene,
so persistent names could be set in server memory without notifying an
already-present player client. A failed slim notification is retried on
the next NPC reconcile without respawning a ship. **Name broadcast
success is not the same as visible in-client proof**: the tester must
observe the NPC in the actual overview.

`coopNpcMaterializer` no longer silently ignores occupied native spawn
slots and thrown EveJS spawn errors. It logs `SPAWN_LIMIT_REACHED`
with occupied/limit, `NATIVE_SPAWN_THROW` with nativeReason and
`IDENTITY_LINK_FAILED` with the provisionally spawned ship ID. If a
durable registry write failed, reconciliation retries attaching the
*same physical ship* before ever asking native EveJS to spawn again.
An identity conflict with another existing native hull fails closed.

The headless runtime now requires `nativeNpc===true` and
`kind==="ship"` for both saved named identity links and stock
miner/hauler assignments. A player-controlled ship or static
scene entity cannot substitute for real NPC evidence. The report
exposes `nativePresentationPending`, `nativeMaterializerAttempt`,
`headlessAttemptCount` and `headlessPendingSystems`. These
distinguish no timer execution, no candidate resident, native
spawn failure, identity write failure and unavailable client
broadcast. None of them can be declared a gameplay PASS based on a
virtual pilot or a background timer alone.

The next tester should use `World -WorldSystemID 30000144` and
attach those report fields **without replaying backend or npm audit**.
Keep volume `evejs-data`, persistent NPC links and local upstream
test fixes intact.

## Durable named NPC restart (separate controlled gate)

A new [durable native NPC runbook](NATIVE_NPC_DURABILITY.md)
explains how to verify same-ID persistence across an authorized
server restart. Do not restart as part of the ordinary read-only
`DiagnoseWorld`/`World` check. When the owner approves a
controlled restart, preserve `evejs-data` and look for
`nativeDurableRecovery.status=OK`, nonzero
`recovered`/`alreadyPhysical`, and the same real NPC entity ID
in the physical scene. A failure
`BLOCKED_DURABLE_NPC_RECOVERY` is **not** a reason to delete
the registry. The new source-side check does not yet prove
in-client position, damage or inventory continuity.

## Phase 3 — prove a real compatible EVE client (HUMAN OPERATOR)

Only use a lawfully usable and explicitly authorized compatible client. The upstream-targeted build and setup expectations are documented in `docs/SETUP_WINDOWS.md`; this project provides **no client binaries, compatibility bypass or DRM workaround**.

**Ask the human operator to perform and observe**, rather than pretending to see their GUI:

1. Start one client using the existing authorized installation (if already configured) or `-Action LaunchOne -ConfirmClientPermission`; verify it reaches **real character selection** and authenticates. Record `CLIENT_LOGIN_PASS` with evidence.
2. Enter the game as a character in the configured solar system (default `30000142`), **undock**, and wait for a real space scene. Record `UNDOCK_PASS`.
3. Locate at least one **physical named miner/hauler/trader/patrol/pirate** from the server evidence. Check its overview/name/position matches the server's scene and can be approached/targeted. Record `NPC_VISIBLE_IN_CLIENT_PASS` only after the operator confirms this.
4. Watch the same NPC perform a **visible** native action (moving, mining, hauling, warp, authentic combat or physical retreat) and correlate timestamps/system/ship with native server events. Record `NPC_ACTION_VISIBLE_PASS`.
5. Observe a real non-scripted NPC combat cycle if naturally available: actual weapon effect, shield/armor/hull change, destroyed ship, persistent wreck and a valid loot interaction. Record each subgate independently; no guaranteed NPC fight in a short observation window.

If client cannot launch or is unavailable: **stop at `BLOCKED_CLIENT_UNAVAILABLE`** (or `BLOCKED_CLIENT_COMPATIBILITY` for a concrete launch error). Report exactly what the operator needs to supply. Do not rerun npm audit or tests to substitute for missing gameplay.

## Phase 4 — prove two authenticated players share one real world

Only after one-client proof, and with two independently permitted accounts/characters:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action LaunchTwo -ConfirmClientPermission -CodePath $code
.\scripts\Local-Two-Client-Test.ps1 -Action Party -CodePath $code
```

`LaunchTwo` opens launcher windows; it **does not** prove two clients can authenticate. Confirm manually:

1. Two different characters actually authenticate, undock and occupy the **same system and observable grid** on the **same server**.
2. A sees B's actual ship; B sees A's actual ship. Moving A is visible to B and vice versa.
3. Join the same fleet when native EveJS supports it, perform a real fleet warp and verify arrival with both clients.
4. If supported, join an ongoing native NPC fight, verify damage/loot; don't assert a mechanic unsupported by the server.
5. Disconnect A while B remains; B stays operational. Reconnect A and verify **same ship/character** with no duplication, loss of persistence or ghost entity.
6. Restart only when the operator authorizes that disruption and has a backup; verify world persistence.

`Party` correlates **server-side** sessions/scene events; the human's visible proof is still separately required. Two connected TCP sockets, two open launcher windows or a `Party` parser result alone do not prove full two-player gameplay.

## Exact gameplay mechanic acceptance matrix (only after its prerequisite phase)

This table defines **what to test, what counts as PASS and what is insufficient**.
Do not force a random encounter or reset world state solely to fill this
matrix. Record `NOT_TESTED` when the appropriate scene or event did not
occur, `BLOCKED` when a named prerequisite prevents an attempt.

| Mechanic | Server evidence | Real player-visible evidence needed for in-game PASS |
| --- | --- | --- |
| Headless NPC spawn | `living-headless-boot-requested`, per-system `living-headless-boot-system`, native scene/identity link | **None for server boot gate**; a healthy container or projected virtual pilot is insufficient |
| Persistent named NPC | Actual linked native `entityID` in scene, `living-native-activity` | In-client overview shows the **same** ship/identity; after safe restart identity is consistent |
| Mining and ore | `living-native-industry`, inventory change and `oreGrowth`; source asteroid content decreases | Player sees actual miner at belt and native mining activity; cargo growth alone is **not** proof of mining lasers |
| NPC hauling and delivery | `living-hauler-loaded` / `living-hauler-delivered`; same fleet, correct native ore quantities | Hauler visibly warps with real cargo; no duplicate/vanished cargo; depot is **virtual**, not native station stock |
| NPC pirate raid | `living-pirate-raid` and actual linked controllers / real target and HP samples | A player observes pirate movement/engagement; an issued attack order alone is insufficient |
| Retreat from damage | `living-npc-tactical-event` with `npc-retreat` plus actual native warp/arrival | NPC visibly leaves danger. Warp scramble/no valid destination must **not** count as escape |
| Distress and reinforcement | `living-npc-tactical-event` with `reinforcement-warp` and later `reinforcement-attack` | **Existing same-faction NPC** travels to attacker and acts only after arrival; no fabricated rescue wave or allied friendly-fire |
| Actual NPC weapon and destruction | `-Action Combat`: native launch/activation witness, measured damage to same victim, real native wreck with nonempty stored loot | Player observes actual damage/wreck and can interact with loot; an HP-only sampler does **not** prove which weapon delivered a final blow |
| Native destruction attribution | Optional stricter `-Action FinalBlow`, requiring upstream explicit attacker | Do not infer a killer from targeting, telemetry or faction; record `NOT_PROVEN` if EveJS does not identify an attacker |
| NPC memory and standings | Persisted named-NPC relation and actual `living-player-consequence` where relevant | Same NPC recognizes actual returning player only if conditions met; a saved memory record alone is not a conversation |
| Two-player encounter | Two real authenticated characters on same grid; server `Party` events | Both clients see and can interact with the same NPC and each other, then reconnect without ship duplication |
| Two-player native fleet warp | `coop-fleet-warp-native-order` proves native follower warp accepted/failed; `coop-fleet-warp-skip` explains why same-scene safety blocked a follower. See [COOP_FLEET_WARP](COOP_FLEET_WARP.md) | Commander A and member B must BOTH visibly warp and land in the same actual grid, then join authentic combat; a successful warp RPC is **not** arrival proof |
| Stargate NPC travel (experimental) | When separately enabled, `living-native-gate-approach` then `living-native-gate-transfer` with same native entity and cargo | Arrival across real gate and same ship state after recovery. **Default OFF; not part of baseline World PASS** |
| Native seed-market NPC trade (experimental) | When separately enabled, `living-native-market-trade` events and `-Action Market` require sale followed by purchase with exact seed RPC / inventory / wallet | Real daemon order/stock changes and same NPC cargo. **Default OFF; this does not prove personal player-compatible NPC orders** |

**How long to observe:** The ordinary world simulation has periodic
ticks and headless retries; don't demand that a natural pirate fight,
distress call, retreat or market trade appear on command. Take one
actual observation window, run the relevant gate, then report the
exact unproven condition. Do not inflate readiness by simulating or
editing event logs. Use `-Action Logs` only for focused diagnostics,
redact before sharing. Do not repeat the one-time installation commands.

## Phase 5 — report and stop

Use `docs/GAMEPLAY_TEST_REPORT_TEMPLATE.md`. Include actual project commit, pinned upstream commit, overlay module presence, actual client build/provenance (without distributing files), event names/counters, short redacted log excerpts or screenshots, and **one concrete next blocker**.

Do not report a global `PASS` for World/gameplay until each requested stage passes; status remains `PARTIAL` or `BLOCKED` where evidence is absent. **Prove the intended mechanic, not the general health of the infrastructure.**

The already-discovered seven npm advisories remain important but **out-of-scope for this gameplay run**; keep loopback binding and record them separately for authorized remediation. Do not pretend an npm audit is a real player experience test.

Related: [HEADLESS_NPC_VALIDATION.md](HEADLESS_NPC_VALIDATION.md), [TWO_CLIENTS_ONE_PC.md](TWO_CLIENTS_ONE_PC.md), [VERIFY_BACKEND_ONE_COMMAND.md](VERIFY_BACKEND_ONE_COMMAND.md), [NATIVE_NPC_GATE_TRAVEL.md](NATIVE_NPC_GATE_TRAVEL.md), [NATIVE_NPC_MARKET.md](NATIVE_NPC_MARKET.md).

## P0 — stock-fleet pirate PvE permission and proof

The previous raid selector required *both* the pirate and target to have named co-op identities with opposite factions. Upstream native EveJS independently marks NPC-to-NPC actors friendly in its combat targeting loop. Consequently, a real stock miner with ore but no co-op name could never become a valid pirate damage target. The new opt-in LivingCoop policy is intentionally narrow: a **currently linked named pirate** may be issued an attack order against a **genuine physical member of the active EveJS mining fleet**, even when that miner does not have a named identity. A named miner/hauler must still belong to the opposing faction; attacks against arbitrary NPCs or player ships remain disallowed.

The same permit is enforced at (1) raid target selection and (2) EveJS native combat friendliness. The patch does not create enemies, loot, damage, belts, scripted combat waves, or a fake victory event. `coopNativeRaidEligibility.cjs` is installed through the pinned reversible overlay; isolated permission and native-hook tests are listed in the manual verifier. No Docker/client proof is claimed.

**Operator acceptance on Perimeter 30000144** (after explicitly approved overlay update, preserving `evejs-data` and local upstream test fixes):

1. `DiagnoseWorld` then `World -WorldSystemID 30000144` must show real belts, real fleet members and at least one physical named NPC. Record any materialization failures rather than retrying generic backend checks.
2. Confirm real mining fleet cargo grows. A pirate raid should acquire an **actual** ore-bearing miner or hauler. Record the successful `living-pirate-raid` native attack order, not just a warp.
3. Confirm native damage/HP changes or a real wreck attributable to actual weapons. A successful native order alone is **not** proof of combat damage.
4. Both authorized EVE clients must independently see the same physical targets/wreck. Let player A loot an item; player B must see its updated state and cannot take the same item again.
5. Reconnect each pilot without losing their ship; test fleet warp orders and separately verify both ships' arrivals before claiming the complete two-player PvE gate.

If any step fails, keep PR #2 Draft and attach `DiagnoseWorld`, `World`, `Party`, a sanitized event excerpt and exact deployed commit SHA. Do not reset Docker volumes, rebuild market data, or merge solely to investigate.

## P0 — recover real EveJS mining startup after a transient spawn failure

Pinned upstream EveJS used to call `startupSceneSeedSet.add(startupKey)` **before** attempting to create any native fleet. One failed initial spawn therefore permanently suppressed another attempt in that process. In explicitly deployed `-LivingCoop` the reversible source patch now enables `EVEJS_COOP_MINING_STARTUP_RETRY=1`; it marks a startup seed complete only after **all configured startup slots** have real EveJS fleet records. An incomplete attempt retries just the missing slot, never re-spawning an existing seeded slot. The patch is OFF outside this opt-in and is exactly removable from the pinned upstream source.

For Perimeter 30000144, `DiagnoseWorld` now prints the effective retry and native fleet startup settings plus the number of genuine `living-native-mining-startup-slot` events. `World` displays the most recent outcome for this system as `nativeMiningStartupOutcome`. `FAILED` includes the actual upstream `errorMsg`; `SEEDED` includes the number of real miner and hauler ships returned by EveJS. Neither an emitted event nor a complete fleet record alone is sufficient for World PASS: the physical ships must exist in the scene and exhibit actual movement and mining/targeting evidence.

**New P0 regression suite:** `coop-mining-startup-retry.test.mjs` covers failed first spawn, partial multi-fleet recovery, exact rollback, repeated apply, disabled opt-in, and partial-patch rejection. `coop-mining-startup-world-report.test.mjs` covers failure reason, recovery signal, and strict per-system filtering. `coop-npc-role-priority.test.mjs` ensures low NPC caps still prioritize pirates and patrols; normal `-Action CoopStart` continues to explicitly request 6 named hull slots per system.

If `World` still reports `NO_NATIVE_MINING_FLEET`, use `nativeMiningStartupOutcome.error` and the current `systemSiteReadiness.stockMiningStartup`. If named NPCs still equal zero while stock mining succeeds, focus exclusively on `nativeMaterializerAttempt.spawnErrors`, not on mining startup. Preserve `evejs-data`, retain the exact deployed overlay SHA, and do not run CI or market rebuild to overcome a gameplay blocker.

## P0 — prove real pirate fire against stock EveJS miners

The native EveJS pirate-raids policy legitimately targets *unnamed* stock mining NPCs. The existing strict `Combat` and `FinalBlow` evidence gates require **both victim and attacker to have durable co-op pilot names**, so they cannot recognize a named pirate damaging a stock miner, even when the damage is real.

The opt-in `StockRaid` gate now measures the hull's **actual EveJS shield/armor/structure HP drop** between two native scene samples (`living-native-stock-fleet-combat`) and pairs that evidence with a **successful native NPC missile launch or weapon activation** (`living-native-weapon-event` status `VERIFIED_NATIVE_STOCK_FLEET_WEAPON_EVENT`). The attacker must have an active linked named pirate identity and actual EveJS attack order; the victim must be an actual native ship in the authoritative stock EveJS mining fleet, not a player ship, arbitrary NPC or nonexistent fleet entry. A named miner remains under the separate named combat witness. Correlate attacker ID, pilot ID, target physical entity ID, and event timing; the observer never writes HP, issues orders, creates wrecks or grants kill credit.

Read-only verification on **Perimeter 30000144** after explicit deployment:
```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld
.\scripts\Local-Two-Client-Test.ps1 -Action StockRaid -WorldSystemID 30000144
```

`StockRaid` returns `AWAITING_STOCK_FLEET_WEAPON_HP_CHAIN` until the **same physical victim** has both a verified weapon event and measured native HP loss. This is stronger than mere target acquisition but **does not prove** a kill, native wreck, persisted loot, a specific weapon's hit or either client's view. Keep `Combat` and `FinalBlow` strict for named-to-named battles; never claim those gates pass based on a stock-miner observation. Player-vs-pirate combat, shared wreck interaction and two-player warp/reconnect still require authenticated in-client validation.

Isolated `tests/coop-stock-fleet-combat.test.mjs` covers attack-order requirement, physical HP deltas, verified native weapon events, player-ship rejection, named-victim separation and cross-target event rejection. These tests are included in `Verify-Local-Coop.ps1`. No Docker, CI, or real two-client execution is claimed in this change.

### Optional stricter stock miner wreck and loot gate

When the upstream EveJS **native** destruction path creates a wreck for a genuine stock mining-fleet ship, `coopStockFleetWreckEvidence` checks the active fleet's ship membership (before the native mining fleet has pruned it), the original destroyed ship object, native wreck store source and launcher IDs, the **physical** wreck entity in the same solar system, and persisted items with positive quantities. It then emits `living-native-stock-fleet-wreck-evidence`. An empty native wreck is recorded honestly as `NATIVE_WRECK_EMPTY` and never counts as nonempty loot.

For an additional stricter read-only gate, run:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action StockRaidLoot -WorldSystemID 30000144
```

It requires one real victim across verified native weapon event, measured HP decrease, physical EveJS wreck, and a nonempty stored loot inventory. Missing or mismatched wrecks, other-system ships, fabricated items, empty wrecks, or wrecks preceding the observed damage cannot pass. If the upstream fleet record is already pruned before the wreck hook, this observer intentionally **fails closed** rather than claiming an unproven stock-fleet origin.

`StockRaidLoot` proves server-side correlation only, **not** final-shot attribution or that either EVE client has successfully opened the wreck. Two authenticated pilots must still verify live shared loot, one-time item withdrawal, coordinated fleet warp and reconnection.

## P0 — native loot withdrawal proof (not just items in a wreck)

A real wreck with persisted items is not yet proof that a real authorized EVE character can withdraw them. The reversible LivingCoop overlay enables **read-only** `EVEJS_COOP_NATIVE_LOOT_EVIDENCE=1`. On a successful upstream EveJS `transferNativeWreckItemToCharacterLocation`, the observer verifies:

- a real physical native wreck in the same solar system, its source entity and unchanged native identity;
- exactly one authenticated in-space character session, with an actual ship physically registered in that EveJS scene;
- upstream's successful native item grant **with a persisted matching inventory change for the intended character, type and destination** and the authoritative wreck-item store changed correctly: a full withdrawal removed the item; a partial withdrawal reduced its quantity by the exact amount.

Only this combination emits `living-native-loot-pickup` with `VERIFIED_NATIVE_LOOT_PICKUP`. If EveJS granted an item but **did not remove/decrement it from the wreck**, it instead emits a source inconsistency status and never certifies the pickup. No new item, synthetic character, fallback wreck or manual loot grant is created.

A separate **read-only** local command requires the full native stock-miner PvE chain (weapon event → physical HP loss → native wreck → nonempty native loot) **plus** a subsequent actual successful pickup by an authenticated character from that **same wreck**:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action LootPickup -WorldSystemID 30000144
```

**Known upstream issue to treat as a test blocker, not a gameplay PASS:** The pinned EveJS native wreck transfer currently grants inventory before decrementing the source wreck item and does not check the result of the full-item deletion. A failed source mutation could leave duplicated inventory. The optional observer flags that state and the **LootPickup acceptance gate hard-blocks with `BLOCKED_NATIVE_LOOT_SOURCE_MUTATION`**, even if another pickup from the same wreck succeeds. It does not change transaction ordering, rollback or native inventory code in an untested shared world. Until real two-client QA demonstrates correct one-time removal and both clients see the updated wreck, shared loot remains **UNVERIFIED**.

Regression coverage: `tests/coop-native-loot-pickup.test.mjs` (authenticated full/partial pickup, exact source debit, missing/duplicate session, incorrect or unphysical wreck, unsuccessful grant, wrong-wreck log, and independent report gate). A green `LootPickup` means **one physical server-side item transfer**, not proof of two real clients, another player's refresh, player-vs-pirate combat, or killer attribution.

### Persistent native wreck-item quarantine

When LivingCoop is explicitly enabled, `EVEJS_COOP_NATIVE_LOOT_QUARANTINE=1` activates an additional **pre-grant** safety gate. If EveJS reports a successful native item grant but fails to remove/decrement the source wreck item, the optional post-transfer witness immediately quarantines exactly `wreckID:wreckItemID` and persists it to `/var/lib/evejs/coop-native-loot-quarantine.json`. Further attempts to claim that specific item return `COOP_LOOT_QUARANTINED` **before** another inventory grant. Other unaffected wreck items remain available.

- The quarantine file is part of the preserved `evejs-data` volume. Do not delete it as a workaround; preserve it with backups and investigate affected inventory/character/source records before manual repair.
- Corrupt quarantine JSON or a failed/uncertain quarantine persistence operation causes a **fail-closed** response, blocking future native loot grants within the running process rather than silently ignoring possible duplication. The quarantined item will remain blocked across restarts when the quarantine record was successfully persisted.
- This guard **limits repeat grants after a detected failure**; it is **not** a full atomic multi-store transaction. The first inventory grant could already have succeeded before the source mutation failed. A process crash between native item grant and writing the quarantine remains a risk, so do not claim that duplicate inventory is impossible.
- The source check runs before the authenticated-session check in the witness; a character disconnecting immediately after a bad native grant cannot suppress the source-debit failure report.
- The pinned upstream `nativeNpcWreckService.js` overlay has been checked with a real source-level simulation: an intentionally failed source remove permits the first upstream grant but marks the item quarantined, the second claim is rejected *before* the grant, and a distinct normal wreck item can still be granted and removed. The source transform is repeatable and exactly reversible.
- Regression: `tests/coop-native-loot-quarantine.test.mjs` covers durable replay, narrow item scoping, corrupt storage and failed writes. The quarantine is disabled outside opt-in LivingCoop.

The next official local proof still requires real authenticated **two-client** EVE gameplay: inspect shared wreck contents, withdraw an item once, refresh the other client, verify the second client cannot withdraw the same item, check both character inventories, then test fleet warp/reconnect without ship loss. No automated acceptance gate can substitute for the missing client evidence.
