# P0 — Native trade stage custody and crash recovery

**Branch:** `fix/coop-p0-trade-stage-recovery-20261025` based on the reviewed current-main rebase of PR #19, `integration/coop-p0-native-trade-20261025` (PR #23). **This PR depends on #23 and supersedes its stage-custody limitation; do not deploy #23 without reconciling this work.** Pinned EveJS SHA: `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Native failure mode found

Pinned `tradeMgrService._stageItemIntoTrade()` moves an item to a synthetic trade container immediately, then only records `trade.stagedItemOrigins` in a **RAM-only Map**. The service constructor resets `_tradeOrdinal = 1` on every process start. A crash can therefore strand inventory items in a synthetic container; after restart, a new trade may unknowingly reuse the **same container ID**. The previous PR #23 protects atomic **completion** but cannot repair an already staged orphan.

## Implemented (optional only)

`integration/coopNativeTradeCustody.cjs` and `scripts/coop-native-trade-custody-patch.cjs` integrate through the **existing single transactional pinned-source installer**.

- **Before** the native move, validate one fully identified root, owner, source location/flag, item type and exact stack quantity, then append and `fsync` a `PREPARED` intent to `/var/lib/evejs/coop-native-trade-custody.jsonl`. The JSONL file must be on the persistent server data volume; an unusable file blocks the action before moving inventory.
- Native `moveItemToLocation()` remains authoritative. Once the exact same root is observed in the native result, append and `fsync` `STAGED`. Any uncertain result blocks future operations.
- **Partial-stack staging is deliberately blocked in atomic-trade mode** because a native split may create a different item ID. The original unmodified stock trade works when atomic-trade mode is OFF. Full stacks, including whole ships, are eligible.
- On service startup with `EVEJS_COOP_ATOMIC_TRADE=1`, read all journal events and the native current item snapshot. Never reuse any journaled container ordinal. If the native container contains **unknown/unrecorded** items, or if IDs, native owner, item type, stack quantity or item location disagree, refuse all further trades with an explicit repair status.
- If journaled active roots are still in their original source location (crash before move), do nothing to their native state. Roots still staged under their **original owner**, type and stack quantity are returned to their exact original location/flag in **one** `itemStore.writeItems` batch followed by native `repo.flushTableSync("items")`. `RECOVERED` is durably written only after the flush succeeds. A failure remains unresolved, never silently reported as success.
- Before BOTH players' final offer acceptance reaches native wallet/item settlement, the guard compares the full authoritative in-container manifest against exactly one durable `STAGED` record per physical root, with matching owner, type, stack and source location. An unknown extra item, PREPARED-only record or changed native root blocks completion BEFORE money/item transfer.
- Normal native Abort verifies all roots returned and flushes, then records `ABORTED`; normal atomic completion validates that each exact root is owned by its specific recipient at the correct station and records `COMPLETED`.
- Native child modules and cargo stay inside the same ship/item IDs; no synthetic ship IDs, wallet grants, escrow owner changes, item duplications or character changes are introduced.
- No external library, parallel patch system, CI, public listener, client modification, Docker rebuild or main merge.

The new default-OFF code uses the **same existing explicit operator opt-in** as PR #23: `-LivingCoop -EnableAtomicCoopTrade` emits `EVEJS_COOP_ATOMIC_TRADE=1`. Ordinary LivingCoop continues untouched.

## Safety limits / explicit blockers

1. This is **not** a cross-table wallet + item transaction. Atomic-trade mode rejects all nonzero ISK offers; ordinary native wallet settlement is not touched.
2. Corrupted journal, an old pre-feature orphan, non-unique root identity, unexpected stack split/merge, failed native flush or item already owned by a recipient **must not** trigger guessed restoration. These are `COOP_TRADE_CUSTODY_BLOCKED` / operator repair, not a false successful recovery.
3. The first creation of the JSONL file and every subsequent record depend on the persistent mount. The procedure never intentionally erases `evejs-data`; operators must verify the location survives container/image restarts.
4. This protects **full-stack native trade staging** after an approved opt-in, and prevents blind reuse of old container IDs. It does not retroactively discover an unknown asset's prior location when historical pre-feature trades lacked journal entries.
5. A live crash/fault-injection experiment must use a **disposable, separately backed-up data volume**. Never kill the running owner's production server or simulate power loss on `evejs-data` just to demonstrate a PASS. Test player-visible trade completion and correctness on two real clients before declaring the feature supported.
6. A 16 MiB journal bound fails closed instead of silently discarding history. Compaction/archive is a separate operator-maintained task; it must preserve all unresolved entries and monotonic high-water container ordinals.

## Verification recorded on the branch

- **18/18** deterministic native custody cases ran against the committed module in an isolated V8 compatibility harness: PREPARED-before-move, exact STAGED, crash recovery of whole ship/root while keeping nested cargo, unjournaled orphans, bad journal, owner/type/stack mismatch, unexpected recipient, flush uncertainty, ordinary Abort and Complete, no duplicated stage intent, and no mutation on failed precommit.
- The actual upstream pinned `itemStore.js` and `tradeMgrService.js` were fetched. Combined **atomic trade + custody source hooks** parsed successfully, were idempotent when re-applied and restored byte-for-byte. The **current-main integrated** `scripts/patch-evejs-coop.cjs.transform()` also passed both source roundtrips.
- Added `tests/coop-native-trade-custody-overlay.test.mjs` for official native source check and default-OFF native hook wiring.

**Not verified:** full Node `node --test` on owner Windows machine; complete pinned native fixture tests; Docker/SQLite real power-loss durability; real two-client trade and reconnect. The isolated harness exercises application logic but cannot establish those properties.

### Manual commands (read-only by default)

```powershell
node --test tests/coop-native-trade-custody.test.mjs tests/coop-native-trade-custody-overlay.test.mjs
node --test tests/coop-native-trade-atomic.test.mjs tests/coop-atomic-trade-overlay-contract.test.mjs
node scripts/patch-evejs-coop.cjs --check --code-path C:\Games\EveCoop\upstream-evejs\Code
node scripts/coop-test-baseline.cjs
```

**Expected acceptance:** clone test volume, allow a whole native item/ship to enter a trade container, simulate a controlled test-only interrupted stage, restart, check exact same item IDs back under the original owner/location with no duplicate; also test the ambiguous case blocked pending operator reconciliation. For a successfully completed trade, inspect both native inventories, wallet invariant, fitted modules/cargo custody and normal reconnect. Report the exact project revision, upstream pin, Docker image, named volume and two-client observations separately.

**Rollback:** use the normal transactional installer `--remove` on the approved checkout, with a verified backup and matching native source; do not hand-edit upstream files or remove the journal while unresolved assets exist.
