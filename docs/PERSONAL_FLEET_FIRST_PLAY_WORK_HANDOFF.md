# Personal Fleet — FIRST PLAY / WORK-only handoff (2026-11-07)

**This is the single current implementation target. Stop adding PF-101/102
reference-only steps. The owner wants playable NPCs, not more mock PASS.**

Status: `BLOCKED_NATIVE_INSTALL`. PR [#350](https://github.com/pas7-studio/evejs-coop-universe/pull/350)
contains substantial **inert** PF52–PF100C code and manual tests.
It is not installed in `pas7-studio/EveJS` `coop/pas7std`.
A new native branch attempt on 2026-11-07 failed HTTP 403
`Resource not accessible by integration`. Cloud cannot access the
owner's Windows EVE/WORK checkout or authenticated client. The local
coding agent with the native clone MUST perform source changes and
client verification. Do not mark this document DONE until that happens.

## Decision: playable thin slice, NOT full PF100B active-ship transfer

For the **first actual game** use ONE already-owned **spare ship in a
station hangar**; the player stays in their own other, active ship.
This is the normal PF52/PF53/PF54/PF58/PF87 custody path; it bypasses
PF91–PF100C active-ship replacement/atomic capsule concerns. Do not
create a fake ship, virtual item, injected balance, or new NPC hull
ID. Retain exact native ItemStore `itemID` as NPC entity/controller ID.

First playable command surface: **HIRE → ASSIGN/HANGAR RESERVE →
DEPLOY → FOLLOW → HOLD → RETURN_TO_BASE**. The first three steps must
charge **real player ISK exactly once** and preserve real original
ItemStore ownership. Follow and Hold use actual native NPC runtime;
Return must result in stock station docking of the **same item ID**
and be observed by the connected EVE client. No combat, ammo, wage
cycles, WAR, Exploration or autonomous mining in the first smoke
scenario. Existing historical functionality must remain unaltered
when the new feature flag is OFF.

**No fake shortcuts:** WORK may have conflicting optional directors
disabled for the first controlled scenario, but this is not proof of
production writer arbitration. Without the original stock player,
ItemStore and GameStore ownership hooks there is no safe activation.
Do not use arbitrary `()=>true` for any security or custody authority.

## Native implementation order: build, do not just review

Work locally in:
- orchestration checkout:
  `R:\GitRepository\pas7std\evejs-coop-universe` (or actual path);
- real engine checkout:
  `C:\Games\EveCoop\upstream-evejs` branch `coop/pas7std`;
- **isolated native WORK git worktree**, never directly mutate a
  checkout that PLAY runs. Preserve local dirty work and volumes.

1. Read `AGENTS.md`, `state/NOW.md`,
   `docs/TWO_STACKS_PLAY_AND_WORK.md`,
   `docs/GAMEPLAY_TESTING.md`; record current SHAs, dirty files,
   engine image and running stacks. DO NOT reset/clean or run CI.
2. Run existing **PF80** preflight and stage its combined 22-path
   source-pinned native candidate in a fresh WORK-only git worktree.
   Review its `postTestNativeIntegrity` and source hashes. No second
   patching mechanism and no new vendored game client.
3. **Make focused commits in the original EveJS WORK worktree.** Use
   `Code/server/src/space/coopPersonalFleetNativeBootstrap.js` and
   real original modules: native GameStore, `services/inventory/itemStore`,
   native NPC service/store/runtime/scene, original authenticated
   `services/chat/sessionRegistry`, character and stock wallet
   owners. Install source-bound runtime composition once. The archive
   `.cjs` names are not runtime registration. Confirm native imports
   actually resolve after PF62 rebundling.
4. Wire real **server-side command ingress** to the existing authorized
   client interaction. Minimum actions are HIRE, RESERVE, DEPLOY,
   FOLLOW, HOLD, RETURN. Validate the **exact registered live
   session object** and character/account ownership; never accept
   caller-supplied account, verifier or arbitrary `shipID` as authority.
   Only original in-game authenticated requests may reach mutation.
   For WORK smoke, a server-operator command that can be invoked
   from an authorized game session is acceptable; do not expose a new
   unauthenticated public HTTP endpoint. Record the in-game invocation
   actually used, not a theoretical command.
5. Wire in this order:
   - PF53: native paid hiring and original wallet transaction;
   - PF52: original spare hull reservation and storage/actor exclusion;
   - PF54 + PF58/PF87: durable `ISSUING` → original ItemStore
     in-transaction move + one-shot permit → same physical native
     actor/controller → independently verified `ACTIVE`;
   - PF55/PF82: real physical friendly FOLLOW and HOLD with current
     actor+claim, not combat-target-gated fake FOLLOW;
   - PF56/PF83: STOP active combat controller if necessary; durable
     RETURN, actual station docking and reclaim same item.
   All required original writer fences, session authority and cache
   invalidation must be installed. Stop on first missing authority
   rather than substituting a callback or weakening a test.
6. Keep all flags OFF by default. Enable the minimal ingress/actor
   only on **isolated WORK** with a fresh explicit configuration and
   preserve `evejs` PLAY volumes and running containers. Build from
   the native WORK worktree, not the wrong native checkout. Never run
   the old launcher that targets PLAY by default.
7. Capture actual original server telemetry and one authenticated
   authorized EVE client observation. Test a second independently
   authenticated character cannot take this NPC or ship. Perform
   restart with exact original ItemStore ID unchanged. Record failed
   first gate with root cause and one next code fix.
8. Commit actual native engine source changes (not just docs/test
   candidates), local tests, run original source audit and add an
   evidence report. Publish native commit SHA + WORK image digest,
   accepted gameplay evidence, and manual rollback instructions.

## Exact preflight, already implemented (NOT gameplay)

From the clean orchestration PR branch and original native root,
using a fresh review and WORK output path:

```powershell
.\scripts\pf62\Prepare-PF80-CompleteNativeWork.ps1 `
  -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
  -ReviewOutput 'O:\tmp\pf-firstplay-review' `
  -WorktreeOutput 'O:\tmp\pf-firstplay-work' `
  -WorkBranch 'work/personal-fleet-firstplay' `
  -ApplyToWork -ConfirmWorkOnly 'WORK-NOT-PLAY'
```

That command **does not** create a playable server: after staging,
the agent still must implement steps 3–8. Do not enable flags after
PF80 alone. Existing native source pins can drift; if PF80 refuses
them, inspect the **real current source** and fix exact integration
instead of bypassing pins.

## First actual game acceptance (evidence is mandatory)

| Gate | Evidence required |
| --- | --- |
| Real paid hire | original owner wallet decreases once and original NPC employment record matches |
| Hangar assign | one spare original ship item, unaltered ID and fittings; active player ship unchanged |
| Deploy | exactly one real entity and one controller with same physical ship ID and original cargo |
| Follow | connected client sees same NPC visibly move toward a *friendly* player ship |
| Hold | NPC visibly stops; real native controller state reports HOLD/STOP |
| Return | same ship docks to original station; no second item/hull/controller |
| Restart | no double charge, duplicate handoff or invented NPC after restart |
| Authorization | second character cannot command, reserve or dismiss first player's ship |
| Isolation | WORK-only deployment verified; PLAY unmodified |
| Evidence | timestamped game events + original Git SHA + actual WORK image/version + one-client observation |

**Release rule:** a truly playable **WORK-only MVP** may be declared
after these gates. It does *not* prove combat, payroll, complex
concurrency or production/PLAY readiness. For PLAY, owner must
explicitly approve a separate restart window after source review and
required broader gates. No GitHub Actions, secret collection or
`docker volume rm`.

## Do not repeat the previous failure pattern

Do not add new PF-numbered standalone validators as the default next
task. Do not interpret 19/19, 26/26, 18/18, 44/44 SQLite mock-fixture
PASS or PF80's 22-path review as player-visible gameplay. Report the
first **real** failing native bootstrap/ingress/ship runtime step.
If you cannot access the local engine, leave `BLOCKED_NATIVE_INSTALL`
and hand this file to the agent that can; do not invent completion.


## Executable first-play source package — 2026-11-07

The new production-facing candidate is in
[scripts/personal-fleet-firstplay/README.md](../scripts/personal-fleet-firstplay/README.md).
This adds an authenticated real XMPP/LSC /pf gateway, source-bound server
command conductor, native stock chat source patch, and PF53/PF57 per-character
wallet row fixes. All ten exact published tested source/test files are
SHA256-pinned. Node.js 22.16.0: **118/118 PASS**, Python 3.13.5: **18/18 PASS**,
total **136/136** isolated component checks. No original native engine boot,
Windows PowerShell runner, client gameplay or true native payment/actor test.

The combined WORK-only patch assembler starts from PF80's isolated
22-path staged native worktree and adds EIGHT native source paths
(two existing PF53/PF57, three new: chat hook, /pf gateway, command
conductor). It verifies the exact final 27-path WORK inventory; both
review and explicit apply modes keep all flags OFF. Read the README
for a safe two-command staging sequence. These additional paths are
**staging**, not a runtime boot or server-side original owner installation.

**Still P0 code missing:** original native composition root and shared
GameStore/wallet/stock ItemStore writer authority; authentic
available NPC pilot/agent/offer source (original npcEntities stores
native entities, not the synthetic fixture pilots map); original
PF54/PF55/PF56 physical actor and docking effects, original
session/actor/WAR/Mining/Exploration guards, and payroll/loss/advanced
fleet policies. The original native repository still rejects GitHub
writes (HTTP 403). Thus status remains **BLOCKED_NATIVE_INSTALL**,
**NOT** only debugging. The first legitimate WORK gameplay test
must be on a real original engine fork commit and authenticated EVE client.


## Original real NPC offers and source binding — 2026-11-07

The first-play WORK bundle now stages **EIGHT** native source paths beyond the
PF80 22-path base (two existing wallet modules modified; five changed/added
native files, 27 final staged Git paths total). Both key source adapters are in
`scripts/personal-fleet-firstplay/native/`:

- `coopPersonalFleetOriginalOfferAuthority.js`: a durable server-priced
  per-character offer from an original named NPC **SDE person**, original
  `npcData.buildNpcDefinition()` profile/loadout/behavior and original
  `corporationRuntime` corporate wallet. PF53 revalidates the same offer
  before real ISK settlement. No character, NPC entity or currency minted.
- `coopPersonalFleetOriginalSourceBindings.js`: imports the native original
  GameStore, sessionRegistry, structureLocation, stationStaticData and
  space runtime, verifies exact authenticated original character/account
  and real docked-station or in-space physical player ship ownership.

Native client `/pf offers` now displays the **server-authored ISK price**.
The catalog is EMPTY unless the operator chooses real eligible NPC character
IDs, NPC profile IDs and employer corporation IDs in their installed EVE SDE.
That step is not simulated. A real preexisting native NPC persona is not the
same thing as a physically spawned native NPC ship/controller.

**Evidence:** Node 22.16.0 **118/118 PASS** including 34 real-SQLite
offer and 21 native-source-authentication tests; Python/Git 18/18 PASS;
**136/136 total locally**. Tests use controlled original service adapters
and are NOT proof of original EveJS integration. The Windows/manual
runner and complete original native binary boot are unexecuted here.
Native source hash pins cover original chatCommands, NPC data, corp
identity/runtime, live sessions, stations, space runtime and SQLite.

**The remaining code is real:** source-owned bootstrap mounting PF52–57,
SDE-authored catalog for local WORK, native PF58 actor adoption, PF55
real scene orders, PF56 return/docking, all original writer fences
and gameplay restart hooks. Do not describe the project as
`CODE_COMPLETE_ONLY_DEBUG_REMAINS` until the original fork has actual
commits for those adapters and source-level tests. The cloud GitHub
App cannot currently write to `pas7-studio/EveJS` (HTTP 403).


### PF52 original-characters transaction boundary (2026-11-07)

A source-authorized PF52 `RESERVE_HANGAR_SHIP` invokes the paid NPC
hull-type verifier **inside** its native GameStore transaction. Original
PF52 used only `[corporationRuntime, items]`; that scope cannot read
`characters/<characterID>`, which is required to verify live ownership
and PF53's paid wallet receipt. The first-play native patch now changes
PF52's exact one reserve/release transaction scope to
`[corporationRuntime, items, characters]` while preserving the
original PF52 compare-and-set ledger and reserve keys. Source-pinned
Python/Git tests prove the patch is applied to the PF80 staged file.
The incremental patch now has **8** affected source paths over PF80's
already staged 22, with **27 unique changed native paths** total.
No source row is silently skipped or validated via nested transactions.

## Native WORK composition + original wallet IDs — 2026-11-07

The latest concrete installation package is
`scripts/personal-fleet-firstplay/`.
It now includes original source-owned
`coopPersonalFleetOriginalWorkBootstrap.js` and
`coopPersonalFleetOriginalWalletAuthority.js`, with **10 native
source paths** over the PF80 22-path staged candidate and
**29 unique changed native paths total**. The source-bound composition
creates actual original adapters for paid hire, hanger ship reservation,
PF54/PF58 physical handoff, PF55 friendly orders, PF56 return and
source-owned `/pf` chat, then only publishes the chat endpoint once
every dependency was built. Unsafe partial installs fail-sticky for
the native process; there is NO automatic reinstallation.

Original wallet ID and notification hooks are now *implemented in
source-bound code*: original `plexVaultLogState.getTransactionID`
provides the one-use native journal number under the same SQLite
transaction; wallet changes are still made only by PF53, while
notifications are sent through stock player and corporation wallet
services after verified commit. Three generic wallet callbacks were
removed from the composition contract.

**Actually executed here:** 169/169 Node SQLite/VM and 18/18
Python/Git => **187/187 PASS**. All 18 candidate/test Git files
have matching tested source byte hashes. Manual Windows PowerShell,
original native server startup, client-visible wallet transfer, NPC
physics and return-to-station gameplay remain **NOT RUN**.

**Still missing CODE, not just debugging:** a trusted original
`Code/server/src/space/coopPersonalFleetOriginalWorkHooks.js`
implementation and server startup invocation, which must bind the
true stock ItemStore and player/Mining/WAR/Exploration writers,
actual native actor proofs, controller orders, return/docking and
existing SDE NPC catalog. The first-play bootstrap explicitly blocks
PF57 salary/dismiss until original source-owned payroll hooks exist.
Do not enable Personal Fleet before these native source changes and
independent WORK E2E. Current GitHub connection still receives 403
on `pas7-studio/EveJS` branch writes.


## Original NPC shared order arbitration — live code continuation 2026-11-07

**Latest authoritative runbook:** [first-play package README](../scripts/personal-fleet-firstplay/README.md).

Verified a hard original native blocker: `coopNpcOrderArbiter.js` refuses the
`PERSONAL_FLEET` owner because `OWNERS` excludes it; `coopNpcOrderBridge.js`
also excludes it from `PEACEFUL`. A new exact-source-Git-blob-pinned WORK
patch adds both, without forking/creating a second arbiter. Original fork
source blobs were re-read and both patch anchors match once each.

Implemented source-bound `coopPersonalFleetOriginalOrderWitness.js` and
`coopPersonalFleetOriginalOrderExecutor.js`. They require PF52 reservations,
PF54 ACTIVE claim, original stock ItemStore, original persisted native store,
the same live NPC registry controller and physical scene entity, and a single
authenticated owner/target ship. PF55 issue/reconcile now declare
`[corporationRuntime, items, characters]` in the **same** original SQLite
transaction to verify the friendly player target. The source-bound physical
executor invokes original `npcRuntime.follow/stop` only through original
`coopNpcOrderBridge` with the **existing shared NPC order arbiter** and
independent canonical WAR ownership proof. No ATTACK/DEFEND/WARP for first play.

The complete first-play review package is now **15 paths** beyond PF80's
already staged 22 paths, with **33 unique changed native paths** (four
overlap), all feature flags OFF. Manual Node/Python/Git component checks
**216+25=241 PASS**, and 24 source/test SHA256 entries pinned. No original
native WORK build, client gameplay or crash/restart run was performed here.

**Not just debugging:** the local original EveJS source still needs an
actual trusted server startup composition, the same existing shared arbiter
instance, genuine WAR claim reader and writer-fence hooks, original PF58
physical scene adoption, **durable PF55 order ACK** (an in-memory follow is
not sufficient after crash), source-owned PF56 docking and a real authored
SDE catalogue. Cloud GitHub write access to `pas7-studio/EveJS` still 403.
Keep PR Draft, main and PLAY untouched and Personal Fleet disabled until
native WORK E2E validates these facts.


**2026-11-07 order patch assembler correction:** the assembled patch now
rejects repeated stock paths explicitly, and includes the original arbiter
source exactly once. Local final checks **216 Node + 26 Python = 242 PASS**;
source/test manifest still 24 exact files. The complete 15-path patch has
NOT yet run against the owner's original native WORK checkout.


## PF55 original durable FOLLOW/HOLD ACK — 2026-11-07

The in-game first-play source package now includes
`scripts/personal-fleet-firstplay/native/coopPersonalFleetOriginalDurableOrderAck.js`.
After a successful original shared NPC arbiter `follow/stop` effect, it proves
the genuine PF55 `ISSUING` signature and PF52/54 actor plus actual in-scene
movement; it atomically persists the original `npcEntities` movement fields
and a linked immutable `corporationRuntime` receipt using the original
SQLite/GameStore transaction. PF55 reconcile now reads `npcEntities` within
its original transaction and independently verifies the persisted receipt,
not just a returned `success:true`. No automatic replay after an uncertain
commit. Native NPC position changes do not invalidate the command proof.

**Local evidence:** 239 Node tests, 26 Python/Git tests, **265 PASS**;
26 source/test files pinned. The incremental WORK patch is **16 native paths**
beyond PF80, **34 unique changed native paths** total. The source-only
test simulates crash before commit and a new server-side owner after commit.
The actual original WORK stack, two EVE clients, stock native NPC restoring
movement after SIGKILL and station docking are **not yet proven**.

The original `npcEntities` table's existing transient-state safety gate
must be validated in the real running WORK server; on unsafe mixed
transient state, atomic receipt will fail closed and require a native
source-safe isolation patch rather than bypassing GameStore protections.
PF56 physical return, continuous station arrival proof and PF66 scoped
sessionless dock remain CODE integration tasks in the original fork.


## Source-wired PF56/PF66/PF60/PF61 original station dock — 2026-11-07

The first-play native WORK source package now assembles **19 additional native
paths** over PF80's 22-path staging, four overlapping, **37 unique native
source paths**. It includes the full first-play docking *code candidate*:

1. PF56 has committed one-shot `DOCK_ISSUING` only after original station
   arrival, same-scene continuous dwell, and original fitting/cargo manifest.
2. PF66 consumes its original durable docking token, uses the original
   `ItemStore.dockShipToLocation(itemID,stationID)`, confirms the *same*
   stock item in hangar, and removes only the exact original NPC scene actor
   via a separately consumed durable scene-detach token.
3. New `coopPersonalFleetOriginalTerminalDockSources.js` provides source-owned
   PF60 command/ship authorization, real native controller/entity readback,
   original actor vacancy and stable dock receipt against the same stock
   ItemStore and PF66 tokens.
4. New `coopPersonalFleetOriginalDockCoordinator.js` executes
   `PF60.prepare → PF60.issue(PF61 one-shot native cleanup) →
   PF60.reconcile` after a successful PF66 effect. Crash recovery is
   readback-only; it will never redispatch PF66 or PF61.
5. New `coopPersonalFleetOriginalDockCompletionWitness.js` refuses PF56
   reconciliation until PF60 is independently `NATIVE_CLEARED`, PF61 cleanup
   attempt is consumed, original ItemStore still has the same hangared itemID,
   original manifest is unchanged, native entity/controller/modules/cargo are
   absent and no active scene has that physical ship. PF56 releases the
   original hangar reservation and PF60.finalize subsequently releases the
   original terminal ship lock once PF56 is proven DOCKED.
6. Native source composition now creates PF66, PF60 and PF61 directly instead
   of requiring operator-provided `executeNativeDock` and
   `verifyOriginalDockReceipt` callbacks. All original module gates remain
   required and the source stays OFF by default.

**Actual evidence:** new 66/66 Node VM tests passed (35 dock readback,
16 source terminal and 15 coordinator). Earlier 265/265 component gates
were green before this continuation. **Full combined current-head runner
NOT EXECUTED**, although it now lists all 12 Node suites and accompanying
Python/Git tests. Manifest pins 32 distinct source/test files. The original
native EveJS project cannot be written by the cloud GitHub integration (403).

**Not yet gameplay-ready:** the original server startup and all reciprocal
writer authority hooks need native fork commits, the PF56 continuous native
station dwell and actual original return-flight reader must be installed and
invoked by a privileged server tick, and original WORK must show a real player
paying ISK, genuine spare stock hull appearing as an NPC, FOLLOW/HOLD/RETURN,
same itemID docked, no duplicates after SIGKILL/restart. No PLAY changes.
