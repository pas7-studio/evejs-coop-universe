# EveJS Personal Fleet — First Play native WORK delivery

**Status: native WORK staging only. NOT installed in original EveJS. NOT gameplay ready.**
2026-11-07, Draft PR #350. Keep Personal Fleet OFF, main and PLAY unchanged, no GitHub Actions.

## Actually implemented

The package contains an authenticated in-game /pf chat gateway, a native server command
conductor, source-pinned chat/character-wallet patches, a source-bound original EveJS
session/station/physical-player-ship adapter, a **durable SDE NPC hire offer source**,
a combined isolated WORK patch assembler, and local regression tests.

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

The combined native WORK assembler builds eight modified/new native paths on
top of PF80's 22-path candidate, for a total of 27. It requires an isolated
linked Git worktree on a work/* branch, a valid PF62 source manifest, exact
original chat source pin 5f4dd4d34a398dde3120e8640a7058d2bd3bb038,
and explicit WORK-NOT-PLAY confirmation. It never creates native business
authorities or enables feature flags.

**Evidence:** 132/132 Node/SQLite/VM tests and 18/18 Python/Git tests PASS on
Node.js 22.16.0, Python 3.13.5, Git. All fourteen code/test files have exact
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

Review PERSONAl-FLEET-FIRST-PLAY-REVIEW.json and the 8-path patch in the
separate review directory. The review receipt intentionally reports
nativeAuthorityWired:false, featureEnabled:false and gameplayE2E:NOT_RUN.

**Do not turn on Personal Fleet just because this patch applies.**

## Missing P0 code — not merely debugging

1. Original native server bootstrap: wire real GameStore, CharacterState,
   ItemStore, original wallet, NPC controller/scene, and protected /pf
   source owner. No fake verification callbacks. Original native fork GitHub
   write still returns HTTP 403 to this cloud integration.
2. Native offer source is now a tested SDE-backed candidate, but must be
   installed in the original WORK composition root with an **operator-authored
   list of real NPC-character IDs, NPC profile IDs, employer and prices**.
   Original nativeNpcStore stores real entities/controllers and still needs
   a separate physical actor adoption hook for the hired NPC.
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


## Real original NPC catalogue and offer-to-PF53 wiring

The new file `native/coopPersonalFleetOriginalOfferAuthority.js` constructs
quotes only when **all** of these original authorities agree:

- `services/corporation/corporationState.getNpcCharacterOwnerRecord(npcCharacterID)`
  identifies a named existing NPC character from Eve SDE (not a generated alias);
- `space/npc/npcData.buildNpcDefinition(profileID)` resolves a genuinely
  authored profile, native loadout and behavior profile;
- the same original corporation owner is an NPC corporation, and the
  `corporationRuntime` SQLite row `corporations\\u001f<corporationID>`
  has a real division-1000 wallet;
- the player has an original live account/character row and PF52 does not
  already employ the named NPC. The operator controls the **fixed
  amountCents** in an explicit server-owned `authoredCatalog` (maximum 12
  entries); clients never specify ISK or a fabricated pilot.

The live quote gets a durable unique `offerID`, revision, expiry and
`sourceProof` in the original `corporationRuntime` SQLite transaction.
Expired **unpaid** quotes rotate revisions, while historically paid
contract IDs cannot be silently re-hired. PF53 subsequently reads the same
quote under its own original SQLite transaction and independently verifies
the NPC, native employer and amount; PF53 alone debits the original wallet.

**There is deliberately no preconfigured/fake hireable character** in
this repository. An operator on the real native WORK server must select
NPC character IDs, native profile IDs and supported ship type IDs that genuinely exist in its
installed SDE. An empty catalogue gives `/pf offers: No native offers`
rather than invented pilots.

Actual connection for the native composition root (reference only, not
automatically installed):

```js
const bind = require('./coopPersonalFleetOriginalSourceBindings')
  .createOriginalSourceBindings();
const offerAuthority = require('./coopPersonalFleetOriginalOfferAuthority')
  .createSourceBoundOriginalOfferAuthority({
    gameStore: bind.gameStore,
    pf52: require('./coopPersonalFleetHangarBridge'),
    pf53: require('./coopPersonalFleetPaidHiring'),
    access: bind.access,
    // One example *shape*, not real IDs or a free NPC:
    // [{npcCharacterID: <existing SDE character ID>,
    //   employerCorpID: <real NPC employer corp ID>,
    //   profileID: <authored NPC profile ID>,
    //   shipTypeID: <same physical ship type as profile>,
    //   amountCents: <real server-authorized hire price>}]
    authoredCatalog: verifiedOperatorWorkCatalogue,
    enabled: nativePersonalFleetEnabled,
    allWalletWritersFenced: verifiedOriginalWriterHooks,
  });
// Supply offerAuthority.resolveNativeOffer/verifyOriginalNpcPilot/
// verifyNativeEmployer to PF53's real constructor.
 // offerAuthority.verifyHiredPilotHull must be checked BEFORE PF52 reserve
 // and again by PF52.verifyShipAvailable UNDER its own original transaction.
 // offerAuthority.resolvePaidNativeProfile is PF58 adoption's
 // resolveNativeProfile; bind.resolveOwnerCorporation is PF58's
 // original owner corporation resolver.
// Supply listNativeOffers/lookupNativeOffer to the command owner.
// Supply bind.resolveOriginalDockContext / bind.resolveOriginalFollowTarget
// and bind.access to the remaining PF52/PF54/PF55/PF56 constructors.
// Install the /pf gateway only after EVERY real native owner is ready.
```

The `coopPersonalFleetOriginalSourceBindings` file imports exactly
original GameStore, sessionRegistry, structureLocation, stationStaticData,
corporationState and space runtime; it never accepts client-supplied equivalents.
It requires the original character row/account, a single live session,
real docked station or real physical in-space player ship, and a matching
scene entity before producing a FOLLOW target.

**Test evidence this continuation:** 44 real-SQLite native offer cases,
23 source-bound owner/session/ItemStore/scene cases, plus the updated
65 prior Node cases = **118 Node PASS**; 18 Python/Git PASS;
**136 total PASS**. Original actual native EVE gameplay still NOT RUN.

## Physical hull profile compatibility — fixed

PF58's original native adoption rejects a profile whose
`definition.profile.shipTypeID` is not the EXACT original ItemStore hull
`typeID`. This is now checked at **three** stages:

1. Operator-authored catalogue row requires `shipTypeID`; quote creation
   validates it against the actual original NPC profile.
2. `/pf assign` reads the original hangar physical ItemStore hull and
   calls `verifyHiredPilotHull` before reserving it. PF52's native
   `verifyShipAvailable` MUST call the same verifier with its
   **transaction-scoped** original `tx` (not a separate transaction).
3. PF58 adoption calls `resolvePaidNativeProfile(row)`, which
   independently verifies PF52's active employment, the exact PF53
   durable paid receipt and source NPC identity, the unchanged contract,
   and the original hull type. It cannot choose a new profile after
   the money was charged.

The source-bound player adapter also provides
`resolveOwnerCorporation(ownerCharacterID)` from the exact original
character's persisted corporation and the real original corporation
service. PF58 adoption can use it as the mandatory corporate resolver.

**Still NOT installed:** the original native startup composition root
must supply these exact methods to the existing PF52/PF58 constructors,
and original NPC controllers/scene adoption and return need actual WORK
evidence. This is not a claim that actor spawning and docking are
already connected to the running engine.


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
