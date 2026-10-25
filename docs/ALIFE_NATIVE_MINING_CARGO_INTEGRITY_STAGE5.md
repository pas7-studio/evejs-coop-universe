# ALIFE-05 — Strict native mining cargo persistence

Status: P0 actual pinned native writer fix; **opt-in OFF by default; IMPLEMENTED_UNVERIFIED**.
Original pinned EveJS: c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f; original mining module Git blob: 80e8aa4e43afc4665a2a885d03c2fd81e7171eee.

## Confirmed native mining defect

The original appendNpcMiningCargo in services/mining/miningNpcOperations.js falls back to negative cargo IDs when allocation fails, and modifies nativeCargoItems before checking nativeNpcStore.upsertNativeCargo. Failed/uncertain writes can therefore leave apparently mined hull cargo without its matching authoritative native store row or quantity. Process restart can lose a hull-local update after the store committed, risking duplicate new cargo IDs.

## Strict original-writer patch

scripts/coop-native-mining-cargo-integrity-patch.cjs is installed via the existing reversible scripts/patch-evejs-coop.cjs mechanism. It changes the same pinned native mining callback only with EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY=1. Without the flag, vanilla behavior is unchanged.

- Validate positive real hull ID, owner, type ID and safe quantity; no new mining engine, ore minting, wallet, order owner or timer.
- For a new ore stack, check that native store does not already contain the same type for the ship, allocate a positive native cargoID, write via the existing nativeNpcStore authority, read back exact cargoID/owner/hull/type/quantity, THEN update the hull-local cargo. First-time nativeCargoItems is initialized only after successful persistence.
- For an existing stack, demand identical current native store owner/type/quantity, then persist and verify next amount BEFORE updating the local hull.
- Failed allocator: no fake negative cargo. Ambiguous write, failed upsert, bad readback, old negative cargo, duplicate or inconsistent owner: no optimistic credit. Latch an in-process operator-repair blocker and best-effort log living-native-mining-cargo-integrity-blocked. Never auto-retry unknown native writes.
- On restart, a native row with missing hull-local view blocks a new cargoID for the same ore type until operator reconciliation.

**Limit:** this fixes persistence ordering only inside appendNpcMiningCargo. It does not make stock asteroid resource depletion and cargo creation one durable transaction. A mining yield may already have depleted the rock when a storage write fails; no automatic refund or fabricated ore is permitted. Full crash-proof mining economics require coordinated native mining-cycle settlement and real restart tests.

## Local safe preflight

Run from the coop repository in Windows PowerShell:

    pwsh -File scripts/Run-Alife-Native-Mining-Cargo-Tests.ps1 -UpstreamCodeRoot 'C:\Games\EveCoop\upstream-evejs\Code'

Or validate clean pinned upstream alone:

    node scripts/verify-alife-mining-cargo-source.cjs 'C:\Games\EveCoop\upstream-evejs\Code'

Source SHA comparison canonicalizes CRLF for Windows checkout without writing the file. Both LF and CRLF patch/unpatch restore the exact input. The preflight expects a CLEAN original upstream source; a file already modified by other overlays may fail safely.

## Evidence

Isolated V8 source and fault-injection tests: 17/17 PASS. Source wiring, opt-in and manual-gate tests: 4/4 PASS. Full 97,536-byte pinned original mining module parsed after the patch, repeated application was idempotent and removal restored LF and CRLF byte-exact. These are not full Node/EveJS runtime tests.

Eight physical local scenarios in tests/scenarios/native-mining-cargo-integrity-e2e.json remain NOT_RUN, including failed allocator, failed/unknown store write, restart, cargo provenance, miner-to-hauler-to-warehouse custody and two authorized clients.

No Docker, main, evejs-data or live feature flags were changed. Do not enable on a live server until disposable local E2E and source conservation gates pass. PR #114's mining witness and PR #110's warehouse receipt evidence remain readers, not competing sources of items.
