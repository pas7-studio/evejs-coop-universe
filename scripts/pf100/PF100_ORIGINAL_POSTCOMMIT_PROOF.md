# PF-100 — Original stock ship post-COMMIT proof (review-only)

**2026-11-07 · PR #350 Draft · Personal Fleet OFF · original EveJS NOT modified**

## Evidence and scope

The original source currently has three separate authorities:

1. `coopGameStoreAtomic.js` owns `BEGIN IMMEDIATE`, `COMMIT`, cache reconciliation, and the poison/fatal path for uncertain commit or failed postcommit cache refresh. Original Git blob: `2b28b48145f3fbc989ce7346384487ee75e52280`.
2. `characterState.activateShipForSession()` calls the stock `setActiveShipForCharacter()`, followed by `syncInventoryItemForSession`, `applyCharacterToSession`, conditional capsule removal, and notifications. Original Git blob: `8a002d190899b6cb1e1068a565451e6d1d808401`.
3. `itemStore.js` owns the real physical ItemStore hull. Original Git blob: `e992d56ee9cff1911d54247bf46d44d01e5d8060`. PF91/PF99 already provide an **uninstalled** source-bound SQLite character-row activation candidate.

The new `native/coopPersonalFleetOriginalPostCommitProof.js` is a **separate, read-only source-bound verification gate** intended for `Code/server/src/space/`. It directly imports the original `sessionRegistry` and `structureLocation`, not caller-supplied providers. It checks:

- Two native owner flags must both be on; otherwise fail closed.
- The exact PF91 activation result and expected original character, old and target physical ship IDs.
- Exact live registered session object, unique character login, account ID and unchanged dock/structure.
- A fresh **committed** `characters/<characterID>` record with the new ship title, matching real `items/items` hull, owner, type, hangar and name.
- The in-memory session still points to the old ship (`READY_FOR_NATIVE_SESSION_APPLY`) or is already synchronized to the new ship (`ALREADY_SYNCED`). Contradictory aliases and partial account/dock/ship changes block.

It **does not** perform writes, change sessions, consume a capsule, send notifications, retry an activation, or issue a certificate that commit is durable. A caller-supplied PF91-shaped result or reader is **not** sufficient authority: the original CharacterState entrypoint must call this only after its own source-bound PF91 GameStore transaction has returned, and must supply a real fresh SQLite read-only postcommit reader. Never expose this module directly to clients or use its output as remote authorization.

## Actual local tests

```powershell
.\scripts\pf100\Test-PF100-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

Or directly from the project checkout:

```powershell
node --test --test-concurrency=1 scripts/pf100/tests/pf100-original-postcommit-proof.test.cjs scripts/pf100/tests/pf100-original-source-pins.test.cjs
```

**Executed during authoring:** Node.js 22.16.0 with `node:sqlite`: **19/19 PASS** on isolated real SQLite tables. Cases include no precommit publication, successful postcommit row/item proof, idempotent recheck, detached/duplicate/cloned sessions, account/ship/dock drift, forged result, revoked native flags, stale row, lost physical hull, hostile identity coercion, throwing source reader and unexpected session property exceptions. The proof test runs exact Git blob content of the candidate module in a source-import harness. Native 6-file SHA pins were authored and syntax/test-run locally, but **all six SKIP** without `PF100_NATIVE_WORKTREE`; real original fork local pin tests and any in-game integration were **NOT RUN**.

Git blob hashes of both locally tested module and its test file were matched against the actual newly published GitHub files. SHA256 manifest is in `SHA256SUMS.txt`. This run did **not** execute an original EveJS server or full WORK E2E.

## Required source-owned integration (not implemented by PF100)

The original CharacterState owner must, without a second `repo.write`:

1. Install PF95/PF96 real GameStore witness, PF99 authoritative source bindings, and PF91/PF92 original title owner.
2. Execute atomic custody/character mutation under a single original `coopAtomicNativeRows.transact` with all competing writers fenced. **Switching the player and handing the old ship to an NPC in one transaction is NOT achieved by this postcommit proof.** Current PF58 handoff and PF91 activation remain separate candidates.
3. Let the real GameStore finish commit **and** native cache reconciliation. Unknown commit outcome, GameStore poison or invalidation failure must quarantine the session and require operator/authoritative restart reconciliation; never blind-retry.
4. Run this postcommit gate with an original **fresh SQLite** read-only reader, not a test stub or stale GameStore cache. While the actual stock session is still live, use its original CharacterState notification/ship activation routines exactly once and only after proof; never consume the capsule early.
5. Recheck postpublish state, protect against interrupted notification delivery with a durable effect/ack protocol, and verify restart/reconnect consistency. Stock `activateShipForSession` currently has side effects not covered by PF91; simply calling it again would duplicate its own stock write.
6. Cover ItemStore, character cache, Mining/WAR/Exploration competition, real NPC title/physical actor, return/dock, SIGKILL and two authenticated WORK clients.

Native `pas7-studio/EveJS` create-branch was retried **2026-11-07** and still returned HTTP **403 Resource not accessible by integration**. Until the real original owner hook and these tests exist, keep **PR #350 Draft**, Personal Fleet **OFF**, PF42 coexistence exclusion intact, and never merge/deploy to `main` or `PLAY`.

No GitHub Actions workflow is created here; `AGENTS.md` explicitly forbids it.
