# EveJS Personal Fleet PF-56 — Original Return & Dock (native integration candidate)

**NOT GAMEPLAY READY. OFF by default. Original fork and PLAY unchanged.**

The PF-56 candidate extends PF53 paid hire → PF52 original hangar reserve →
PF54 original player-owned ship deployment → PF55 durable commands with a
non-spoofed, crash-fenced Return-to-Base and sessionless docking protocol.

## Code

- `native/coopPersonalFleetReturnDock.cjs` — original SQLite `corporationRuntime` + `items` + `characters` single-flight RETURN_ISSUING/RETURNING/ARRIVAL_OBSERVED/DOCK_ISSUING/DOCKED and one-commit PF actor + roster + hangar release.
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

## PF83-B combat-to-return transition (native one-shot)

The stock `npcBehaviorLoop.issueManualOrder(ATTACK)` promotes an otherwise
valid live PF controller to `nativeCombat`. Before PF56 sends a Return-to-Base
warp in that state, its original native executor now requires a successful
`npcRuntime.stop(ship,{allowSessionlessWarpAbort:false,issueStopOrder:true})`
and a second scene/controller read verifying `manualOrder.type === 'stop'`
and `currentTargetID === 0`. A STOP error or misleading success blocks warp.
The durable PF56 return attempt is one-shot; no automatic retry is allowed.
PF83's separate current-station-position read remains inside the native
order-bridge callback. This is unit/ABI coverage, not actual game docking.
Run `node --test scripts/pf56/tests/pf56-native-api.test.cjs` manually.
Read `scripts/pf62/PF83_RETURN_SOURCE_AND_MANUAL_GATE.md` for evidence.

## PF84 — offline original-owner reauthorization (2026-11-07)

The initial `requestReturn` is still a real session-authenticated
player command. It now persists `requestedByAccountID` in the one-shot
`RETURN_ISSUING` row. After the player disconnects, the internal-only
`advanceServer(row)` refuses to proceed without that previously committed
intent and an independent read of the original `characters` SQLite row
proving the same account still owns a non-deleted character.

An original server scheduler may reconcile the persisted return, validate
station arrival and continuous dwell, then dispatch one authorized dock
and independently reconcile the physical hull and controller cleanup.
There is no synthetic player session and no second native warp/dock after
an uncertain external effect.

**The original durable RETURN flight/receipt authority remains unimplemented**
in this staging package; source binding and true WORK gameplay are not
confirmed. The new fixture tests and first-play PowerShell runner provide
local verification paths, not evidence of live gameplay.
