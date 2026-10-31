## P0 — confirmed loot duplication when the wreck-source write fails after the destination grant

Found during MISSION 001 (behaviour-preserving refactor of
`transferNativeWreckItemToCharacterLocation`, PR #1). This is a **pre-existing** defect on
`coop/pas7std` at `9de4f74868f226451cd1c75ef5be00d4bd7c4851`; the refactor deliberately preserves it
and only documents it in place.

### What happens

The function grants the item to the character first and then removes/decrements the wreck source row.
`nativeNpcStore.removeNativeWreckItem(...)`'s result is never checked, and the upsert branch returns a
failure only after the grant is already committed.

Measured on the untouched baseline (isolated store, real `nativeNpcStore`/`itemStore`): with a 4-unit
wreck stack and the source removal forced to fail,

- result: `{ success: true, data: { quantity: 4, changes: [{ removed: true, ... }, ...] } }`
- destination: 4 units
- wreck source: still 4 units
- **total 8 units exist for a 4-unit stack**

Reproduction lives in `tests/coop-native-wreck-loot-failure-paths.test.mjs`
(`a failing source store duplicates the granted units and still reports success`), which asserts the
defective behaviour today so it cannot change silently.

### Why the obvious fix is not enough

Returning `success: false` and calling `coopNativeLootQuarantine.quarantine(...)` **after** the grant
does not prove atomicity: it records the ambiguity but does not establish that a partial failure
cannot create duplicate assets, and it does not survive a crash between the two writes. The acceptance
for this issue is proof, not a policy statement.

### Required acceptance (all must be demonstrated)

1. **No silent duplicate on either branch**: the full-removal path *and* the partial-decrement path
   (`upsertNativeWreckItem`) must be proven, not just the removal.
2. **Fault injection at the store boundary**, not at the service: force the source write to fail
   (throw and return-`success:false` variants) and show the invariant
   `destination units + source units == pre-pickup source units` holds, or that the operation is
   reported as failed and fully undone.
3. **Crash window**: kill the process (or the container) between the destination grant and the source
   write; after restart, show that replay/recovery does not mint a second copy — i.e. the post-restart
   invariant is checked, not inferred.
4. **Restart**: the same checks after a clean stop/start and after an unclean one.
5. **Concurrency**: two competing pickups of the same wreck item must not both grant.
6. **Regression**: the existing characterization suite (16 tests, `tests/coop-native-wreck-loot-*.test.mjs`)
   must keep passing, with the `BASELINE-DEFECT` test updated to the corrected, asserted behaviour.

### Suggested direction (not binding)

Decide ownership of the write pair explicitly: either (a) debit the source first and grant the
destination second, treating a failed grant as a retryable pending state with durable recovery, or
(b) keep the order and make the grant reversible with a durable "in-flight" record that recovery
resolves on boot. Both need the durable record to live where a crash cannot lose it.

### Out of scope

The MISSION 001 refactor (PR #1). This issue must be fixed in its own change with its own evidence.
