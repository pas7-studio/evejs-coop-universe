# ALIFE-06 — NPC mining cycle conservation fence

Status: **DRAFT / IMPLEMENTED_UNVERIFIED**. Depends on PR #119 (native cargo strict writer).
Both flags **OFF by default**. Physical EveJS E2E, disk-crash recovery and two-client observations **NOT RUN**.

## Verified original bug

Pinned upstream `miningRuntime.js` calls `appendNpcCargo` before `applyMiningDelta`.
Stock `miningRuntimeState.js` also ignores its `repo.write` result. A successful
cargo write followed by a rejected asteroid write creates unbacked ore. PR #119
protects the native cargo callback from optimistic local credit but does **not**
solve source depletion ordering. Stock `appendNpcCargo` also discarded the
native writer return value; a settlement caller could not distinguish success.

## Implemented opt-in changes

- `scripts/coop-native-mining-cycle-conservation-patch.cjs` reversibly patches
  the **original** pinned `miningRuntime.js` and `miningRuntimeState.js`.
- In strict NPC cycles only, settle a journal PREPARED record, apply the original
  `applyMiningDelta` before cargo, require exact in-memory source readback,
  mark DEBITED, call PR #119's original native cargo writer and demand
  `true`, then mark COMMITTED. Neither player mining nor vanilla NPC mining
  is reordered when the flag is OFF.
- Preserve the actual `appendNpcCargo` return value in the native wrapper.
- Require the mining state table's `repo.write` acknowledgement on this strict
  path. Failed/unknown state writes abort before cargo credit.
- `integration/coopNativeMiningCycleConservation.cjs` writes journal records
  via temp-file + fsync + rename (and directory fsync on non-Windows), with
  explicit configuration. Missing, corrupt, unreadable or conflicting journals,
  underflow, unexpected readback and unknown cargo credit **fail closed**.
- An unresolved source or miner journal entry blocks subsequent cycles for
  **that asteroid or that NPC**, even across a process restart if the physical
  IDs are restored. Completed cycles require a non-increasing source quantity
  before reuse. No automatic replay of uncertain ore.
- The journal is separate evidence, **not** an alternative item or asteroid
  authority. No market, ISK, refinery, NPC spawn or warehouse grant was added.

## Why this is NOT yet crash-atomic

**Do not call this a transaction or turn it on in the preserved game world.**
EveJS `gameStore` can acknowledge a cache mutation while flushing to disk
later. The asteroid state and `npcCargo` are distinct state records without a
demonstrated shared durable transaction. A crash can occur between:
1. journal PREPARED, source write, source readback;
2. source debit and native cargo credit;
3. native cargo credit and journal COMMITTED;
4. either gameStore cache acknowledgement and durable disk flush.

The journal quarantines known/visible uncertainty but cannot promise both
records are durably committed. During normal execution, debit-first chooses
**no ore minted without source debit** over guaranteed immediate ore delivery;
failures can temporarily lose yield and require operator reconciliation.
Do not manually delete PREPARED/DEBITED/UNCERTAIN entries until native source
and cargo IDs/quantities have been checked and repaired on an isolated copy.
There is no automatic resolver. Windows directory fsync limitations further
weaken crash durability, hence full restart and kill tests are mandatory.

## Opt-in safety (disposable local copy only)

1. Merge/rebase after #119; use the same pinned EveJS checkout
   `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.
2. Create a separate, pre-existing, **absolute** private journal directory
   outside the preserved `evejs-data` volume; do not reuse it between tests.
3. Configure these only on the disposable test server:

```text
EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY=1
EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION=1
EVEJS_COOP_MINING_CYCLE_JOURNAL_DIR=<absolute-private-existing-directory>
```

The cycle flag must never be used without the cargo integrity flag.
If the journal directory is not configured, the strict NPC cycle refuses
to debit the asteroid. Both flags OFF use the pinned stock order unchanged.

## Safe verification commands

```powershell
pwsh -File scripts/Run-Alife-Native-Mining-Cycle-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'
```

The verification runner executes isolated Node source/fault tests and a
read-only pristine pinned source SHA/parse/reversibility gate. It **does not**
launch Docker, modify the original EveJS Code, open gameStore, touch the
preserved `evejs-data` volume or mark physical scenarios PASS.

## Follow-up P0 to achieve real atomicity

Use a single durable authoritative mining settlement owner (shared transaction
or transactional/outbox reconciliation with *durably acknowledged* records)
for `miningRuntimeState` and `npcCargo`, including persistent ID/actor identity,
restart repair or exact compensation, and handling for full depletion, cargo
ID conflicts, owner changes and multi-miner contention. Then run
`tests/scenarios/native-mining-cycle-conservation-e2e.json`, and finally
the PR #110/#114 native miner → hauler → warehouse provenance and two-client
observations. Until that acceptance passes, mark ALIFE-06
**source conservation hardening**, not fully atomic mining.
