# EveJS Personal Fleet PF-56 — Original Return & Dock (native integration candidate)

**NOT GAMEPLAY READY. OFF by default. Original fork and PLAY unchanged.**

The PF-56 candidate extends PF53 paid hire → PF52 original hangar reserve →
PF54 original player-owned ship deployment → PF55 durable commands with a
non-spoofed, crash-fenced Return-to-Base and sessionless docking protocol.

## Code

- `native/coopPersonalFleetReturnDock.cjs` — original SQLite `corporationRuntime` + `items` single-flight RETURN_ISSUING/RETURNING/ARRIVAL_OBSERVED/DOCK_ISSUING/DOCKED and one-commit PF actor + roster + hangar release.
- `native/coopPersonalFleetNativeReturnExecutor.cjs` — included in the PF78 source-pinned WORK bundle (previously omitted); actual EveJS `npcRuntime.warpToPoint` API adapter routed through `PERSONAL_FLEET` order bridge; live native station observation gate. Neither invents a ship or spoofs a character session.
- `deps/*` — pinned reference dependencies solely for local tests. Never register these as original live server authorities.
- `tests/*` — Node 22 `node:sqlite` tests with real `SIGKILL` child processes and a **synthetic native controller, ItemStore and station**. Native stock source and WORK E2E are **not** executed.

PF78 now requires exact physical Personal Fleet actor and controller metadata
for both return movement and station-arrival evidence, not merely an existing
`itemID`. The shared `scripts/pf55/native/coopPersonalFleetNativeActorProof.cjs`
rejects a foreign controller, reused player ship, incorrect assignment or
session. Any claim in SQLite is still separately proven by the caller.

## Local source / SQLite regression

```sh
node --test tests/pf56-return-dock.test.cjs tests/pf56-native-api.test.cjs tests/pf56-sqlite-sigkill.test.cjs
```

From the orchestration PR root:

```powershell
.\scripts\Test-PersonalFleet-PF46-56-Local.ps1
```

Optional read-only original native source hash preflight:

```powershell
.\scripts\pf56\Test-PF56-Local.ps1 -NativeWorktree 'C:\path\to\EveJS'
```

`node:sqlite` is experimental on Node 22. Windows skips SIGKILL tests; Linux verification is mandatory before WORK acceptance. The tests are strictly local/manual. No GitHub Actions, no PLAY mutation.

## Acceptance and limitations

The module refuses to release PF actor ownership when original ItemStore
hangar/title, original NPC entity+controller retirement, original cargo/fitting
manifest, or continuous native station dwell cannot be confirmed. After a crash,
unknown Return/Dock outcomes cannot automatically replay external effects.

**Critical:** Original `nativeNpcStore.removeNativeEntityCascade()` removes its
original modules and cargo. It must never be used as an easy docking cleanup.
The real native sessionless cargo/fitting custody transfer and persisted dock
receipt do **not** exist in this candidate. See `docs/ORIGINAL_DOCKING_GATES.md`.

GitHub write into `pas7-studio/EveJS` previously returned 403; do not merge or
claim feature active until original integration and WORK two-player E2E pass.
