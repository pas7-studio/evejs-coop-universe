# PF-77 — original EveJS native order bridge/arbiter integration gate

**Scope:** a test of original EveJS JavaScript after the independently source-pinned PF55 owner patch is applied in disposable WORK. This does **not** install the Personal Fleet server bootstrap, enable feature flags, or assert gameplay E2E.

## Why this gate is required

PF75 corrected the real two-module `createPersonalFleetNativeOrders` → `createNpcRuntimeExecutor` mismatch. The next boundary is different: `createNpcRuntimeExecutor` issues through original `coopNpcOrderBridge`, which must obtain the PF pilot/ship link and a reliable `pfShipClaim`. The original arbiter must know `PERSONAL_FLEET`, must refuse takeover by TACTICS, and must retain an `OUTCOME_UNKNOWN` lease after an ambiguous native operation. Passing a fixture-only bridge does not prove this.

The new Node test `scripts/pf55/integration/pf77-native-work-arbiter.test.cjs` loads **the actual files from a supplied native WORK checkout**, never archived/source-mimicked copies. It requires `PF77_NATIVE_WORKTREE` to be an absolute path and fails if the PF55 native owner-patch markers are missing. Nothing attempts to auto-run against PLAY.

Covered checks:

- The authenticated original PF pilot claim admits an actual bridge order exactly once, creates a `PERSONAL_FLEET` lease and rechecks claim at native verification.
- RAID, PATROL, TACTICS, WAR, CIVILIAN, GATE and EXPEDITION cannot issue commands for a PF-reserved ship.
- A missing, `UNKNOWN`, `UNASSIGNED`, undefined or malformed claim does not authorize PF.
- A claim revoked between bridge preflight and arbiter verification causes zero native effects.
- Player session, foreign itemID, non-native actor, controller mismatch, wrong system, and duplicate pilot assignment are rejected.
- TACTICS cannot preempt an already established PF lease by calling the original arbiter directly.
- Ordinary non-PF ships remain usable by the preexisting RAID owner.
- Active warp, ambiguous native response, and replay are fail-closed.

## Explicit WORK-only execution

Apply PF62/PF68's complete 20-path patch and PF55's separate two-original-file owner patch **only to isolated WORK**. Then run:

```bash
PF77_NATIVE_WORKTREE=/absolute/path/to/patched/WORK \
  node --test --test-concurrency=1 \
  scripts/pf55/integration/pf77-native-work-arbiter.test.cjs
```

The PF74/PF75 GitHub Actions workflow invokes the same test with the disposable `pf74-native-work` directory and `contents: read` permission.

## Evidence and limitations

2026-11-06 source-level check: original stock blobs `aa5447ada4015b1ac8262d14bae5cd975af6ec6b` and `c0f93af3e5a67703a84dc03cab8da29a65afdf3b` fetched from `pas7-studio/EveJS` (`coop/pas7std`); the existing PF55 builder's four source-anchored substitutions were exercised against those exact sources in an isolated Node-compatible VM with **24/24 cases passing**. This is **not** a real Git WORK checkout, and does not satisfy the CI gate by itself.

Still required: an actual green GitHub Actions WORK run, original server bootstrap and authoritative `pfShipClaim` wiring, authenticated player session, native ledger witnesses, real ship behavior, docking, wages, combat, and 2-client E2E. Feature flag OFF; PR #350 Draft; no main/PLAY changes.
