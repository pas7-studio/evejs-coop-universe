# EveJS Personal Fleet — First Play native WORK delivery

**Status: native WORK staging only. NOT installed in original EveJS. NOT gameplay ready.**
2026-11-07, Draft PR #350. Keep Personal Fleet OFF, main and PLAY unchanged, no GitHub Actions.

## Actually implemented

The package contains an authenticated in-game /pf chat gateway, a native server command
conductor, source-pinned chat/character-wallet patches, a combined isolated WORK
patch assembler, and local regression tests.

The original EVE XMPP path already uses the same chatCommands.js dispatcher as LSC.
Available /pf commands are offers, roster, status, hire, assign, deploy, follow,
hold, return and dismiss. The source-bound gateway requires a real original
authenticated live server session and a separately installed native authority.

The command owner delegates to PF53 hire, PF52 reserve, PF54/PF58 deploy,
PF55 FOLLOW/HOLD and PF56 return, always with server-generated operation IDs,
never trusting user-supplied wallet price or ship ownership. A spare hangared
physical ship is required; the player's active ship stays untouched.

A separate patch changes PF53 and PF57 native wallet candidate code from
the obsolete synthetic aggregate characters map to actual individual original
characters/<characterID> SQLite rows.

The combined native WORK assembler builds five modified/new native paths on
top of PF80's 22-path candidate, for a total of 25. It requires an isolated
linked Git worktree on a work/* branch, a valid PF62 source manifest, exact
original chat source pin 5f4dd4d34a398dde3120e8640a7058d2bd3bb038,
and explicit WORK-NOT-PLAY confirmation. It never creates native business
authorities or enables feature flags.

**Evidence:** 62/62 Node/SQLite/VM tests and 18/18 Python/Git tests PASS on
Node.js 22.16.0, Python 3.13.5, Git. All ten code/test files have exact
Git blob SHA matches with the locally tested source. No native original
EveJS runtime or Windows PowerShell test was run.

## Manual component test

Run from the synchronized orchestration PR #350 checkout:

    .\scripts\personal-fleet-firstplay\Test-FirstPlay-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'

This performs a read-only original chat source pin check. If that stock
source was already patched, inspect instead of resetting the user's data.

## Install ONLY into an isolated native WORK git worktree

First inspect git status and source branches; preserve all local changes.
PF80 requires clean source. Use FRESH output locations.

    .\scripts\pf62\Prepare-PF80-CompleteNativeWork.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' -ReviewOutput 'O:\tmp\pf-firstplay-pf80-review' -WorktreeOutput 'O:\tmp\pf-firstplay-native-work' -WorkBranch 'work/personal-fleet-firstplay' -ApplyToWork -ConfirmWorkOnly 'WORK-NOT-PLAY'

Then stage the additional source-pinned chat, wallet and owner modules:

    python scripts/personal-fleet-firstplay/tools/prepare_firstplay_work.py --worktree 'O:\tmp\pf-firstplay-native-work' --source-root . --pf62-manifest 'O:\tmp\pf-firstplay-pf80-review\PF62-MANIFEST.json' --review-output 'O:\tmp\pf-firstplay-native-review' --apply-to-work --confirm-work-only 'WORK-NOT-PLAY'

Review PERSONAl-FLEET-FIRST-PLAY-REVIEW.json and the 5-path patch in the
separate review directory. The review receipt intentionally reports
nativeAuthorityWired:false, featureEnabled:false and gameplayE2E:NOT_RUN.

**Do not turn on Personal Fleet just because this patch applies.**

## Missing P0 code — not merely debugging

1. Original native server bootstrap: wire real GameStore, CharacterState,
   ItemStore, original wallet, NPC controller/scene, and protected /pf
   source owner. No fake verification callbacks. Original native fork GitHub
   write still returns HTTP 403 to this cloud integration.
2. Real pilot/offers authority: nativeNpcStore stores npcEntities root
   under slash with entities/controllers, not the synthetic pilots map
   in old PF53 fixtures. Need persistent eligible NPC identity,
   original NPC profile and agent proof, NPC employer and sourced price.
3. Full original wallet and ship writer fences: connect PF53/PF57
   corrected character rows to real wallet authority and all reciprocal
   player/Mining/WAR/Exploration/Market/ItemStore ownership writers.
4. Real native actor and order/dock path: integrate PF54/PF58/87 physical
   original hull transfer and NPC actor, PF55/82 physical follow and
   durable order acknowledgment, PF56/83 true return/docking and restart
   reconciliation in the actual native server.
5. Broader requested features (salary/loss, multi-NPC fleet, mining,
   combat, exploration) need real source-level integration and WORK
   acceptance, in addition to this first-play spare-ship smoke path.

No one should report PERSONAl_FLEET_GAMEPLAY_READY unless an authenticated
client visibly completes real hire/ISK -> spare physical hull ->
physical FOLLOW/HOLD -> same original itemID returned to station,
second character cannot hijack the ship, and WORK SIGKILL/restart
does not duplicate stock or charge. Preserve PLAY until the owner
approves a separate restart window.

Reference docs:
- docs/PERSONAL_FLEET_FIRST_PLAY_WORK_HANDOFF.md
- docs/TWO_STACKS_PLAY_AND_WORK.md
