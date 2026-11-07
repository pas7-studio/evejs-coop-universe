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
  this **15-path** original source delta (four overlap with PF80) =
  **33 unique staged native paths**. The generated patch includes both
  original NPC order source files, PF55 original character row scope,
  PF52 original paid hull row scope, wallet corrections, new modules
  and the original chat hook. It must pass exact Git `apply --check`.

### Real execution evidence

**216/216 Node tests PASS** on Node.js 22.16.0, including original-source
actor/target identity, stock runtime command wiring, paid offers, wallet
receipts, bootstrap fail-sticky and in-memory EVE service adapters.
**25/25 Python/Git tests PASS** on Python 3.13.5; exact original stock
blob pins, patch transforms, `git apply`, manifest and linked-worktree gates.

**241/241 total locally; all 24 candidate/test files SHA256-pinned.**
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
3. A **durable original NPC order ACK** reader/writer that independently
   verifies PF55's accepted physical FOLLOW/HOLD after a crash. A successful
   in-memory `npcRuntime.follow()` is **NOT sufficient** to mark PF55 ACKED.
4. Real source-owned PF56 sessionless RETURN/docking and exact original
   ItemStore/scene cleanup and crash recovery. Never just teleport or
   delete a ship after an unverified arrival.
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
