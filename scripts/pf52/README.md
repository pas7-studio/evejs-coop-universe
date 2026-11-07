# PF-52 — Original ItemStore Hangar Reservation & Verified Paid-Hire Enrollment

**2026-11-05 — REVIEW CANDIDATE ONLY / NOT GAMEPLAY READY.** This standalone package targets original `pas7-studio/EveJS` branch `coop/pas7std`. It does **not** turn on Personal Fleet and does not change PLAY or native engine repositories.

## What is implemented

`native/coopPersonalFleetHangarBridge.cjs` is a zero-dependency Node/CommonJS native adapter for original `gameStore.coopAtomicNativeRows.transact(['corporationRuntime','items'], mutation)`. It keeps two canonical `corporationRuntime` rows (global pilot/ship index + one player roster) with exclusive, idempotent, CAS-revisioned operations. The actual stock ItemStore `items/items` row is read in the **same original SQLite BEGIN IMMEDIATE** transaction. No new ship item, extra inventory authority, synthetic NPC or fabricated ISK is created.

Commands:

- `IMPORT_PAID_HIRE`: enrolls **only** an existing original paid employment/agent/wallet contract whose receipt is independently verified by the trusted native `verifyPaidHire(command,tx)` binding. **This DOES NOT charge ISK or create an NPC.**
- `RESERVE_HANGAR_SHIP`: checks original ItemStore `itemID`, `ownerID`, station location, stock hangar flag **4**, ship category **6**, singleton **1**, original ship type, and non-space status; rejects active PF/WAR claims and all unverified competing writers. Reserves only the **existing ship**, not an NPC entity or a new ship item.
- `RELEASE_HANGAR_SHIP`: checks exact `pilot`, `shipItemID`, `assignmentID`, roster/pilot revisions and monotonic ship generation plus independent original non-deployed/wreck-free proof before releasing; stale ABA cannot release a newer reservation.
- `inspect`: authenticated owner-only, read-only roster view, no inventory or wallet mutation.

All operations default OFF. The native adapter intentionally takes `enabled()` and `allWritersFenced()` from trusted process-local code; neither client JSON nor a feature toggle alone constitutes evidence that original ItemStore ownership writers, WAR, Mining, Exploration, docking, deployment and PF-01 actor claims consult the same reservations.

**Note:** PF-52 stores `hangar-roster-v1` as a native candidate. It is *not yet reconciled/migrated* to existing PF-02 reference roster. Both may not be independently enabled as separate ownership authorities. PF-01 actor claims track **spawned entity IDs**; PF-52 tracks **stock ship item IDs**. Both must be atomically linked during actual native deployment, currently absent.

## Run locally

```powershell
node --version  # Node >= 22.16 recommended for built-in SQLite tests
node --test .\scripts\pf52\tests\pf52-hangar.test.cjs .\scripts\pf52\tests\pf52-sqlite-sigkill.test.cjs
.\scripts\pf52\Test-PF52-Local.ps1 -ForkRoot 'C:\Games\EveCoop\upstream-evejs'
```

From this standalone ZIP root, run:

```powershell
.\Test-PF52-Local.ps1 -ForkRoot 'C:\Games\EveCoop\upstream-evejs'
```

The runner is read-only. Git blob pins are for the original unmodified stock engine sources; if PF49–51 have changed a source, the **source pin failing is expected** and requires reviewed re-baselining. No auto-patch or rollout.

Local test evidence: **49/49 PASS** (Node 22.16.0, original SQLite APIs emulated through a `node:sqlite` isolated fixture; real `BEGIN IMMEDIATE`, `synchronous=FULL`, rollback and 4 actual child-process `SIGKILL` scenarios). Combined regression PF46–52 **237/237 PASS** when run locally in the same container, including all previous candidate tests. These are **not** WORK or two-player gameplay E2E.

## Deployment blockers

1. Original native `verifyPaidHire` must check an original authoritative paid wallet/agent employment receipt in the same snapshot. The existing CH24+31 corporate shift hire is NOT personal NPC employment; do not map it automatically.
2. Original ItemStore move, sell, contract, trade, repackage, active-ship and station writers **must** consult PF-52's reservation row in the same original GameStore authority before changing reserved item custody. This is not patched here.
3. Original PF-02 roster migration and PF-01 actor-claim/deployment handshake are not wired. `allWritersFenced()` cannot truthfully be ON yet.
4. Original paid contract payroll, persistent NPC pilot entity, fitting, controller and docking order integration and UI are not implemented here. No live fleet is hired or deployed.
5. Engine repo `pas7-studio/EveJS` write access returned **GitHub API 403** during this task; native fork not changed, compiled, smoke tested or run in WORK.

**PERSONAL FLEET OFF · PF-42 mutual exclusion stays · no main merge · no GitHub Actions · no PLAY changes.**