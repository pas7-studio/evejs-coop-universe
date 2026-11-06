# PF-59 — Fail-closed original ship native cleanup gate

**NOT gameplay-ready. This package is a review-only candidate, not installed in `pas7-studio/EveJS`. Personal Fleet flags remain OFF; do not deploy PLAY or merge PR #350 as complete.**

PF-58 may register a stock player ship as native NPC using the SAME original ItemStore `itemID`. EveJS's generic `nativeNpcService.destroyNativeNpcController()` currently calls `nativeNpcStore.removeNativeEntityCascade()` after removing the scene actor. Its normal cleanup has no PF54/58 physical ownership witness.

PF-59 creates `native/coopPersonalFleetNativeRemovalGuard.cjs` and a pinned patch generator to block five native cleanup entrypoints **before side effects**:

1. `nativeNpcService.destroyNativeNpcController`
2. `nativeNpcService.dematerializeNativeController`
3. `nativeNpcStore.removeNativeEntityCascade`
4. `nativeNpcStore.removeNativeEntity`
5. `nativeNpcStore.removeNativeController`

A PF marker in the native entity/controller OR a durable original `corporationRuntime` handoff ship lock blocks cleanup, including when an apparent `DOCKED`, `LOST` or `DESTROYED` status exists. This is intentional: PF56/PF57 terminal reconciliation is not installed or authoritative yet. Inconsistent native/store state requires operator repair. A poisoned/unreadable GameStore blocks deletion. No retry, item manufacture, title transfer or new NPC IDs.

The bootstrap must call `installOriginalRemovalAuthority({gameStore: ORIGINAL_GAMESTORE})` exactly once before feature activation. It uses a read-only original `coopAtomicNativeRows` transaction to find `coop-personal-fleet\\u001fhandoff-ship-v1:<originalShipItemID>`. `undefined` is unknown (blocked); `null` is a proven missing lock. This alone does NOT cover direct inventory/market/exploration/mining writers or true dock/loss disposition. If the authority is absent and feature flag is enabled, even ordinary NPC cleanup fails closed.

## Run (manual only)

```bash
node --test scripts/pf59/tests/pf59-removal.test.cjs
python3 -m unittest discover -s scripts/pf59/tests -p 'test_*.py' -v
python3 scripts/pf59/build_native_removal_patch.py /path/to/clean/EveJS --output /tmp/PF59-native.patch
```

The patch generator rejects source blob drift against `nativeNpcService.js` `ca039daa...` and `nativeNpcStore.js` `95724ab...`; it does not apply anything. It is a **review patch for the unmodified source**; PF58 already changes the same service file, so review/combine the patches against the exact actual fork revision before applying. Do not silently apply one over the other. The runtime must install `Code/server/src/space/coopPersonalFleetNativeRemovalGuard.js` before using any hook.

## Evidence

2026-11-06 isolated Node 22.16.0: 15/15 PASS; Python 3.13: 5/5 PASS. Synthetic/mock original SQLite authority contract only; no real native fork checkout, Windows, WORK/PLAY, actual NPC destruction, two-player gameplay or crash tests for PF59. Existing PF46–58 pass count is NOT reasserted on this machine.
