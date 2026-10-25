# P0 — authoritative native loot pickup session and telemetry acknowledgement

## Problem

The original `coopNativeLootPickupEvidence.verify()` accepted a looter from `scene.sessions` based only on `characterID`, same `systemID` and a ship with `kind: "ship"`. A session left in an EveJS scene after disconnect or before a completed Ballpark attach could therefore produce `VERIFIED_NATIVE_LOOT_PICKUP` even though no current active game client was attached. The source debit was real, but **"authenticated live looter" was overclaimed**.

A second failure path: `note()` returned `VERIFIED_NATIVE_LOOT_PICKUP` even when `coopRuntimeProbe.observe()` failed to append the supposed proof to the actual JSONL event file. Existing PR #10 telemetry recovery already makes `observe` return a true/false acknowledgement; this patch now uses it.

## Resolution in current `main` successor

- Keep the original **authoritative upstream item transfer** and **post-grant source debit verification** unchanged.
- Require **exactly one** native scene session with the correct character ID and system, `initialStateSent===true`, a socket not marked destroyed, an existing native physical `kind:"ship"` whose `itemID` matches session ship, and no contradictory `pilotCharacterID/characterID` on that physical ship.
- Preserve negative status `NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER` for stale, uninitialized, ghost, duplicate, wrong-system or replaced identity. No claim that a looter was live merely because an item grant succeeded.
- **Preserve source debit/quarantine precedence**: a removed/decremented-source discrepancy still returns `NATIVE_LOOT_SOURCE_NOT_REMOVED` or `NATIVE_LOOT_SOURCE_NOT_DECREMENTED` **before** session validation. Never hide a dangerous transfer failure because a client disconnected.
- On `note()`, only return `VERIFIED_NATIVE_LOOT_PICKUP` if the probe **returned `true` after a successful append**. A failed or missing event-file writer returns `TELEMETRY_NOT_RECORDED`, `nativeTransferVerified:true`. This says the original in-game item grant succeeded but the evidence itself is missing; it does not roll back or retry the already committed grant. A thrown telemetry exception is logged without disrupting game state.
- No new persistent storage, network listener, new grant, RPC, loot multiplier, direct economy mutation, client modification, or change to `evejs-data`.

## Tests and acceptance

`tests/coop-native-loot-session-proof.test.mjs` adds eight focused regressions: live ready looter, destroyed socket, pre-Ballpark session, native identity/ship mismatch, duplicate session, quarantine precedence after disconnect, failure to append, and **real append-only write to a temporary JSONL file**. Existing native loot test fixture uses a real-ready session, and `scripts/Verify-Local-Coop.ps1` registers the new suite.

The committed code and tests passed **13/13 assertions in an isolated JS harness with in-memory filesystem and runtime-probe dependencies** (existing native-loot suite 5; new suite 8). This is **not** a Windows Docker/two-client playtest or the Node `node --test` run.

Recommended on a pinned, owner-authorized local checkout:

```powershell
node --test tests/coop-native-loot-pickup.test.mjs tests/coop-native-loot-session-proof.test.mjs
```

Run full verifier `scripts/Verify-Local-Coop.ps1` after deploying the approved version. Confirm actual event-file append, log real native wreck item ID, check owner/location against persisted native item store, then disconnect/reconnect a real second client and repeat. Only real client tests can confirm the complete co-op experience.

**Branch is based on merged main `1d71e7fac47ab28dfead53ba7b63482d37e1df41`. Do not infer deployment or client PASS from the tests.**
