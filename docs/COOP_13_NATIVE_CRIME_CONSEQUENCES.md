# Chat 13 — native combat consequences and remaining financial gates

Pinned source: `gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
Co-op revision audited: `bb3ff00dcf3605c5b6ff7bdf5bd01e4b47be1adb`.
No gameplay or local Docker/client evidence was available in this chat.

## Implemented, isolated change

`integration/coopNativeConsequences.cjs` now verifies the actual physical
attacker ship or owned drone in the same native scene, requires a unique
Ballpark-ready authenticated session, and uses the existing
`coopSessionPresence.admission(..., nativeAuthority())` account/active-ship
check. It rejects absent/stale/ambiguous owners, missing physical attackers
and a caller-supplied `killerCharacterID` that disagrees with the actual
native pilot. The native NPC victim must have a matching durable wreck and
a spawned native physical wreck at the destruction hook.

Standing changes remain in the pre-existing durable once-only ledger
(`createConsequences`) and call **native** `standingRuntime`; there is no
alternative wallet, killmail, ship, or Crimewatch implementation.

The old miner-defense bonus, triggered solely by an NPC controller's
`currentTargetID` / `preferredTargetID`, has been disabled. Those fields
are not post-kill proof of a defended ship. A future earned bonus requires a
verified native combat event (damage from pirate to mining ship, matching
victim/wreck/time and a verified player final blow), not inference.

`resolveAuthenticatedPlayerID` is kept for existing AI memory behavior;
money/standing mutations call the stricter `resolveVerifiedPlayerID`.

## Checked source paths / native behavior

- `services/security/crimewatchState.js`: native weapon/PvP/NPC and
  suspect/criminal timers, security penalties, CONCORD response, kill rights.
- `space/combat/killmailTracker.js`: native final-attacker tracking,
  killmail creation, kill-right consumption and payout call sites.
- `services/bounty/bountyRuntime.js`: NPC bounty aggregation;
  `services/bounty/playerBountyState.js`: player bounty claims.
- `services/insurance/insuranceRuntime.js`: insurance contracts,
  payout ledger and wallet credit.
- `space/npc/nativeNpcWreckService.js`: physical NPC wreck spawn and
  legacy grant-before-source-debit loot path (a separate loot-quarantine
  safety module already exists).
- `integration/coopNpcDestructionAttacker.cjs` is separately owned;
  explicit `options.attackerEntity` remains the only source of truth.

## Significant unresolved native defects and ownership boundaries

1. **Insurance idempotence:** upstream `handleShipDestroyed()` credits
   the wallet before storing `payoutLedgerByLossID`. Crash or persistence
   failure between these steps allows a second payment on retry.
   Fix requires native wallet atomic idempotency keyed to the actual
   authoritative destruction loss ID, not a second co-op money ledger.
2. **Player bounty:** `killmailTracker.resolveBountyPayout()` can claim
   player bounty and credit wallet before creating the killmail. A retry or
   ambiguous wallet result needs native transactional reconciliation.
   `bountyRuntime` already has a source-ref guard for NPC accrual.
3. **Loot legality:** the native wreck item transfer is grant-first and
   checks inventory source removal afterward. Other owners (chat 12),
   native Crimewatch/suspect theft (chat 13), and shared authoritative
   inventory hooks (chat 01) must coordinate before enabling new grants.
4. **Crimewatch and CONCORD:** source reviewed, but no controlled
   highsec/lowsec/nullsec PvP tests or real two-client validation.
5. **Insurance, bounty and kill rights:** no automatic payout redesign or
   native hooks were changed by this patch. Do not claim these defects fixed.

All cross-cutting `scripts/patch-evejs-coop.cjs` / native hooks remain
owned by chat 01. No additional hook is required for the narrow standing
fix because the `coopNativeConsequences` module is already copied and
invoked after native wreck materialization.

## Tests / status

New `tests/coop-crime-consequences-auth.test.mjs`: six isolated
regressions covering real character, physical ship/drone, session
ambiguity, wrong system, replay/restart deduplication, mismatched
killer hint, missing physical wreck, non-NPC victim, disconnect and no
controller-target-derived miner-defense reward. These are code-level
tests, not EveJS live gameplay.

Status: **CODE_READY / LIVE_UNVERIFIED** for this narrow fix;
**BLOCKED_NATIVE_ATOMIC_PAYOUT / LIVE_UNVERIFIED** for the complete
Chat 13 objective. Native ledger/wallet and loot defects remain open.
