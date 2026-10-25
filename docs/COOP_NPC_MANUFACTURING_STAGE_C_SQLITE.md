# COOP-032C — Offline atomic settlement of READY NPC manufacturing jobs

**Status: code + isolated SQLite tests only. NOT a live EveJS factory.**
Depends on COOP-032B PR #50. Source schema and statuses checked against pinned
`gameboys84/EveJS@c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`.

## Scope and immutable safety rules

`integration/coopNpcIndustryOfflineDelivery.cjs` is a disposable-DB-only
settlement core. It requires `offlineExclusive: true` and trusted, separately
implemented `verifyNativeOwner`, `verifyNativeOutput`,
`verifyNativeIdFloor`, and `buildNativeOutputItem` callbacks.
**These callbacks are NOT production-bound in this PR.**
Its return object explicitly includes `supportsAtomicDelivery:false`.
Do not add it to the runtime module list, start a scheduler, patch the live
industry runtime, or call it against `evejs-data` or a running GameStore.

The installer from PR #50 produces `status=1` INSTALLED jobs. This settlement
requires **real persisted `status=3` READY**, an elapsed native FILETIME
`endDate`, a valid immutable `coopOperationID`, the exact attached
native quote, verified native output, genuine original BPO in installed
location 2003 and matching `industryBlueprintState.records` custody.
An elapsed deadline with `status=1` is *not* enough.

After `BEGIN IMMEDIATE`, in one SQLite transaction:

1. Verify the single matching job and canonical owner, BPO, station, output and
   quantity (charge category 8, exactly one safe-sized stack).
2. Read the native flat `identityState.nextItemID` SQLite row; allocate only
   above that counter and the entire current `items` high-water mark, with
   a required trusted independent namespace collision check.
3. Write one native-shaped `items` output stack tagged with the real job ID;
   atomically advance `identityState.nextItemID`.
4. Restore the original NPC-owned BPO item to its original station; release
   the matching BPO job state.
5. Transition the real `industryJobs.jobs` record to status 4 DELIVERED,
   persist job-owned output receipt and delivery FILETIME.
6. A repeated operation can only return ALREADY_DELIVERED when the output,
   BPO, job and receipt still match. A missing or corrupted receipt blocks.
   Every pre-commit failure rolls back all four tables.

The material cost and corporation ISK were already consumed by installation
and are **not paid or minted again** during settlement.

## Test evidence and remaining blocker

Local Node 22 `node --test tests/coop-npc-industry-offline-delivery.test.mjs`:
**20/20 PASS** using disposable, file-backed `node:sqlite`.
Six injected crash windows roll back all four tables byte-for-byte;
other cases cover readiness, time, BPO custody, output authority, invalid
native ID state, duplicate operation, receipt corruption and replay.

The test driver is not upstream production `better-sqlite3`; the
`buildNativeOutputItem` test callback checks shape but does not establish
upstream itemStore API compatibility or real SDE availability.

**P0 blocker before enabling:** COOP-032B cache-coherent transaction bridge
in the *running* pinned GameStore. It must coordinate the native SQLite
connection, debounce + in-flight persistence worker, dirty rows, baselines,
cached `items` and the independent itemStore indexes. A second SQLite
connection behind the active GameStore cache is forbidden. Bind the real
canonical SDE quote and native item builder/owner verifier; prove native
player/NPC reads of the new item after transaction + restart. A full
isolated runtime fault-injection/restart test then gates the feature flag.

**After that:** connect the COOP-032A journal `deliverOnce` proof and then
COOP-033 NPC sell escrow / real native market orders and two-client
purchasing. No claim of playable NPC manufacturing before those gates.

No Docker, CI, market reseed, live database mutation, main merge or
production deployment performed here.
