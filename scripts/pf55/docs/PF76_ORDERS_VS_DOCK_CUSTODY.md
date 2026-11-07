# PF76 — durable manual-order/return-dock mutual exclusion

Status: tested source contract, NOT native server bootstrap. Personal Fleet OFF.

## P0 race

Before PF76, PF55 `createPersonalFleetNativeOrders().issue()` checked PF54 ACTIVE, physical ItemStore hull in space, an original PF actor claim and an order index, **but did not read** PF56 return/dock or PF60 terminal custody. A new player FOLLOW/WARP/ATTACK could reserve `ISSUING` even after PF56 began RETURNING or DOCK_ISSUING. This could override an NPC's return path while station docking and loss cleanup were in progress. PF73 blocked native *restart*, not live orders.

## Fix

The source guard now reads four authoritative `corporationRuntime` keys from the same original GameStore transaction that reserves PF55 command intent:

- `coop-personal-fleet\u001freturn-dock-v1:<assignmentID>` (PF56, **any** phase)
- `coop-personal-fleet\u001fdock-native-attempt-v1:<assignmentID>` (PF66)
- `coop-personal-fleet\u001fdock-scene-attempt-v1:<assignmentID>` (PF67)
- `coop-personal-fleet\u001fterminal-v1:<assignmentID>` (PF60)

`null` means proven absent. **Any** non-null value, even a malformed record, blocks before an order intent can be written; `undefined`/unknown reads block. There is no clearing/rollback of existing durable rows. The legacy PF55 command already writes its `ISSUING` before invoking the original runtime; PF56 independently checks `manual-order-v1:<ship>` and rejects unresolved `ISSUING` on its own `BEGIN IMMEDIATE` admission path. Consequently PF55/PF56 cannot overtake one another at durable intent **assuming they share the same original transactional GameStore authority**.

## Scope and verification

- `scripts/pf55/tests/pf76-order-vs-dock.test.cjs`: uses the actual PF55 durable module and real SQLite WAL/FULL PF53->PF52->PF54 fixture; tests five return/dock phases, three other one-shot/terminal rows, malformed row, unknown read, ordinary allowed command, and independent Linux child SIGKILL after a durable return intent.
- `scripts/pf55/tests/pf75-runtime-durable-contract.test.cjs`: separately asserts that the **real PF55 native runtime executor object**, not merely a synthetic callback, is denied before invoking its command bridge once docking has begun.
- Standard PF55 local and PF74 WORK CI runners include both suites. Only source/module tests are possible until the original native engine bootstrap is wired.

**Remaining TOCTOU:** native runtime actions and SQLite transactions cannot be atomically committed together. The original `coopNpcOrderBridge` must verify its actual native ownership and writer fence before side effects. Real two-client WORK E2E, stock controller order persistence and gameplay acceptance remain outstanding.
