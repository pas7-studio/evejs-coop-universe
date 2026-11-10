# PF-49 candidate — Native Mining Transaction Ownership Fence

This is a **default-OFF, native-source patch candidate**, not an installed game feature. It is meant to be reviewed and used only on a disposable local WORK checkout with the exact pinned original EveJS source. It does not modify or deploy PLAY.

- `native/coopPersonalFleetMiningTxnGuard.js`: tested native-transaction reader guard.
- `patches/PF49-native-mining-writer-transaction.patch`: one standard `git apply` patch for original `coopNativeMiningAtomic.js`, ALIFE-11 mixed-transient contract, and the guard module.
- `Test-PF49-NativePatch.ps1`: **read-only** branch/SHA/cleanliness/patch preflight.
- `tests/`: 34 isolated tests including Node SQLite FULL durability, rollback, reopen and `git apply` fixture check.
- `docs/PF49_IMPLEMENTATION_STATUS.md`: current integration caveats and rollout gates.

Check using `node --test tests/pf49-*.test.cjs`. **No code in this package authorizes Personal Fleet activation.**