# EveJS Personal Fleet — First playable WORK source package

**Last reviewed: 2026-11-07. Status: WORK source candidate, NOT gameplay-ready.**
Source branch: [Draft PR #350](https://github.com/pas7-studio/evejs-coop-universe/pull/350).
Keep `main` / `PLAY` untouched; all Personal Fleet flags OFF by default.
No GitHub Actions, resets, auto-retry of unknown effects, or invented NPCs/ISK.

## What the source package actually provides

For the **first physical game smoke**, use a **spare genuine player-owned hangar ship**;
the active player ship is unchanged. Authenticated in-game XMPP/LSC chat commands:
`/pf offers`, `/pf hire <offerID>`, `/pf assign <pilotID> <shipItemID>`,
`/pf deploy <assignmentID>`, `/pf follow <shipItemID>`,
`/pf hold <shipItemID>`, `/pf return <shipItemID>`, `/pf status`.

The native WORK staging includes:

- **Real SDE NPC offers:** `coopPersonalFleetOriginalOfferAuthority.js` obtains an
  existing original named NPC character, authored NPC profile/loadout, real
  corporation, original wallet and server-owned price. The catalog must
  contain genuine local SDE IDs; empty means no offers.
- **Original wallet:** `coopPersonalFleetOriginalWalletAuthority.js`
  uses stock `plexVaultLogState.getTransactionID`, original player and corporation
  wallet readers/notifications and PF53's original SQLite debit/credit journal.
  No separate balance generator, duplicate charge or blind retry.
- **Physical item custody:** PF52 authenticates the spare original ItemStore ship,
  matching paid pilot and typeID **inside** the original
  `[corporationRuntime, items, characters]` SQLite transaction;
  PF54/PF58 handoff preserves the same physical ship `itemID`.
- **Original native actor proof:** `coopPersonalFleetOriginalOrderWitness.js`
  verifies the original PF52 reservation, PF54 ACTIVE assignment, PF actor claim,
  ItemStore hull, original nativeNpcStore entity/controller, live npcRegistry
  controller and the same in-scene physical ship. For friendly FOLLOW, it also
  validates the current authenticated owner, character row and player ship in the
  **same PF55 SQLite transaction** (`characters` added to the two PF55
  issue/reconcile transaction scopes). It rejects a foreign target or stale actor.
- **Shared native order execution:** `coopPersonalFleetOriginalOrderExecutor.js`
  connects original `coopNpcOrderBridge` and `npcRuntime.follow/stop`
  to the *same shared original arbiter* as other NPC directors, with source
  PF52/PF54 assignments and original WAR claim proof. ATTACK/WARP/DEFEND are
  explicitly disabled for first-play. No second private NPC arbiter is created.
- **Stock order-owner patch:** the original arbiter
  `Code/server/src/space/coopNpcOrderArbiter.js` currently **does not accept**
  `PERSONAL_FLEET`; original `coopNpcOrderBridge.js` does not classify it as
  peaceful. `build_original_order_arbiter_patch.py` exact-Git-blob pins and
  patches both source files in the isolated WORK tree only. Without these two
  changes, physical FOLLOW/HOLD cannot be accepted.
- **Trusted composition:** `coopPersonalFleetOriginalWorkBootstrap.js`
  constructs actual PF52/53/54/55/56/58 adapters and the native order witness,
  shared order executor, payment authority and chat gateway. It installs
  `/pf` **last** and fails sticky on a partial native installation.
  No caller-supplied stock session, ItemStore, GameStore or native controller.
- **Native XMPP hook:** exact original `chatCommands.js` source-pinned patch;
  no new unauthenticated HTTP API or client modification.
- **Isolated review assembler:** PF80's **22-file** preflight candidate +
  this **19-path** original source delta (four overlap with PF80) =
  **37 unique staged native paths**. The generated patch includes both
  original NPC order source files, PF55 original character row scope,
  PF52 original paid hull row scope, wallet corrections, new modules
  and the original chat hook. It must pass exact Git `apply --check`.

### Real execution evidence

**239/239 Node tests PASS** on Node.js 22.16.0, including original-source
actor/target identity, stock runtime command wiring, paid offers, wallet
receipts, bootstrap fail-sticky and in-memory EVE service adapters.
**26/26 Python/Git tests PASS** on Python 3.13.5; exact original stock
blob pins, patch transforms, `git apply`, manifest and linked-worktree gates.

**Previous baseline: 265/265 PASS. New PF56/60/61/66 local tests: 66/66 PASS. Full combined regression on this PR head has NOT RUN. 32 source/test files SHA256-pinned.**
These are isolated component and controlled SQLite/VM tests.
Original EveJS server and connected game-client E2E are **NOT RUN** here.
Manual Windows PowerShell runner is **NOT RUN** here.

## Manual local read-only component check

From the synchronized PR #350 orchestration checkout:

```powershell
.\scripts\personal-fleet-firstplay\Test-FirstPlay-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

This checks source hashes against the original, **unpatched** native fork.
Source drift is a hard stop requiring an actual code review; never reset or
delete a user's local edits to satisfy a hash.

## Stage into an isolated WORK native Git worktree

First follow `AGENTS.md`, `state/NOW.md`,
`docs/TWO_STACKS_PLAY_AND_WORK.md` and
`docs/GAMEPLAY_TESTING.md`. Preserve existing volumes and dirty changes.
Paths below are examples; use the machine's real WORK and review locations.

```powershell
.\scripts\pf62\Prepare-PF80-CompleteNativeWork.ps1 `
 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
 -ReviewOutput 'O:\tmp\pf-firstplay-pf80-review' `
 -WorktreeOutput 'O:\tmp\pf-firstplay-native-work' `
 -WorkBranch 'work/personal-fleet-firstplay' `
 -ApplyToWork -ConfirmWorkOnly 'WORK-NOT-PLAY'

python scripts/personal-fleet-firstplay/tools/prepare_firstplay_work.py `
 --worktree 'O:\tmp\pf-firstplay-native-work' `
 --source-root . `
 --pf62-manifest 'O:\tmp\pf-firstplay-pf80-review\PF62-MANIFEST.json' `
 --review-output 'O:\tmp\pf-firstplay-native-review' `
 --apply-to-work --confirm-work-only 'WORK-NOT-PLAY'
```

Both review output paths must be fresh and outside the native WORK tree.
The assembler checks the exact native worktree changes and `node --check`
on every affected file. It **does not install a server startup hook**,
launch Docker, enable Personal Fleet or authorize PLAY.

## Original engine integration still required — CODE blockers

Do **not** confuse this staged package with gameplay-ready. The native
`pas7-studio/EveJS` fork still needs actual source commits for:

1. A genuine server-startup invocation plus a WORK-authored, source-owned
   `coopPersonalFleetOriginalWorkHooks.js` whose methods inspect the real
   wallet, ItemStore/player/Mining/WAR/Exploration writers and native scene.
   Supply the **existing shared original NPC arbiter**, not a newly-created
   instance, and a real original WAR registry claim reader.
2. Source-owned physical PF58 original-ship handoff/actor adoption and its
   postcommit scene/world notifications, with original controller writer
   fences. The original physical hull must retain its itemID.
3. The **durable original NPC order ACK code is now staged**, not installed.
   Apply and test `coopPersonalFleetOriginalDurableOrderAck.js` with the original
   server's `npcEntities` atomic SQLite table. A real WORK kill/restart must
   confirm that persisted FOLLOW/HOLD movement is rehydrated and PF55 can ACK
   it without a second physical command. In-memory success alone is rejected.
4. PF66 stock ItemStore docking, PF60/61 native scene cleanup and PF56
   completion/readback are now CODE-WIRED in the source candidate. However,
   original source-owned RETURN flight, continuous station dwell/arrival
   monitoring and true native WORK restart proof remain outstanding.
   Never teleport or delete an item without the original receipts.
5. A real work-only catalog of existing SDE NPC character/profile/ship
   combinations. The operator must source authentic IDs; do not invent NPCs.
   Broader PF57 salaries, losses, dismissal, multi-NPC combat/mining and
   exploration need separate native acceptance later.

**Native GitHub write access remains blocked (HTTP 403)** for this connected
session. Local engine-writing agent with the real `coop/pas7std` checkout
must perform these source changes, build isolated WORK, collect authenticated
client gameplay proof and original node/SQLite SIGKILL recovery, then repair
failures. This cloud session has **not** modified the real native engine.

### First game acceptance

Real hire deducts original ISK exactly once; actual spare ItemStore hull
retains its physical ID; a genuinely spawned native NPC visibly FOLLOWs and
HOLDs the connected player, returns and docks to the original station
without duplicate hull or controller, remains correct after restart, and
a second character cannot take it. Record original engine SHA, WORK image,
GameStore/wallet/ship evidence and client observation. No PLAY activation
without a separate explicit approval after WORK proof.

### Full WORK patch assembly review gate

The assembler now verifies **unique** native patch destinations before
calling `git apply --check`. This catches repeated stock-source hunks,
including duplicate original `coopNpcOrderArbiter.js` edits, which individual
unit tests otherwise would not detect. Its expected exact set is **15 unique
native paths**, four already staged by PF80, and **37 unique final WORK paths**.
The two original stock order files are source-pinned and their anchors were
independently checked against the `coop/pas7std` fork. The full original
WORK `git apply --check` on the owner's machine remains unexecuted here.


## Original durable PF55 FOLLOW/HOLD movement receipt (2026-11-07)

New staged native module: `coopPersonalFleetOriginalDurableOrderAck.js`.
This closes the *candidate-code* gap between live physical movement and a
durable PF55 ACK. It runs **only after** the original common NPC order bridge
and native `npcRuntime.follow/stop` return verified synchronous success.

The receipt writer independently verifies the PF55 `ISSUING` operation and
exact signature/index, PF52/PF54 original ship/controller claim, original
ItemStore title, original in-scene movement (`FOLLOW` target and range or
`STOP`), and live authenticated player target. It then writes the
actual original `npcEntities['/'].entities[shipItemID]` movement fields
(`mode`, `targetEntityID`, `followRange`, coordinates/velocity) **and
the PF55 native applied receipt in one original GameStore
`[corporationRuntime,items,characters,npcEntities]` SQLite transaction**.
The exact original `nativeNpcService` restore path already consumes these
fields. PF55 reconciliation now declares `npcEntities` and verifies the
durable receipt and unchanged movement-command identity itself.

If a crash occurs after the physical effect but before this atomic commit,
PF55 remains `ISSUING`, without an ACK or automatic second movement.
If the commit succeeds, the new PF55 owner can verify the receipt after
a simulated process restart; normal position changes do not invalidate it.
Changing the target, assignment, actor generation or mode does.

**Execution evidence**: 239/239 Node (including 19 actual SQLite durable
receipt cases and integrated bootstrap/executor tests), plus 26/26
Python/Git, **265/265 previously PASS; 66/66 newly added dock tests PASS; full combined regression NOT RUN.** **32 SHA256-pinned code/test files**;
19 unique additional native patch paths over PF80's 22 source paths,
four overlapping, producing 37 unique modified native files.

**Not yet WORK gameplay:** Original GameStore refuses transactions on
`npcEntities` while transient native rows are not safely quiescent; this
receipt intentionally fails closed instead of writing over them. The local
native owner must verify that gate and the actual original npcRuntime mode,
then run real SIGKILL/client E2E. This receipt proves accepted durable
movement state, **not uninterrupted offline NPC AI or station docking**.
PF56/PF66/PF60/PF61 docking is source-wired but original RETURN flight, station arrival/dwell and native WORK gameplay remain P0.


## Sessionless physical dock + original NPC cleanup source chain — 2026-11-07

Added and tested:

- `native/coopPersonalFleetOriginalDockCompletionWitness.js`: PF56 dock readback
  checks original physical ItemStore title at the correct station; PF66 native
  dock+scene detach **durable consumed attempts**; PF60 `NATIVE_CLEARED`
  terminal row and PF61 scoped native cleanup attempt; no original native
  NPC entity/controller/modules/cargo, no runtime controller, no duplicate
  physical scene entity in any mounted system. It independently checks the
  final original fitting/cargo manifest before granting any dock receipt.
  **It does not move, create or destroy any item.**
- `native/coopPersonalFleetOriginalTerminalDockSources.js`: source-owned PF60/61
  command authentication, original entity/controller/scene witness, stable
  terminal receipt across PF56 `DOCK_ISSUING → DOCKED`, original ItemStore
  and unique item ID checks. No user-supplied terminal receipt.
- `native/coopPersonalFleetOriginalDockCoordinator.js`: one-shot ordered
  `PF66.execute → PF60.prepare → PF60.issue(PF61 scoped cleanup) →
  PF60.reconcile`. After restart, `reconcileNativeCleanup` may only read
  original durable state and reconcile; it NEVER dispatches PF66 or PF61
  again. `finalizeAfterPf56Dock` delegates to PF60, whose original source
  enforces PF56's committed `DOCKED` state and releases the final lock.
- `native/coopPersonalFleetOriginalWorkBootstrap.js` now constructs PF66,
  original PF60/61 and both source-bound dock witnesses from original EveJS
  module singletons, then publishes /pf only after the complete composition
  succeeds. Removed external `executeNativeDock` and
  `verifyOriginalDockReceipt` hooks. Original PF66/PF61 code flags are hard
  prerequisites. This source remains **OFF** until real native writer hooks.

The WORK package now has **19 exact additional native paths** atop PF80's
22 staged paths; four paths overlap and **37 unique native files** are staged.
All 32 source/test files have SHA256 manifest entries. The manual Windows
runner has 12 Node suites and is configured to announce its combined PASS
only after every suite succeeds on the user's machine.

**Executed here:** 66/66 new Node VM/source-contract tests, including 35
PF56 completion, 16 PF60 terminal source and 15 one-shot cleanup-coordinator
cases. Prior source baseline 265/265 passed before these changes. Full
combined current-head test run, native WORK startup, real station flight/dwell,
real ItemStore+NPC cleanup after kill, and two-client gameplay **NOT RUN**.

Outstanding CODE/WORK work: authentic native source startup invocation and
writer hooks, a real continuous station dwell monitor and original return-flight
witness, plus observed crash-recovery on the running original server. A
`DOCKED` response cannot be claimed until PF56 independently reconciles
and PF60 finalizes the actual original ship. Do not touch PLAY.
