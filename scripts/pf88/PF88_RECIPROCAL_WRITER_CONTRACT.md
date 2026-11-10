# PF88 — reciprocal original ship writer custody, never an implicit activation

**Scope:** Draft PR #350; original EveJS fork cannot be written through this
connector (HTTP 403). Do not merge to main, restart PLAY, or enable Personal
Fleet. Local WORK and authenticated gameplay E2E have not been run.

## Implemented and staged inside existing PF62 22-path native bundle

The existing PF58 module
`coopPersonalFleetOriginalNativePermit.cjs` now exports
`createReciprocalWriterFence({pf52})`. It is already one of PF62's
18 source archive modules; no new native path is added.

Call its `inTransaction({tx,writer,shipItemID,affectedItemID,
destinationLocationID})` **inside the same original SQLite GameStore
mutation transaction** with declared `corporationRuntime` and `items`
tables. Valid writers are PLAYER, MINING, WAR, EXPLORATION, MARKET and INDUSTRY.

The policy validates the full PF52 original hangar reservation index,
original PF actor claim index, irreversible per-ship PF58 handoff and PF60
terminal custody locks. All unknown/corrupt sources fail closed. It walks
the original ItemStore parent chain (up to 32 levels) so already fitted
modules and cargo, and a new destination inside a reserved ship, are
protected. It never allocates an entity, cargo, module or ISK entry.
A clear result is named `CLEAR_IN_SAME_TRANSACTION`, **not** a durable
release or permission to write later in another transaction.

The PF58 source-bound native bootstrap additionally exposes
`checkForeignWriterWithinTransaction`. Crucially, its
`allWritersFenced` can only return true when the caller's original
writer fence and a separately supplied `verifyOriginalWriterHooks()`
both return the literal boolean true. Missing hooks default to disabled.
This callback is an integration requirement, **not an unforgeable proof**.

## Original EveJS writer entrypoints still NOT patched

| Area | Original file | Required follow-up |
| --- | --- | --- |
| Player inventory | `services/inventory/itemStore.js` | Mutating stock ship, fitting, cargo and destination writes must guard under the *same* SQLite mutation, including `writeItems` and deletion paths |
| Player ship identity | `services/character/characterState.js` | Active ship changes and character writes must reject foreign PF custody |
| Native Mining | `services/mining/miningNpcOperations.js` | Guard ship materialization, ownership reassignment and stock cargo paths |
| Startup Mining | `space/coopNativeMiningFleetDurable.js` | Guard persisted restore and durable slot ownership |
| WAR | `space/coopWarFleetRegistry.js` | Guard original ship claims/transfers in native transactions |
| Exploration | `space/coopNpcExpeditionOperations.js` | Guard NPC expedition orders and physical custody transfers |

Paths are relative to `Code/server/src`. The source-pinned CLI
`scripts/pf88/inspect-original-writer-hooks.cjs` inspects these six
original source files and prints a **BLOCKED_FOR_ACTIVATION** report.
It deliberately exits with status 2 even if static markers look good.
Static source inspection cannot establish that the live original
writer/SQLite transactions are wired. It must not be added to GitHub
Actions; the repository explicitly forbids remote CI.

This PR cannot patch the real original EveJS writer entrypoints because the
GitHub App lacks write permission for `pas7-studio/EveJS`. The archive
provides the reusable transaction policy and release blocker; the owner
still needs a reviewed native-fork commit with the genuine writer hooks.
Do NOT replace those original writer paths with a separate read-before-write
guard: that would reintroduce a TOCTOU window around PF87.

## Manual regression / review

```powershell
node --test --test-concurrency=1 scripts/pf58/tests/pf88-reciprocal-writers.test.cjs scripts/pf58/tests/pf88-sourcebound-gating.test.cjs scripts/pf88/tests/pf88-writer-source-audit.test.cjs

# Read-only; expected exit code 2 until real original writer hooks and
# independent authenticated WORK acceptance are finished.
node scripts/pf88/inspect-original-writer-hooks.cjs --fork-root 'C:/Games/EveCoop/upstream-evejs'
```

Both PF88 gameplay contract tests are also invoked by
`Test-PF58-Local.ps1` and the complete PF80 PowerShell WORK preflight
before any native review patch is applied. These isolated tests do not
provide proof of original writer integration.

## Remaining P0

PF88 is a **shared custody policy**, not a completed reciprocal installation.
Original ItemStore remains the sole owner of normal player item writes;
PF87's strict direct GameStore stock title transfer uses the original
authoritative atomic adapter/inventory invalidator and must be
reviewed with the original ItemStore owner before enabling.
A further blocker is the non-atomic relationship between a live player
session, stock character records and a GameStore mutation. The genuine
original engine hooks and gameplay E2E (two clients, native ship ownership,
Mining/WAR/Exploration concurrency, dock, wages, restart and crash) remain
mandatory. Personal Fleet stays OFF.
