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
22-path staged native worktree and adds SEVEN native source paths
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

The first-play WORK bundle now stages **SEVEN** native source paths beyond the
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
