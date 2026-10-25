# P1/P2 — Actual native Escort tactics, rescue navigation and audited reputation

Status: Draft, default OFF. Source of truth: current 2026-10-25 main. No changes to live Docker, actual EVE clients, main, or evejs-data. Stage H PR #96 is a separate parallel finance/restart PR and is NOT silently overwritten by this branch.

## Real in-game commands

- /events tactic <convoy-event-id> hold
  A specifically authorized original paid convoy duo commander instructs the STOCK nativeNpcRuntime.stop(entityID). EveJS sets real ship movement to STOP and NPC controller manualOrder.type=stop; the server re-reads both from the actual scene/behavior controller before confirming. No fictional fleet position or Destiny packet.
- /events tactic <event-id> continue
  Calls stock nativeNpcRuntime.resumeBehavior. Re-reads that NPC controller.manualOrder is cleared, handing behavior back to real NPC AI. Not a teleport or a second escrow debit. Future NPC AI behavior/tick determines its next actual movement; this is not a guarantee that the original route and future cargo delivery complete.
- /events tactic <event-id> retreat
  Issues actual native NPC manualOrder.type=returnHome. The pinned NPC behavior loop has a real syncNpcReturnHome branch; controller authority is observed. The physical return occurs in subsequent server ticks. No fabricated in-scene jump or automatic contract refund.
- /events rescue <event-id>
  Only a previously verified real contract participant can command their OWN actual connected EVE ship toward a genuine native hauler wreck. Source checked: original PREPARING/DEPARTED event, immutable paid flight and manifest, original EVE duo, exactly one real hauler-loss outcome, actual native wreck and original cargo-matched wreck items. Far player ships use stock warpToPoint; near ships use stock FollowBall because native warp cannot occur within minimum warp distance. The command does NOT move cargo into player inventory or NPC warehouse and never grants ISK. Player must use native wreck inventory/loot UI. No fake completed rescue is recorded by this action.
- /events history and /events reputation
  Read from actual immutable per-character verified terminal contract history. Source records are CREATED by the native payout/refund code only after verifying original Stage A SETTLED/REFUNDED state, actual corporation balance and two wallet credits or real refund witness, plus unique native pirate/cargo proof for paid completions. Each actual PAID gives both relevant players +10 reputation points, earns each exact half the real total ISK, TRUSTED after 5 PAID, VETERAN after 20. Refund entries record history but give zero earned ISK and zero positive points.

## Implementation details

- integration/coopEscortNativeTactics.cjs: fixed a genuine bug in the old tactic gate: actual NPC source fleetID and actual player fleetID are DIFFERENT. It now checks the separately attested playerFleetID and won't require NPC = EVE player fleet.
- integration/coopEscortTacticalGame.cjs: strongly authorized server adapter using original cargoID, original contract booking, two live physically present EVE player sessions, actual stock EVE fleet membership and correct NPC hull/controller. Only the first of the two verified consenting pilots may command the NPC. Native stock stop, resumeBehavior and returnHome calls are observed, rate-limited, and unacknowledged commands fail closed.
- integration/coopEscortRescueNavigation.cjs: player-initiated real EVE movement; strict original cargoID to wreck-item provenance. Native loot transfer stays in stock game and requires actual itemStore proof before counting recovered inventory. Only travel is acknowledged.
- integration/coopEscortNativeMount.cjs + coopEscortNativeBinding.cjs: one native terminal wallet authority now writes reputation after confirmed SETTLED/REFUNDED and retries a missing fsync HISTORY without repeating original wallet credits. The existing read-only /events history and /events reputation commands display consequences.
- integration/coopWorldOpportunityBoard.cjs: adds stock chat event commands (native overlay's original /events hook reused).
- scripts/patch-evejs-coop.cjs: adds both source modules to the pinned, reversible overlay copy list, preserving all other existing A-Life, industrial and combat modules. Flags all remain OFF.

## IMPORTANT: rescue cargo-provenance blocker

The pinned upstream nativeNpcWreckService writes native loot items but does not guarantee an item.sourceCargoID linking the ORIGINAL native hauler cargoID to the wreck. The rescue gate refuses same-type loot without this link. Thus actual native movement is implemented, but a full source-linked cargo-rescue flow may remain BLOCKED until the upstream destruction-to-wreck materializer durably preserves original cargo provenance and the stock itemStore confirms genuine loot transfer. NO workaround that duplicates goods or synthesizes native IDs is acceptable.

Other pre-live limitations:
- Real game client/stock Destiny movement and native itemStore/loot transfer must be tested in two logged-in EVE clients. We cannot claim native physical gameplay PASS from isolated function stubs.
- RETREAT's returnHome is a genuine NPC AI order, but whether the NPC resumes an intended delivery route later depends on the pinned NPC loop, not simply chat success.
- Original fleet commander design: the lower-character-ID of the original pair is the designated authority; future UI could allow mutual delegation with durable explicit consent. No chat command unilaterally joins a fleet or creates a corporation wallet.
- Stage H #96 changes similar ESCORT binding and native station; merge carefully on updated main once full native tests pass. Preserve all concurrently merged main modules.

## Tests in this turn

Isolated V8 source-shaped tests (NOT live client gameplay):
- 10/10 stock native tactics authorizations, real controller STOP/resume/returnHome and cooldown PASS.
- 8/8 true native wreck rescue warp/denial checks PASS on initial source. After additionally adding short-range FollowBall, new official Node regression tests cover both.
- 7/8 first reputation source-shaped checks PASS, with remaining discrepancy limited to expected negative-error name; it correctly rejected a forged contract with CONTRACT_IDENTITY_CORRUPT, rather than NATIVE_TERMINAL_NOT_CONFIRMED.
- 10/10 changed source and new Node test file JS syntax checks PASS.

New official runnable Node regression files committed, not executed as full Node runner here:
- tests/coop-escort-native-player-tactics.test.mjs (6)
- tests/coop-escort-native-rescue-navigation.test.mjs (7)
- tests/coop-escort-native-terminal-history-writer.test.mjs (6)

To run locally, with Node 22 and a DISPOSABLE data directory:
    node --test tests/coop-escort-native-player-tactics.test.mjs tests/coop-escort-native-rescue-navigation.test.mjs tests/coop-escort-native-terminal-history-writer.test.mjs
    node --test tests/coop-escort-*.test.mjs

Full two-client acceptance:
1. Two real players opt in, explicitly accept one real native corp-funded quote. First authorized commander commands HOLD and sees NPC physically stop; second unapproved player is denied.
2. Commander commands CONTINUE then RETREAT; inspect actual native NPC controller and movement after subsequent NPC AI tick (not just command response).
3. Genuinely destroy an NPC hauler, inspect real native wreck and cargo source IDs. Both real clients can travel through /events rescue and loot via native UI. Verify no free ISK, no extra cargo materialization and inventory source/destination evidence.
4. Complete genuine native escrow/verified pirate defeat/full cargo delivery; verify the same authentic two EVE characters see audited PAID and appropriate score/ISK in /events history. Test real REFUNDED separately with zero points.
5. Replay after restart: no duplicate wallet credit, reputation entry or stock; ensure old source event cannot command a different NPC.

All new flags default OFF:
 EVEJS_COOP_ESCORT_TACTICS=1
 EVEJS_COOP_ESCORT_RESCUE_NAV=1
 EVEJS_COOP_ESCORT_REPUTATION=1

Only enable in an isolated test world after authoritative core Escort flags and two-client tests.
