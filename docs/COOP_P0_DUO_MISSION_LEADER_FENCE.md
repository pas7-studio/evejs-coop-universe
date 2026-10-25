# P0: durable first-recipient fence for two native mission rewards

This change completes the existing peer-only safety perimeter without pretending the two native reward writes are globally atomic. Native EveJS rewards are independent writes across wallet/LP/standing/inventory/mission state; a crash can still leave a partial payout requiring operator reconciliation.

## What changed

- New independent persistent first-recipient journal: /var/lib/evejs/coop-duo-mission-leader-fence.jsonl (optional absolute override EVEJS_COOP_MISSION_LEADER_FENCE_FILE).
- **PREPARED** is appended and fsynced before the original native leader DoAction. If the journal cannot be read or fsynced, the stock action is blocked before any leader award.
- **LEADER_NATIVE_CLEARED** records *only* that leader DoAction returned success and the native leader mission is now absent; it is not proof of wallet/LP atomicity.
- Existing peer journal /var/lib/evejs/coop-mission-turnin.jsonl still writes PREPARED before the wingman's independent native DoAction, then AWARDED only after stock success + native mission deletion.
- **BOTH_NATIVE_CLEARED** is appended to the leader journal only after the peer's native result and peer journal have both been acknowledged. This is evidence of two mission removals, **not** a cross-store exactly-once guarantee.
- The first-recipient fence key contains character ID, agent ID, native leader mission sequence, content and template. Ephemeral native fleet ID and peer identity are intentionally excluded: changing fleet or wingman cannot reset that leader's same mission payout guard.
- PREPARED from an interrupted process, malformed journal, invalid state transition, fsync uncertainty, duplicate native mission identity or unacknowledged native DoAction all fail closed. Never automatically rerun potentially paid rewards.
- Reused the existing two L1 native agentMgrService statements. The post-native statement now passes the real leader action result; the updated statement is also registered in the transactional installer's reversible strip list.

## Activation and preservation

All original stock solo missions continue unchanged by default. New PowerShell option **-LivingCoop -EnableDuoMissionSettlement** sets BOTH EVEJS_COOP_FLEET_MISSION_TURNIN=1 and EVEJS_COOP_FLEET_LEADER_FENCE=1 only when explicitly requested; absence of LivingCoop is rejected. Do not use the old peer-only environment flag as a production release configuration.

This work is compatible with the independent opt-in wingman native Request Mission alignment of PR #41, and with NPC chat, native market, native trade/custody and vanilla fleet warp. All existing main hooks must remain present through integration.

## Verification evidence

- 12/12 committed leader-fence regression scenarios passed against the source modules under an isolated JS/V8 filesystem-compatible runner. Tests cover first/second payout phase receipts, no native leader action on precommit failure, crash/restart uncertainty, wrong fleet/peer replay, malformed journal, invalid transitions, peer failure, and absent leader acknowledgment.
- Actual pinned upstream EveJS c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f, file server/src/services/agent/agentMgrService.js: full source transform parsed, inserted the precise native result hook only once, reapplied idempotently, and removed byte-for-byte.
- New tests/coop-duo-mission-leader-overlay.test.mjs checks native hook contract and both flag gates. **Official Node, Windows, Docker, and two real clients have not yet passed acceptance in this review.** Existing 18 cooperative-action contracts still need the full local regression run.

### Read-only owner-local checks

1. Run node --test tests/coop-duo-mission-leader-fence.test.mjs tests/coop-duo-mission-leader-overlay.test.mjs tests/coop-fleet-p0-cooperative-actions.test.mjs
2. Set EVEJS_COOP_CODE_PATH to C:\Games\EveCoop\upstream-evejs\Code, then run node --test tests/coop-crossstream-overlay-roundtrip.test.mjs tests/coop-duo-mission-leader-overlay.test.mjs
3. Run node scripts/patch-evejs-coop.cjs --code-path <PINNED_CODE> --dry-run and --check.
4. Do not mutate the running EveJS tree or persistent evejs-data volume to make a test green; an older deployed revision can legitimately report stale/missing overlay in --check.

### Controlled acceptance (disposable cloned save ONLY)

Use two separate native clients and one ordinary allowed dungeon agent. Verify their separately accepted/completed missions, native fleet, original leader PREPARED before DoAction, leader native success and mission removal, then peer native PREPARED / AWARDED and BOTH_NATIVE_CLEARED after its own success. Compare independent wallet/ISK, LP, standing, native item IDs, hangar and mission journals before/after. Fault-inject only on a disposable copy: before leader action, during leader payout, before peer, and after peer native state removal. Every ambiguous result must leave a durable stop/repair status, not an automatic duplicate payout.

The unresolved larger problem is still genuine multi-store atomicity within native wallet/LP/inventory/mission writes. This feature provides a durable safety boundary and traceability, not an assertion of atomic exactly-once dual-pilot rewards.

**No main merge, Docker restart, CI, live inventory/market changes or original evejs-data modifications.**
