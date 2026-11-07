# EveJS Personal Fleet — PF-57 original payroll & contract lifecycle

**Source candidate only. NOT GAMEPLAY READY. OFF by default. Original native fork and PLAY unchanged.**

This extends the PF53 paid-hire / PF52 stock-hangar / PF54 ship deployment / PF55 order / PF56 return-dock chain, using the SAME original `gameStore.coopAtomicNativeRows` writer. It does not create a separate economy, NPC pilot, ship, timer or inventory, and never automatically refunds or replaces a lost hull.

## Implemented in this candidate

- `salary(command)`: a **server-quoted recurring NPC service fee** debits the ORIGINAL `characters` wallet and credits the ORIGINAL employer `corporationRuntime` division 1000 **inside one BEGIN IMMEDIATE**; both journals, transaction ID reservation, immutable salary operation receipt and period advancement commit together. The UI cannot set the amount or recipient. Salary periods must be sequential (1, 2, 3, ...) and due under a trusted native original quote. It is a payment to the employing NPC corporation, **not proof of credit to the individual pilot's earned balance**; that requires a separate stock pilot-wallet integration.
- `dismiss(command)`: removes the original PF52 index/roster contract with no refund, but only for a fully unassigned pilot with no live native orders/controllers or unsettled wages, as proven by injected original authorities. The original NPC record is **not deleted**. An immutable closed-contract tombstone prevents stale re-use and supports replay after restart. No auto-dismiss callback is invented.
- `loss(command)`: original `npcWrecks` must identify the ship's SAME physical `entityID`; the original ship item must be gone from stock `items`; original `npcEntities`, `npcCargo`, and `npcModules` must no longer contain that active actor's records. Separately verifies original kill record, controller absence, and full original wreck asset-title conservation. Only then releases the PF actor/ship reservation, marks PF54 `LOST`, and retains a durable loss record. No replacement ship, itemID, salvage, ISK or kill credit is minted. Loss while an unknown `DOCK_ISSUING` can still mutate ItemStore remains blocked.
- `inspect(command)`: owner-authorized read-only record, including immutable loss history even when no salary was paid.

All updates are original `corporationRuntime` + `characters` / `items` / native read-scope transactions. The native authority callbacks must be connected to actual original GameStore and wallet, NPC agent, native wreck/killmail and controller, and the original **full** set of reciprocal competing writers. Default `enabled()` and `allWritersFenced()` return false.

## Local tests

From this folder (Node 22.16+):

```sh
node --test tests/pf57-lifecycle.test.cjs tests/pf57-sqlite-sigkill.test.cjs
```

Or Windows PowerShell:

```powershell
.\Test-PF57-Local.ps1 -NativeWorktree 'C:\path\to\EveJS'
```

`-NativeWorktree` performs **read-only** source-pinned Git checks. Linux is required for child-process SIGKILL gates; Windows skips those tests. Manual local Node/SQLite fixtures do not prove WORK gameplay.

## Current verified evidence

PF57 standalone: **50/50 Node tests PASS**, including 5 real Linux child-process SIGKILL scenarios (salary before COMMIT / after COMMIT, dismissal before COMMIT, loss before / after COMMIT). The combined available PF49–57 test files from the previous full ZIP plus this package were also tested locally; report their exact measured counts, not a sum of unverified historical counts.

## Native integration blockers

1. Reconcile with PF52/PF53 original shared actor/roster and payroll keys. Never ship `deps/` fixtures as original authoritative bindings.
2. Implement a **real native recurring salary quote** from an already-authorized agent/employer contract. Its period, amount, owner, pilot, revision, due date and expiration cannot be client controlled.
3. Original `walletState`, corporation runtime writer, market, payroll and every other wallet/ItemStore writer must respect one owner fence and clean cache invalidation. `PF57` uses `characters`, `corporationRuntime`, `npcEntities`, `items`, `npcWrecks`, `npcWreckItems`, `npcCargo`, `npcModules` inside original transaction scopes; startup quiescence and native transient cargo isolation must be proved.
4. Native pilot release & salary arrears settlement are original source-backed callbacks, not optimistic booleans. Individual native pilot-earned balance is **not** credited by this adapter.
5. Native wreck/killmail, controller absence and item-title conservation must be independently attested and durable. `npcRuntimeControllers` is not an allowed atomic table; an owner-bound external observer is required. No `removeNativeEntityCascade()` for lost ship cleanup before custody is independently proved.
6. Original PF54 physical itemID handoff, PF55 command receipts/arbiter, PF56 sessionless docking, UX, WORK two-player E2E and PLAY are **NOT RUN**. The original `pas7-studio/EveJS` branch was not written because GitHub returns 403.
7. The stock character wallet journal has a finite retention window (~100 entries); a replay whose original journal witness has been pruned **fails closed** until authoritative archival/compaction proof is designed. Ledger caps require operator resolution, never silent truncation.

Do not merge the Draft PR as gameplay-ready, enable Personal Fleet flags, remove PF42 exclusion, run CI/deploy PLAY, or infer game readiness from isolated tests.
