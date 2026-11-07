# EveJS Personal Fleet — First playable WORK source package

**Last reviewed: 2026-11-07. Status: WORK source candidate, NOT gameplay-ready.**
Source branch: [Draft PR #350](https://github.com/pas7-studio/evejs-coop-universe/pull/350).
Keep `main` / `PLAY` untouched; all Personal Fleet flags OFF by default.
No GitHub Actions, resets, auto-retry of unknown effects, or invented NPCs/ISK.

## PF96/PF97 — crash-safe combat re-adoption + reactive owner GUARD (2026-11-08)

**Current staged WORK inventory:** PF80's 22 baseline native paths + a
**39-path** first-play delta, with four overlaps = **57 distinct original
native paths**. The corresponding manifest has **75 SHA256-pinned**
source/test/tool files. Historical counts below are superseded.

**PF96 — physical combat after restart.**

- The original native NPC materializer discards the live `manualOrder`
  on spawn. PF96 reads back an **ACKED** PF55 operation, the same original
  PF95 SQLite combat receipt, stored controller, original actor claim and
  CURRENT physical player/target. Only then can the original shared
  `coopNpcOrderBridge` readopt the prior order on the same entity ID.
- A recovered native ATTACK older than ten minutes, an absent/foreign
  target, a changed owner, a conflicting live manualOrder, a missing
  shared arbiter lease or unknown native outcome is **blocked**.
  No new PF55 ISSUING transaction, second wallet event, new ship, or
  automatic blind retry. Active same-owner GUARD leases are periodically
  retained by the **existing shared original arbiter** rather than
  expiring while the physical FOLLOW remains active.
- PF96 runs in the existing source-owned PF56 server timer after
  physical actor recovery, at most once per second.

**PF97 — real NPC guard reaction to applied damage.**

- Source-pinned original `combat/killmailTracker.js` invokes the new
  **passive** guard witness only after actual positive damage.
  The witness requires a genuine live attacker NPC and its native
  controller, one authenticated owner's physically present player ship,
  the same original scene and session, and a fresh bounded incident.
  The damage callback never executes a wallet, NPC order or SQLite
  mutation.
- The guard reaction selects only the owner's already-active **ACKED
  PF55 DEFEND** pilot/hull in the original PF52 roster/claim, with
  matching original ItemStore ship, deployment, latest order, account
  and session. It derives a deterministic retaliation operation ID,
  asks the **shared original order arbiter** for preflight permission,
  then issues and reconciles the actual PF55 ATTACK once. Uncertain
  outcomes are process-sticky and never redispatched.
- The source-pinned original `npc/npcBehaviorLoop.js` keeps its ordinary
  friendly NPC protection. Only a claimed Personal Fleet native NPC
  with a current signed PF55 ATTACK on the **exact real attacker** of
  its own owner (proven by the original positive damage event) can
  narrowly override that NPC-vs-NPC friendly veto. No general permission
  to attack players, own corporation, CONCORD, unrelated NPCs or
  competing WAR/MINING ships is created.
- Both source patches pin the exact original `coop/pas7std` blobs and
  fail on drift. The existing PF56 server tick hosts the 1s guard
  reaction; there is no extra timer or new public command.

**Isolated checks executed in controlled V8/faux-SQL contexts:**
combat recovery **12/12**, station/guard server tick **29/29**,
bootstrap **42/42**, original order witness **30/30**, applied-damage
witness **10/10**, automatic guard reaction **11/11**, stock target
policy **9/9**, original combat receipt **11/11**. Both source-pinned
original damage/hostility transformations also compile when applied to
the matched original JavaScript sources. These are NOT two-player
native EveJS E2E results.

**Full gameplay NOT yet certified:** genuine native WORK installation,
real original SQLite/SIGKILL two-client battle, automatic guard reaction
to every possible damage source, physical hits/killmails/wreck custody,
stale post-crash combat reconciliation and independent original writer
configuration remain outstanding. A player-directed attack on a passive
NPC with no legitimate original hostility or applied-damage evidence
may still be refused by the stock combat policy. Do not merge, mark
playable or enable this draft on PLAY without those checks.

## PF95 — native ATTACK + owner GUARD and original controller receipt (2026-11-08)

**Latest staged source inventory:** 22 PF80 baseline + **34-path** first-play
WORK delta with four overlaps = **52 distinct native paths**; **66**
SHA256-pinned source/test/tool records. All earlier dated counts below
are historical.

**Native gameplay commands** (no new server/HTTP API):
- `/pf attack <shipID> <enemyNPC>`: physical original
  `npcRuntime.issueAttackOrder`, with `allowPodKill:false` and explicit
  original hostile target authority. Requires original ItemStore ship,
  original actor generation/claim, real SDE-native NPC and the **stock**
  `npcBehaviorLoop.isValidCombatTarget` verdict. Player targets,
  CONCORD, own and protected targets are not legal through this command.
  When original faction/hostility policy refuses a target, ATTACK is
  blocked, not falsely reported as combat-ready.
- `/pf guard <shipID>`: physical `npcRuntime.issueOrder` disarms
  hostile weapons **before** original `npcRuntime.follow` trails the
  authenticated owner's physical player ship. The protected target is
  derived exclusively from the genuine logged-in owner's source, never a
  caller-supplied entity. Native owner-writer and shared NPC arbiter
  both verify the ship.
- PF95 uses the **existing** common `coopNpcOrderBridge` and
  `coopNpcOrderArbiter`; the source-pinned bridge patch preserves
  peaceful stock directors while admitting Personal Fleet combat only
  under its own existing, non-preemptive native order lease. Other NPC
  directors cannot take a foreign or unknown active actor.
- The PF55 original issue transaction continues to persist a one-use
  `ISSUING` intent *before* the stock attack/guard effect. New
  `coopPersonalFleetOriginalCombatReceipt.js` commits the **genuine
  original** `npcRuntimeControllers/controllers\u001f<shipID>` row,
  entity movement row, and immutable PF55 combat receipt in **one**
  original SQLite transaction; unknown commit is never automatically
  redispatched. PF55 reconciliation reads and verifies all three rows,
  including live owner/target proof and canonical operation signature.

**Isolated source checks this stage:** stock target/guard authority
**9/9**, original atomic combat receipt **10/10**, original native
shared-bridge commands **27/27**, authenticated `/pf` gateway
**46/46**, command owner **35/35**, bootstrap composition **42/42**,
and **33/33** exact original PF52/55/53/57 native source
transformations compiled in controlled V8. Original stock arbiter
blob pins were independently checked against EveJS.

**Still NOT a fully reactive combat/guard system:** Auto-retaliation
when the protected player is attacked is not connected to stock native
aggression events. The original native service clears `manualOrder`
on controller materialization after a restart; persistent combat orders
need a verified re-adoption under the stock arbiter before they can
continue safely. General pirate eligibility depends on genuine stock
NPC hostility/faction policy, not only passing a command. Physical
combat damage/kills/wrecks, a two-player WORK play test and SIGKILL
recovery have NOT been run. This remains a **Draft, OFF, unmerged**
source-pinned WORK package, not a playable release.

## PF94 — original physical PF56 RETURN mid-flight recovery (2026-11-08)

**Latest code inventory:** first-play **32-path** native WORK delta,
over PF80's **22** source paths with four overlaps =
**50 distinct original native paths**; **62** source/tool/test SHA256 entries.
Older inventory values below are historical snapshots.

This stage implements genuine **in-flight return-warp reconstruction** rather
than blindly redispatching the original warp:

- New `coopPersonalFleetOriginalIngressProof.js` records the live
  `sessionlessWarpIngress` from the already-issued, original
  `npcRuntime.warpToPoint` call. It verifies departure coordinates against
  the original live physical actor, genuine canonical station position and
  live station-ball radius, original NPC owner, period, destination and
  bounded flight duration. A stale stored movement position is allowed
  only when the *real* original live position is independently witnessed.
- `coopPersonalFleetOriginalDurableOrderAck.js` now commits the
  `personalFleetReturnIngress` snapshot and its cryptographic receipt hash,
  the observed physical departure, original `mode: WARP` and the existing
  PF56 one-shot acceptance in the **same original GameStore SQLite
  transaction**. Any missing original ingress or commit-unknown outcome
  refuses the source proof; it never creates a second movement.
- New `coopPersonalFleetOriginalIngressRecovery.js` re-verifies the PF56
  operation index, original return receipt, native NPC entity row,
  immutable signed ingress, unchanged player/account, original native
  controller, exact station and time window. It restores only the original
  **in-memory sessionless interpolation** on the same materialized
  ItemStore-backed NPC actor: no new ship, ISK, NPC profile, warp, docking
  acknowledgement or teleport.
- PF90 physical restart now uses this source evidence before materializing
  any WARP actor, and reattaches physical ingress only after the original
  stock materializer succeeds. Already-resumed valid ingress is idempotent.
  No original durable proof = **BLOCKED**, not an auto-generated warp.

**PF53 direct-money-writer consent defense:** Also fixed a bypass left in
PF92: the original PF53 source now rejects direct paid-hire invocations
without `recurringSalaryAcknowledged === true`, and includes that bit in
its source-owned operation signature. The native command owner supplies
the bit only after parsing the explicit `accept-recurring` token.
The original source-pinned build was rechecked: **32/32** exact native
replacements (PF52 1, PF55 1, PF53 13, PF57 17) compile. PF92 consent
regression now **15/15** in the controlled V8 harness.

**Scope limitation:** This specifically covers PF56 in-progress **return to
a station** with an unexpired, original native ingress snapshot. It does
**not** yet resolve already-expired warps after a long server outage, or
unacknowledged/other role-specific combat, mining, wormhole and expedition
travel. Those require separate native arrival/reconciliation witnesses;
blocking them is intentional to avoid moving a ship without physical proof.

**Tests executed in a controlled mocked V8 harness:** ingress capture
**14/14**, proof-driven source recovery **13/13**, PF90 source integration
**23/23**, original PF55/PF56 post-effect SQLite-shaped ACK **32/32**
(including the live-departure correction).
Actual original Node/SQLite, source installation and SIGKILL two-client
gameplay tests are still required. `main` and `PLAY` remain unchanged;
source feature flags remain OFF.

## PF92/PF93 native recurring wage consent + unattended payroll — 2026-11-08

**Latest source revision:** PF80 **22** baseline native paths + first-play
**30** incremental WORK patch paths, 4 overlaps = **48 distinct staged native
paths**. **58** source/test/tool SHA256 entries. This replaces all older dated
counts below; the package is still **OFF** until installed and tested on the
real original native server.

**PF92 — immutable informed recurring salary acceptance.**

- The genuine original SDE NPC offer explicitly contains a hire payment,
  `salaryCents` and `periodMs`; the quote source proof binds both terms.
  `/pf offers` shows recurring wage, not only the one-off hiring tariff.
- The client command is now
  **`/pf hire <offerID> accept-recurring`**. The previous one-argument
  hire is rejected at both original chat ingress and the command owner.
  The consent token cannot set wage, employer, period or account.
- PF53's **source-pinned native** transaction atomically persists the exact
  accepted original wage offer as `payrollConsent` in the real PAID receipt
  and as a separate keyed durable SQLite consent row. A missing, altered or
  unrelated consent row makes `verifyPaidReceipt()` fail. Original PF53
  archive tests remain independent of the native shape transformation.
- PF57 salary checks the *accepted* rate against the current server policy,
  refusing silent repricing after a configuration change. Unconsented
  historical hires cannot be automatically charged.

**PF93 — server-owned automatic NPC salary.**

- PF57's native WORK version now has a private symbol-capability
  `salaryServer` separate from the authenticated public `salary`.
  It verifies the **real** original character/account row inside the
  GameStore transaction, all original writer fences, the source-paid PF53
  hire, and the due PF57 period. It never creates a fake player session.
- `coopPersonalFleetOriginalPayrollScheduler.js` reads PF52 roster/index,
  PF53 receipt, PF57 ledger and immutable PF92 consent in the same original
  SQLite snapshot. Uses deterministic per-contract/per-period operation IDs
  and original PF57 wallet journal settlement.
- A bounded round-robin scans due NPCs. The existing PF56 source-owned
  station timer calls payroll **at most once per 30 seconds** — no separate
  scheduler thread. An unknown COMMIT is process-sticky fenced; after restart
  the original ledger determines whether a period has already settled.
- A previous unpaid period must settle before the next. Missing source
  consent, revoked writer fencing, inconsistent character ownership and
  missing original NPC profile all **fail closed**. No replacement ISK
  ledger is introduced.

**Isolated source checks performed:** consent **14/14**, due payroll
**13/13**, wage-bound offer **48/48**, salary terms **14/14**, original
chat gateway **43/43**, command owner **31/31**, bootstrap **42/42** in
controlled V8/fake-SQL harnesses. These are NOT original server or
real-client E2E measurements, and should not be interpreted as such.

**Remaining full-scope blockers:** original WORK source configuration and
independent native ownership/wallet/kill witnesses, actual original
Node/SQLite and SIGKILL payroll verification, real player-client hiring
and payment E2E, source-verified in-flight warp continuation, native
Personal Fleet ATTACK/GUARD, physical mining/hauling, and exploration/
wormhole execution. No original `pas7-studio/EveJS` branch can be
pushed through the current integration (GitHub create-branch returns 403).
The actual source installation, main, PLAY and live feature flags remain
untouched; this is **not yet gameplay-ready**.

## PF91 native payment and employment progress — 2026-11-08

**Current staging inventory:** PF80 22-path base + 28-path first-play
WORK delta (4 overlaps) = **46 distinct native paths**. This package
contains **54 checksum-pinned native/tool/test source files**, not an
installed or playable server.

- `coopPersonalFleetOriginalSalaryTerms.js` is a **strict server-owned
  pricing and due-date reader**, joined 1:1 against the *genuine*
  hireable NPC catalog. Every `salaryCents` and `periodMs` must be
  explicitly authored by the original WORK configuration; no defaults,
  user-specified price or fabricated account/NPC profile.
- PF91 uses the actual PF53 paid hire receipt and original PF52
  processed-hire source, verifies the real NPC SDE character/profile,
  original employer corporation and original wallet journal.
  A future period cannot be paid, while old unpaid periods remain
  payable sequentially and block premature dismissal.
- PF57 now composes into the native `OriginalWorkBootstrap`, using
  `OriginalSalaryTerms` for source-verified quote, hire, employer and
  native release proofs. Loss/competing-order witnesses must still come
  from **authentic original native writer hooks**. Any missing hook
  aborts the original pre-TCP startup.
- The authenticated in-game command `/pf salary <pilotID>` derives the
  **next** period only from PF57's original ledger; it does not accept
  a client-provided amount, period or employer. `/pf dismiss <pilotID>`
  now targets the real PF57 source lifecycle, never the previous
  blocker stub.
- The original wallet adapter independently verifies both durable
  character/corporation salary journal entries and the global
  transaction ID before emitting original wallet notifications.
- The WORK PF53 native paid-hire patch removes an **unused**
  `npcEntities` transaction table so other transient NPCs cannot
  arbitrarily block hiring. PF57 salary and dismissal native patches
  similarly declare only their genuinely accessed original tables.
- Added a mandatory regression for file identity after catching and
  correcting an accidental temporary swap of
  `coopPersonalFleetWorkCommandOwner.js` and
  `coopPersonalFleetChatGateway.js`. Both original module paths are
  restored and their exports verified.

**Actual isolated evidence:** salary term tests 12/12, command owner
faux-SQL tests 29/29, chat gateway 41/41, native composition 40/40
before the last policy match hardening, WorkStarter 10/10. These
remain controlled mocks, NOT an original WORK client or Node/SQLite
gameplay run.

**Unfinished mandatory work:** PF53 must seal immutable recurring
wage *consent* in the original paid contract before unattended debit
is allowed; implement an original server-owned payroll scheduler
that settles due periods without forging a logged-in player session;
complete loss/wreck kill-record writer witnesses and real dismissal
E2E; in-flight native WARP recovery; full Personal Fleet ATTACK/GUARD,
MINING/HAUL and EXPLORATION/WORMHOLES native execution; and original
boot/writer configuration + two-player WORK/SIGKILL E2E.
**No unattended salary debits are enabled by this stage.**
Default feature flags and PLAY remain OFF.

## Current PF89/PF90 source status — 2026-11-08

**Latest staged source scope:** PF80 **22** files plus first-play **27** delta
paths, 4 overlapping = **45** distinct original native WORK paths.
**51** SHA256-pinned first-play native/tool/test files. These supersede the
older dated path/count statements below, which are historical snapshots.

**PF89 (native PF57 loss):** The actual WORK PF57 source now reads the
original per-entity `npcEntities` and `npcModules` SQLite rows, plus original
flat `npcCargo.cargo`, `npcWrecks.wrecks` and `npcWreckItems.items`.
It uses a new, strictly read-only
`coopPersonalFleetOriginalLossRows.js` with duplicate title detection
(including original `sourceCargoID`), root/skeleton and row identity checks.
The source-pinned builder makes this change ONLY in isolated WORK; legacy
archive unit fixtures remain intact. The helper's isolated V8 tests were
**16/16 PASS**, and all 7 original PF57 stock patches were verified against
the real module text with a JavaScript compilation check. The actual
PF57 original-node/SQLite and game death E2E remain NOT RUN.

**PF90 (physical restart):** `coopPersonalFleetOriginalPhysicalRecovery.js`
is source-bound to original nativeNpcStore/nativeNpcService, the PF52
reservation+roster, PF54 ACTIVE receipt, actor claim, original ItemStore,
live player sessions and mounted original scene. When EVERY proof agrees,
it invokes the real native
`materializeStoredNativeController(scene,sameItemID,{broadcast:false})`.
It neither mints a ship nor reissues any player/NPC command. It is called
through the existing 100ms PF56 server tick (at most once per second) and
waits for scenes to be loaded. A failed/ambiguous materialization is fenced
per entity for the process; it does not retry unknown side effects. V8
behavioral source tests: **15/15 PASS**. This still requires native WORK E2E
and an original server/restart proof.

**Unresolved WARP:** The original native materializer restores position and
motion fields, but does not guarantee reconstitution of an active sessionless
ingress warp. PF90 refuses blind warp redispatch for a persisted `WARP`.
An original-source durable flight-resume protocol is still required to
complete restart-in-flight acceptance.

**Not complete:** native PF57 payroll scheduling, actual loss and independent
wreck/killmail witnesses, safe dismissal, shared-player NPC ATTACK/GUARD
and physical mining/exploration role integration, official native startup
configuration with all writer hooks, and authenticated two-client WORK E2E.
The Personal Fleet source remains **OFF**; main and PLAY untouched.

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
  this **25-path** original source delta (four overlap with PF80) =
  **43 unique staged native paths**. The generated patch includes both
  original NPC order source files, PF55 original character row scope,
  PF52 original paid hull row scope, wallet corrections, new modules
  and the original chat hook. It must pass exact Git `apply --check`.

### Real execution evidence

**239/239 Node tests PASS** on Node.js 22.16.0, including original-source
actor/target identity, stock runtime command wiring, paid offers, wallet
receipts, bootstrap fail-sticky and in-memory EVE service adapters.
**26/26 Python/Git tests PASS** on Python 3.13.5; exact original stock
blob pins, patch transforms, `git apply`, manifest and linked-worktree gates.

**Previous baseline: 265/265 PASS. New PF56/60/61/66 local tests: 66/66 PASS. Full combined regression on this PR head has NOT RUN. 46 source/test/tool files SHA256-pinned.**
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
native paths**, four already staged by PF80, and **43 unique final WORK paths**.
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
actual original `npcEntities['entities\u001f<shipItemID>']` movement fields
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
Python/Git, **265/265 previously PASS; 68/68 newly added dock tests PASS; full combined regression NOT RUN.** **36 SHA256-pinned code/test files**;
19 unique additional native patch paths over PF80's 22 source paths,
four overlapping, producing 43 unique modified native files.

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

The WORK package now has **21 exact additional native paths** atop PF80's
22 staged paths; four paths overlap and **43 unique native files** are staged.
All 46 source/test/tool files have SHA256 manifest entries. The manual Windows
runner has 12 Node suites and is configured to announce its combined PASS
only after every suite succeeds on the user's machine.

**Executed here:** 68/68 new Node VM/source-contract tests, including 35
PF56 completion, 17 PF60 terminal source and 15 one-shot cleanup-coordinator
cases. Prior source baseline 265/265 passed before these changes. Full
combined current-head test run, native WORK startup, real station flight/dwell,
real ItemStore+NPC cleanup after kill, and two-client gameplay **NOT RUN**.

Outstanding CODE/WORK work: authentic native source startup invocation and
writer hooks, a real continuous station dwell monitor and original return-flight
witness, plus observed crash-recovery on the running original server. A
`DOCKED` response cannot be claimed until PF56 independently reconciles
and PF60 finalizes the actual original ship. Do not touch PLAY.


**Scene-mount safety correction:** Neither PF60 terminal custody nor PF56 dock
completion can treat an unloaded original solar-system scene as proof that an
NPC disappeared. Both require the exact original system scene to be mounted,
and then check no physical duplicate exists in any mounted scene. Two new
negative tests exercise this; the isolated dock suites now pass **68/68**.


## Native original return flight and station dwell (2026-11-07)

Original PF56 return flight is now source-wired to stock npcRuntime.warpToPoint through the exact same original shared NPC order bridge and arbiter used by PF55 FOLLOW/HOLD. The source accepts station coordinates only when original worldData.getStationByID and a matching, loaded original station scene ball agree. Client-provided destinations never substitute.

New original source module coopPersonalFleetOriginalStationDwell.js verifies stock ItemStore, PF52/54 physical actor claim, original controller, scene, station geometry and stopped/warp-inactive movement. It writes a tick-bounded 2-second station dwell record in original SQLite. A departure, scene restart, controller change, missing scene, missed tick over 350ms, or a sample stale over 100ms denies PF56 continuous dwell and the PF66 native pre-dock gate. No fake player session or ItemStore mutation.

New coopPersonalFleetOriginalStationTickDriver.js runs a single unref'd original-server 100ms timer after guarded native bootstrap publication; it enumerates only genuine persisted RETURNING/ARRIVAL_OBSERVED rows, samples outside the enumeration transaction, and never dispatches a warp or docking effect. A second timer startup is forbidden. Four prior callbacks (executeNativeReturn, verifyStationArrival, verifyContinuousDwell, verifyOriginalDockReady) now use original-source methods.

Important remaining CODE: PF56 still needs its independently authenticated original durable RETURN order receipt (verifyOriginalReturnOrder), and its confirmReturn, observeArrival and requestDock transitions still require an authenticated player session. Completing these transitions after player logout needs a real original server-owned durable permit and integration, NOT a fabricated player session. The game engine startup and all original reciprocal writer hooks also remain uninstalled from this cloud connection.

Test evidence actually executed: 66/66 fresh Node tests (22 physical-return bridge, 28 station dwell, 16 native scheduler), plus separately rerun older candidate baseline 239/239 Node and 26/26 Python. The full combined CURRENT PR head tests and actual native WORK/client/restart are NOT RUN. Do not sum independent source versions as a green current-head run. The isolated WORK patch now requires 25 additional native paths on PF80's 22 baseline (four overlapping), 43 unique final staged native paths. Manifest: 46 code/test/tool source entries. Manual Windows runner: 14 Node suites. PLAY and main untouched.


### Original stock scene entity and Crimewatch audit (2026-11-07)

The real original EveJS scene creates stations with `kind:'station'` and
`itemID=stationID` (not necessarily `entityID`). Native space ships similarly
use `kind:'ship'` with original `itemID`. The source-bound station geometry,
return executor and dwell gate now verify these canonical `itemID`/kind fields,
with optional `entityID` accepted only if it agrees. The station monitor also
imports original `security/crimewatchState.isCriminallyFlagged` and refuses
station arrival / PF66 dock readiness unless that original check explicitly
returns `false` for the verified original ownerCharacterID. That preserves
a native station-docking restriction without creating a fake player session.

Latest isolated source-specific evidence is **74/74 Node PASS** (physical
RETURN, original SDE/scene station dwell, original station native timer).
Previous separately re-run candidate baseline: **239/239 Node + 26/26 Python
PASS**. The full combined current PR-head regression and original native WORK
client E2E are still NOT RUN. Source pins: 46 source/test/tool entries; 25-path
incremental WORK patch over PF80's staged 22, 43 unique native source paths.
The missing original durable RETURN order receipt and genuine sessionless
PF56 transition authorization remain code blockers, not just debugging.

## PF84 — server-owned, sessionless RETURN continuation (2026-11-07)

**Candidate code only; not installed or tested on native WORK/PLAY.**

PF56's original `/pf return` remains **player-authenticated**. At the moment
that command commits `RETURN_ISSUING`, it now binds the original account ID
to the durable intent (`requestedByAccountID`). This is not an independent
authorization token or a client-provided identity.

The original `characters` row is the authority for a later sessionless
transition. `coopPersonalFleetOriginalSourceBindings.verifyServerReturnOwner`
checks that the character still exists, is not deleted, and is owned by the
same account. `coopPersonalFleetReturnDock.advanceServer` is not exposed
to chat/HTTP and requires the committed PF56 intent, full exact operation/
assignment/actor identity, original transaction ownership, reciprocal writer
fences and original source-specific physical/ItemStore proofs. **It never
creates a new RETURN order, session or ship.** Older intents without the
original account stamp cannot be silently migrated.

The native source-owned 100 ms station timer now progresses:

- `RETURN_ISSUING`: read-only reconciliation of the **original durable
  RETURN-order proof**; never invokes `warpToPoint` again.
- `RETURNING`: physical station-arrival observation.
- `ARRIVAL_OBSERVED`: continuous native dwell and original manifest gate,
  then exactly one already-fenced PF66 docking dispatch.
- `DOCK_ISSUING`: readback-only PF60/61 native cleanup followed by PF56
  ItemStore + manifest + controller reconciliation.
- `DOCKED`: when PF60 was `NATIVE_CLEARED` at a crash, readback-only final
  custody lock release. A `FINALIZED` tombstone is never reissued.

If the actor, owner, scene, station, original ItemStore or writer proofs
cannot be checked, the tick returns `BLOCKED`. A lost scene never becomes
proof that the ship disappeared. A failed/unknown dock effect is **not**
dispatched again; operator-controlled reconciliation remains necessary.

**Subsequent PF84B source update:** original `verifyOriginalReturnOrder`
no longer comes from an externally supplied boot hook. A dedicated writer and
reader now live in `coopPersonalFleetOriginalDurableOrderAck.js`, see below.
Native boot/writer hooks, rehydrated physical warp, actual WORK patch apply,
Node/SQLite full-current-head run, engine restart and two-client gameplay
have not been verified. PF84 does
not make the feature playable or authorize main/PLAY deployment.

**Isolated verification in this change:** 10 in-memory PF56 transition
scenarios, 19/19 station-timer VM tests, 39/39 native bootstrap VM tests and
26/26 original source-binding tests using a mocked SQLite adapter. These
are contract/VM checks, not a full real Node/SQLite, Windows or native WORK
gameplay run. The first-play PowerShell runner now additionally invokes
PF56's actual Node/SQLite, original native API and SIGKILL suites locally;
its new combined result is **NOT RUN** in this cloud session.

## PF84B — original durable RETURN native acceptance (2026-11-07)

The original `coopPersonalFleetOriginalDurableOrderAck.js` now also covers
RETURN. After the existing shared NPC arbiter reports physical warp success,
it independently verifies the exact `RETURN_ISSUING` operation/index,
original PF52/PF54 actor claim, the source-owned native NPC entity/controller,
original live warp state, original station SDE+scene geometry and immutable
character/account owner. It then writes an original `npcEntities['entities\u001f<shipItemID>']`
return-order marker plus the same-intent
`corporationRuntime['native-return-receipt-v1:<operationID>']`
in **one original SQLite transaction**.

PF56 `confirmReturn` now opens the original `npcEntities` table only when
reconciling this native proof. The bootstrap obtains the proof from the
source-owned durable writer, not `originalHooks.verifyOriginalReturnOrder`,
and the physical return executor refuses to claim success when the original
SQLite receipt could not be committed. After a process restart, confirmation
reads the durable marker and receipt; a missing or changed original owner,
ship, actor-generation, operation or signature blocks progression. It does not
invoke a second warp.

**Limits:** this is a *durable physical warp acceptance marker*, not automatic
rehydration of a disrupted in-flight NPC AI after a real kill. Live native
`npcEntities` writer races, restored flight, station docking and two-player
WORK gameplay remain unverified. The original server startup hook and
reciprocal writers still need native WORK installation. No PLAY or main merge.

Local source/VM contract checks additionally covered 25/25 durable-order-ack
scenarios (19 prior + 6 RETURN cases) with a mocked transactional SQLite
adapter and 23/23 native order-executor scenarios. **No actual Node/SQLite
or WORK E2E run was performed here.**

## PF86 — P0 native SQLite NPC entity-row correction (2026-11-07)

Inspected the **original** EveJS `Code/server/src/gameStore/sqliteStore.js`
`ROW_GROUPS.npcEntities = ['entities']` and `explodeToRows`:
the actual SQLite key for an NPC is `entities\\u001f<itemID>` (the
single-byte Unit Separator between `entities` and the decimal item ID).
It is **not** a `/ ` root document. Earlier isolated VM/SQLite tests created
a fictional `npcEntities['/']` blob and therefore could not establish
that either PF55 or PF84B receipts worked against stock native storage.

Both durable order receipt readers/writers now use the original **per-entity**
SQLite key. PF55 persists the original live FOLLOW/HOLD movement and receipt;
PF84B persists the original source-observed RETURN acceptance marker and
receipt. Both commits affect only the claimed physical NPC row plus the
matching `corporationRuntime` receipt, never clobbering another NPC.

Regression fixtures now seed real per-entity keys and a second unrelated
NPC; tests reject a fabricated legacy root `/`, verify another NPC is
untouched, check rollback/restart readback, and exercise RETURN receipt
tampering. These test changes are essential; the old green counts were
not proof of real stock SQLite compatibility.

**Remaining P0:** GameStore's genuine `coopAtomicNativeRows` refuses
transactions on a native table that has unquiesced transient rows. This
preserves safety and must NOT be bypassed by an unscoped writer. A real
original-server startup, sourced reciprocal writer fences and WORK
SIGKILL/client tests remain mandatory. No PLAY activation.

## PF87 — Source-scoped transient NPC SQLite isolation and complete PF55 ACK (2026-11-07)

A source audit uncovered **two native GameStore blockers** that the isolated
prior V8 mocks did not model correctly: (1) stock `npcEntities` is an
`entities\\u001f<itemID>` **per-entity SQLite table**, not a root blob;
(2) the stock `coopAtomicNativeRows` rejects every transaction that includes
`npcEntities` if *any unrelated transient NPC* is present. Independently,
PF55's ACK reconciler previously called `tx.get('npcEntities', ...)` without
declaring that SQLite table, which the real adapter rejects.

The first-play WORK assembler now produces **25 additional source paths**
over PF80's 22-path baseline (four overlapping paths), for **43 unique
staged paths**. It includes a pinned original GameStore adapter delta
(`Code/server/src/space/coopGameStoreAtomic.js`, original blob
`2b28b48145f3fbc989ce7346384487ee75e52280`) and
`coopPersonalFleetNativeEntityIsolation.js`. Neither the original
`gameStore/index.js` nor any other stock native writer is modified.

The new GameStore option `contract:'personal-fleet-entity-receipt-v1'`:
- Requires the exact original table set
  `[corporationRuntime,items,characters,npcEntities]` and an explicit
  `EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION=1` WORK-only flag (plus the
  original atomic/PF native flags). The bootstrap's operational gate also
  requires that flag, so physical commands cannot start before installation.
- Synchronizes the original GameStore flush, checks pre-commit cache/durable
  equality after excluding **only** canonical transient
  `/entities/<itemID>` rows, and refuses an overlapping target or a
  transient entry accidentally persisted to SQLite.
- Allows **only**: PF55 one original physical entity row + matching
  original receipt, PF56 one entity row + matching RETURN receipt,
  PF56's exact RETURN_ISSUING → RETURNING transition, or PF55's exact
  ISSUING → ACKED ledger and operation-index transition.
- Rejects partial write sets, arbitrary deletes, unrelated character/wallet,
  inventory, controller, or other-NPC mutations, duplicate receipts, changed
  ownership fields, missing durable source and malformed transient paths.
- Refreshes the original cache via its stock **per-row** path and verifies
  every transient cache shadow both before and after that replay.
  If any safety check fails *after SQLite commit*, the original GameStore
  adapter retains its existing poison/fatal behavior; no blind retry.

New targeted regression suite:
`tests/personal-fleet-original-native-entity-isolation.test.cjs`;
original pinned-adapter builder tests:
`tests/test_original_atomic_entity_contract_patch.py`.
`Test-FirstPlay-Local.ps1` now also runs PF55 Node/SQLite/SIGKILL tests.
The isolated JavaScript contract suite passed **22/22 VM tests** in this
environment. This does **not** constitute a completed native WORK test or
prove that the patched GameStore adapter was exercised inside the actual
original engine. Manual Node 22/Python, WORK server startup and connected
client E2E are still required.

**Safety:** No automation, PLAY access, main merge or auto-enable. A live
actor's post-crash return-flight resume, original startup hook owners and
all reciprocal writer hooks are still not proven; do not call this playable.

### PF87 real Node/SQLite verification of the staged WORK adapter

After applying PF80 plus the **25-path** first-play patch in the **isolated**
linked native WORK worktree, run (in PowerShell from the orchestration checkout):

```powershell
.\scripts\personal-fleet-firstplay\Test-FirstPlay-Local.ps1 `
 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
 -NativeWorktree 'O:\tmp\pf-firstplay-native-work'
```

`-NativeCheckout` validates **unmodified stock source pins**.
`-NativeWorktree` loads the **actually patched original**
`coopGameStoreAtomic.js` and `coopPersonalFleetNativeEntityIsolation.js`,
uses a **private temporary on-disk Node 22 SQLite database** (never the live
GameStore), and exercises original `createSqliteAdapter` together with
`createGameStoreAdapter`: full durable commit and fresh DB reopen, no
transient NPC persistence, one-NPC write scope, rollback on uncertain
precommit, PF55 two-row ACK, PF56 CONFIRM, original default transient deny,
and poison on postcommit cache failure. No server or game client starts.

If the actual WORK source differs from the reviewed builder, the test must
fail instead of reporting gameplay readiness. No command in this section
enables Personal Fleet, starts PLAY or mutates native engine files.

## PF88 — original source-pinned server entry and pre-TCP startup (2026-11-08)

Original EveJS `Code/server/index.js` is pinned by Git blob
`912c942d29db35f5f105119bfc6c0d2eff1bf5dd`.
The isolated WORK patch now includes:
- `Code/server/index.js` — inserts a strictly opt-in native
  Personal Fleet startup gate immediately BEFORE `startTCPServer`.
  The normal source is unaffected when both PF flags are OFF.
- `coopPersonalFleetOriginalWorkStarter.js` — sticky, one-attempt,
  source-owned bootstrap entry; all four PF87 runtime flags required.
  It requires a real original source `coopPersonalFleetOriginalWorkConfiguration`
  module supplying a verified immutable NPC catalog and *real native*
  writer/ItemStore/wallet/WAR/Mining/Exploration hooks. Missing module,
  bad source, empty catalog, false writer fences, failed composition or
  revoked readiness abort **before TCP listens**, not after.
- `tools/build_original_server_startup_patch.py` and its tests
  enforce the original Git blob and exact insertion anchor.
- `tests/personal-fleet-original-work-starter.test.cjs` tests
  missing/wrong original hooks, disabled flags, sticky startup and
  failed composition; the focused V8 isolated checks were **9/9 PASS**.
- `tests/personal-fleet-original-entry-work.test.cjs` uses the
  **actually staged WORK entrypoint source** with inert TCP mocks
  to assert that OFF starts unchanged; opt-in runs native startup before
  TCP; failure cannot listen. It is triggered only with
  `-NativeWorktree`. No network is started.

PF80 staging remains 22 base files. The first-play stage now contributes
**25 delta paths** (four overlap), producing **43 unique changed native
WORK paths**. The manifest now contains **46** first-play native, test
and tool source checksums.

**Still missing:** the authentic original
`coopPersonalFleetOriginalWorkConfiguration` owned by the native engine.
It must be implemented against the real source writers and a real SDE NPC
catalog. No synthetic success callbacks or weakened writer gates.
Therefore the now-installed startup gate is intentionally fail-closed on
opt-in. This **does not mean gameplay is ready**. A real WORK startup,
Node/SQLite SIGKILL and two-client E2E are still required. PLAY OFF.
