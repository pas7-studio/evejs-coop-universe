# PF93 — Original SQLite session-witness isolation

**2026-11-07 | Draft PR #350 | Candidate native code | Personal Fleet OFF**

This closes a specific P0 error path in the already-bundled PF91/PF92
candidate original character writer. Prior code gave a live session
witness a read-only `get/scan` facade and checked the original
`items/items` object and the caller's character row. But a witness
closure could capture the enclosing `tx` and write an **unrelated**
row in `corporationRuntime`, another character or another `items`
key, then return `false`. Returning `BLOCKED` from the callback
allowed the enclosing GameStore `transact` to **COMMIT** those changes.
A false witness is not proof that the original transaction was clean.

## Implementation — existing single owner only

`scripts/pf58/native/coopPersonalFleetOriginalNativePermit.cjs`
now includes an internal, shared `verifyOriginalWitnessCannotWrite`
helper, used for BOTH original player activation (PF91) and the
generic character owner writer (PF92).

Inside the caller's **same** `BEGIN IMMEDIATE`:

1. Require the original GameStore `tx.scan` and `tx.get` APIs.
2. Read and SHA256-fingerprint the **complete current SQLite rowset**
   in exactly the declared atomic table scope:
   `corporationRuntime`, `items` and `characters`.
   Sort row keys and use unambiguous JSON tuple framing, including
   control-character-containing corporation-runtime keys.
3. Run the source-bound session witness with a read-only
   `get/scan` facade, never passing `put` or `del`.
4. Fingerprint the **same three tables again** before interpreting
   the callback's result or exception. **Any changed row causes a
   thrown error**, so the original GameStore must ROLLBACK. That
   includes when the witness reports `false` or throws.
5. Reject asynchronous promises/thenables. Only exactly `true`
   is a successful witness result.
6. Repeat the entire witness proof at the final pre-commit check.

There is no newly introduced table owner, parallel SQLite connection,
runtime patcher, external actor or client-side message. All stock
ownership and PF88/PF89/PF91/PF92 checks remain in their existing
native candidate modules. Wallet-only character changes do NOT invoke
this expensive witness scan; they still check the exact before-image.

**Safety vs performance:** Full-table scans and serialization are
`O(database size)` per witness, and each protected transition checks
twice. The candidate fails closed at 250,000 rows per table or
approximately 64 MiB of serialized row data. This is acceptable only
as a conservative candidate proof. Before actual gameplay release,
the original GameStore single writer should expose a native monotonic
transaction write-generation/write-set witness, so a *read-only
capability* can check zero SQLite mutations in O(1) rather than
scanning the database. Rewriting the original GameStore needs owner
review; its GitHub integration currently rejects writes (HTTP 403).

## What the tests prove

`scripts/pf58/tests/pf93-native-session-tx-isolation.test.cjs`
adds 16 Node/SQLite fixture tests for:

- Original PF91 player switch and PF92 generic character owner
- Early and late witness failure, success and thenables
- Hidden `tx.put` to corporation runtime, an unrelated character,
  another original items row, and the actual original ship
- Explicit rollback even when the witness returns `false`
- Reader not exposing `put` or `del`
- Different SQLite row enumeration order yielding the same fingerprint
- No `tx.scan` authority failing closed
- Unrelated wallet changes avoiding the expensive scan

`scripts/pf93/tests/pf93-original-sqlite-writer-source.test.cjs`
source-pins the unchanged original EveJS atomic writer using the
**existing** PF90 pin manifest; it checks the real `BEGIN IMMEDIATE`,
`scan`, `ROLLBACK`, and single writer claim APIs. It does not
install a runtime hook. The PF58 and PF80 PowerShell test runners
include PF93 before manual WORK review output.

## Local Windows WORK handoff

```powershell
.\scripts\pf93\Test-PF93-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

Also valid directly:

```powershell
node --test --test-concurrency=1 scripts/pf58/tests/pf93-native-session-tx-isolation.test.cjs
$env:PF93_NATIVE_WORKTREE = 'C:\Games\EveCoop\upstream-evejs'
node --test --test-concurrency=1 scripts/pf93/tests/pf93-original-sqlite-writer-source.test.cjs
python -m unittest discover -s scripts/pf58/tests -p 'test_pf93_*.py' -v
```

**Known proof limits:** A callback could write a row and then restore
the exact same serialized value: this snapshot guard cannot detect
that intermediate write. The original native writer's write-generation
counter is necessary to forbid even temporary mutation. A callback
could also emit non-SQLite side effects; it must be a vetted,
side-effect-free original session authority. Full Node/SQLite tests
and two-client WORK gameplay must be executed locally and evidence
logged; V8 isolated tests are NOT native end-to-end acceptance.

Neither PF91 nor PF92 is called from the original EveJS
`characterState` or `itemStore` yet. Do not enable Personal Fleet,
merge PR #350, restart PLAY or claim that hiring/ship switching
works until the actual original owner hooks, cache invalidation,
Mining/WAR/Exploration reconciliation and real WORK acceptance pass.
