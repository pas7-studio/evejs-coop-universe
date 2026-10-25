# EveJS headless telemetry recovery — safe, evidence-first

**Issue:** Docker/market/backend can be healthy, but `/var/lib/evejs/coop-events.jsonl` is absent.
A working client is NOT required for the initial headless startup evidence.
Do not manufacture a boot event, reset the world, rebuild the market, reinstall clients, run GitHub Actions, or discard local source fixes.

## Implemented corrective changes

- `coopRuntimeProbe.cjs` no longer silently ignores an unset `EVEJS_COOP_EVENTS_FILE`: the running server warns once with `BLOCKED_TELEMETRY_CONFIG`. Any write failure warns with a sanitized error code (`BLOCKED_TELEMETRY_WRITE_*`); gameplay remains unaffected.
- `coopVirtualWorldRuntime.cjs` now emits **`living-startup-entered` before creating the persisted virtual world and NPC life state**. A restore failure emits `living-startup-failed` with `BLOCKED_PERSISTED_WORLD_INIT` and a sanitized category before rethrowing to the existing upstream startup catch. Neither event means a native scene is ready. No corrupted state is reset or rewritten.
- The normal `living-headless-boot-requested` event remains owned by the real headless scheduler. The authoritative `World` gate requires native topology, fleets, physical NPCs and sampled movement + interaction; none of these can be satisfied from the new early diagnostic marker.

## On the existing Windows host: first diagnose read-only

```powershell
cd C:\Games\EveCoopProject
.\scripts\Diagnose-Coop-Telemetry.ps1 -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

The diagnosis reads only the actual `server` process: effective flags, installed module existence, startup hook, file read access, volume-directory writeability, recent event counters, and installed vs project source SHA256. It never touches `evejs-data` or changes containers. If source SHA differs, the **running image is stale**; a local `git pull` without a rebuild will not fix the live world.

| Diagnostic | Interpretation and single next action |
| --- | --- |
| `START_HOOK: ABSENT` | Overlay startup hook not installed in running image; verify pinned source and deployment provenance |
| `CONFIG_HEADLESS_BOOT: DISABLED` or `CONFIG_VIRTUAL_WORLD: DISABLED` | Actual container has wrong environment; compare effective Compose config, not just local YAML |
| `CONFIG_EVENTS_PATH: MISSING_OR_DIFFERENT` | Running process lacks `/var/lib/evejs/coop-events.jsonl` setting |
| `DATA_VOLUME_DIRECTORY: NOT_WRITABLE` | Check mounted directory ownership/permissions; do not use broad `chmod -R` |
| `INSTALLED_*_SHA256` differs from `PROJECT_*_SHA256` | Running image has old overlay. Preserve local changes; use the existing pinned reversible installer only after reviewing diff and with permission for controlled restart |
| `EVENTS_FILE: ABSENT_OR_UNREADABLE`, all code/flags present | Check server logs for `[CoopProbe]`, `[CoopVirtualWorld]`, `[CoopLivingWorld]`; identify restore/read/write failure |
| `START_FAILED_COUNT > 0`, `BOOT_REQUESTED_COUNT = 0` | Existing virtual world/NPC state cannot load; inspect exact error and back up data first; never auto-reset |
| `BOOT_REQUESTED_COUNT > 0` | Writer and scheduler were observed; continue read-only `-Action World`. This is not a native NPC PASS |

## Applying the fix to an already running container

Committing the source does **not** change the running Docker image. A controlled overlay install/build/restart is required before new startup events can be emitted. **Do not run that automatically** from a QA/diagnostic command. First record exact project/upstream SHA, `git status --short` for both checkouts, image SHA, latest QA report and a verified backup of the named volume. Preserve local uncommitted upstream test fixtures. Only after an explicit operator-approved maintenance window, run the existing pinned reversible deployment workflow and repeat the diagnostic.

For safety, the telemetry fix has no privileged remote access and cannot diagnose the user's Windows container from a GitHub PR alone. `BLOCKED_LIVE_HOST` remains until real runtime output is supplied.

## Manual tests

```powershell
node --test tests/coop-runtime-telemetry.test.mjs tests/coop-telemetry-wiring.test.mjs tests/coop-headless-startup-evidence.test.mjs
```

These tests prove write/config errors, startup order, early failed-restore evidence and no synthetic boot. They are not proof of playable clients or autonomous NPC activity.