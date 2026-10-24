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

## Phase 5 — report and stop

Use `docs/GAMEPLAY_TEST_REPORT_TEMPLATE.md`. Include actual project commit, pinned upstream commit, overlay module presence, actual client build/provenance (without distributing files), event names/counters, short redacted log excerpts or screenshots, and **one concrete next blocker**.

Do not report a global `PASS` for World/gameplay until each requested stage passes; status remains `PARTIAL` or `BLOCKED` where evidence is absent. **Prove the intended mechanic, not the general health of the infrastructure.**

The already-discovered seven npm advisories remain important but **out-of-scope for this gameplay run**; keep loopback binding and record them separately for authorized remediation. Do not pretend an npm audit is a real player experience test.

Related: [HEADLESS_NPC_VALIDATION.md](HEADLESS_NPC_VALIDATION.md), [TWO_CLIENTS_ONE_PC.md](TWO_CLIENTS_ONE_PC.md), [VERIFY_BACKEND_ONE_COMMAND.md](VERIFY_BACKEND_ONE_COMMAND.md), [NATIVE_NPC_GATE_TRAVEL.md](NATIVE_NPC_GATE_TRAVEL.md), [NATIVE_NPC_MARKET.md](NATIVE_NPC_MARKET.md).
