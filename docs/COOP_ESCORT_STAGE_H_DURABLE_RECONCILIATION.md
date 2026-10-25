# P0 Escort Stage H: native durable replay and warp crash fence

DRAFT. Based on Stage G PR #93. Nothing merged to main; all new features OFF. No Docker, EVE client or evejs-data modification.

## What changed

- Stage C now has listDelivered({systemID,maxTrips}). It scans only bounded original FSYNCED native flight journals. Scanned maximum 512, returned maximum 64. Full file read/provenance must pass; corrupt, symlink, excessive, unreadable or mismatched sources block the scan. Enumeration never pays money.
- Stage E has reconcilePendingDeliveries({systemID,maxTrips}) behind EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY=1 (32 max). It replays only actual completed station delivery journal keys, checks genuine matching PIRATE_WRECK_CONFIRMED from native combat with unique two-player contribution/wreck, then calls the existing Stage A/B/C native wallet settlement. Real SETTLED receipts with exact TWO native wallet credits produce ALREADY_NATIVE_SETTLED; REFUNDED or uncertain ledger result blocks. Missing pirate stays pending. No credit from a chat command, fake NPC or timer.
- The actual native Killmail Tracker noteDamage hook initiates the scan ONLY after it has durably recorded a real TWO player intervention AND a genuine pirate native wreck. Server bootstrap can also run the limited scan after authoritative GameStore initialization. Different event arrival order is supported.
- Stage C recordDelivered now accepts an EXACT replay of a previously committed real station terminal receipt after lost fsync acknowledgement: same real trip, station, hauler, original manifest, cargoIDs and quantity. It returns original DURABLE_NATIVE_DELIVERY_RECORDED without appending another event or creating items/ISK. Altered evidence fails.
- New coopEscortWarpFence writes ORIGINAL cargo-bound WARP_PREPARED (file fsync+dir fsync) AFTER real corporate escrow was reserved and BEFORE invoking stock warpToPoint. After real ACK, WARP_ACK_CONFIRMED is fsynced. On restart any PREPARED or ACK_CONFIRMED native cargo source blocks a second warp, even if the attempted new manifest timestamp is different. Uncertain/corrupt/absent fsync fails closed for operator repair.
- Paid station director now REQUIRES EVEJS_COOP_ESCORT_WARP_FENCE=1 plus real durable provider before any manifest, escrow or warp. The source is checked before paid authorization. Unknown native ACK cannot progress to cargo terminal settlement without reconciliation. Default flags remain OFF.
- Fixed the erroneous native refund manifest regex which had rejected valid numeric manifest keys.

## Evidence in this session

- 11/11 isolated V8 checks on actual committed warp fence source PASS: original cargo, durable intent, process restart, native ACK and idempotence, flags OFF, malformed journal.
- 10/10 isolated V8 checks on actual committed Stage C flight source PASS: one escrow, real terminal, exact idempotent delivery replay, conflicting cargo blocked, bounded persistent scan and corrupt-journal denial.
- 10/10 isolated V8 checks on actual committed native binding PASS: no incident remains pending, late native pirate pays once, replay sees native ALREADY_NATIVE_SETTLED, corrupted scan denied.
- 9/9 isolated V8 checks on actual committed physical station director PASS: original cargo and wallet once, durable warp ACK, restart same cargo blocks warp, no required fence blocks launch.
- 12/12 changed integration/installer/test sources parse.
- Actual Node v22.16.0 run from locally available older Stage A/B source snapshots: 25/25 PASS with experimental SQLite and rollback tests. This does NOT cover the latest Stage H source, whose complete repository cannot be cloned in this container (GitHub DNS unavailable). New Node test files committed, but not executed here.
- New native Node suites: tests/coop-escort-durable-warp-fence.test.mjs (10), tests/coop-escort-durable-flight-recovery.test.mjs (6), expanded tests/coop-escort-native-binding.test.mjs (14), tests/coop-escort-station-predeparture-gate.test.mjs (12).

## Runbook for local disposable test copy

Run from project root, after fetching the PR in a real local environment with Node 22:

    node --test tests/coop-escort-durable-warp-fence.test.mjs tests/coop-escort-durable-flight-recovery.test.mjs
    node --test tests/coop-escort-native-binding.test.mjs tests/coop-escort-station-predeparture-gate.test.mjs
    node --test tests/coop-escort-*.test.mjs

Check native reversible installer with --check and --dry-run against a disposable pinned upstream checkout. No GitHub Actions and never reset or delete the real evejs-data volume.

Native two-client acceptance: both independent in-game /events accept; actual NPC corporation escrow; one physical hauler warp; complete itemStore warehouse delivery; true pirate and two pilot native combat witness; two exact real player wallet credits. Retry after restart: no second payout, warp or created goods. Also test the reverse order (real pirate dies after delivery) and original hauler wreck before delivery (zero native warehouse receipts and no original warehouse items, one corporate refund). Simulate crash after WARP_PREPARED, after stock warp before WARP_ACK_CONFIRMED and after real DELIVERED fsync before acknowledgement; none may duplicate native money/cargo or fleet movement. Document operator repair evidence for any unknown native warp.

## Still blocked for live deployment

Full latest-branch Node and pinned real better-sqlite3/GameStore worker runs; actual EVE client smoke tests with two logged-in player characters; permanent native warehouse provenance after manufacturing, native NPC fleet scene persistence, and proven operator-only warp reconciliation. The current durable fence deliberately refuses guesses, rather than automatically moving a possibly already moved ship. No live GO or issue closure until these pass.

Leave all Stage G financial flags OFF. Additional required opt-in when testing on a disposable world:
 EVEJS_COOP_ESCORT_WARP_FENCE=1
 EVEJS_COOP_ESCORT_SETTLEMENT_REPLAY=1

No merges or production data mutation in this development turn.
