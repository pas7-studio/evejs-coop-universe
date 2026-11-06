# PF86 — original session and actor presence before ItemStore writes

**PR #350 Draft; Personal Fleet OFF; no native WORK/gameplay acceptance.**

## Race addressed

PF58 previously checked player-session and NPC-actor absence while consuming a
durable one-shot PF54/PF58 permit, then moved the original ship through ItemStore
*without another check*. A real player might reoccupy the ship, or another
native writer might have introduced an actor under the same ID in between.

PF86 repeats immediately before original ItemStore.moveShipToSpace:
feature-enabled + reciprocal writer-gate + original GameStore not poisoned;
original session and actor absence; the same real hangared ItemStore ship,
owner, type, flag and location; and the original fitting/cargo hashes.

A failed or unknown read rejects the move. The previously consumed permit
is NOT rolled back, and no automatic replay, duplicate ship or alternate
synthetic NPC spawn is attempted.

## Source-facing provider adapters

The existing native bootstrap module exports two new constructors:
- createOriginalPresenceReaders(sessionRegistry, npcRegistry, nativeNpcStore,
  spaceRuntime) — read-only original live-session, in-process controller,
  stored entity/controller/modules/cargo, and mounted scene checks
- createSourceBoundNativeBootstrap — composes these readers in preference
  to caller-supplied permissive session or actor callbacks

Actual signatures accept named objects; see the module. A provider-shaped
object does not attest its provenance. The eventual original in-process
bootstrap must import genuine EveJS modules and inject all other independent
authorities, including ItemStore, GameStore, station, fitting/cargo and
Mining/WAR/Exploration writer fences.

## Local tests (manual only)

The new pf86-presence-and-prewrite.test.cjs covers nine positive and negative
cases, including the real PF54/PF58 isolated SQLite fixture where an occupied
player session appears *after* permit consumption but *before* ItemStore move.
The regression requires zero original item moves and a permanently consumed
permit. An additional manual source-pin test validates six unchanged original
EveJS provider modules (GameStore, atomic adapter, ItemStore, session registry,
NPC registry and native NPC store) before applying any PF80 patch. A changed
original source fails closed until separately audited and re-pinned.
The PF58 local runner and PF80 Windows WORK runner now include both PF86 tests.

From a clean orchestration checkout on Windows PowerShell:

```powershell
./scripts/pf58/Test-PF58-Local.ps1
./scripts/pf62/Prepare-PF80-CompleteNativeWork.ps1 -NativeCheckout 'C:/Games/EveCoop/upstream-evejs' -ReviewOutput 'O:/tmp/PF86-review-01' -WorktreeOutput 'O:/tmp/PF86-native-work-01' -WorkBranch 'work/pf86-native-review' -ApplyToWork -ConfirmWorkOnly 'WORK-NOT-PLAY'
```

Use fresh review and WORK paths and a clean source-pinned original engine.
No GitHub Actions, PLAY, deployment or merge is authorized.

## Remaining release blocker

The recheck is necessary, **not sufficient**. Without a shared atomic lease
covering the original player-session, Mining, WAR, Exploration and ItemStore
writers, a competing mutation between the final read and write is still
possible. The original EveJS fork remains GitHub-App write-blocked (403).
Real engine bootstrap, native WORK E2E, wallet/payroll, docking, combat,
restart/custody and two authenticated clients remain unverified.
