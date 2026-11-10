# PF97 — Original CharacterState and ItemStore owner boundary

**2026-11-07 · Draft PR #350 · Original fork unchanged · Personal Fleet OFF**

## Concrete original source findings

The exact original `pas7-studio/EveJS` (`coop/pas7std`) uses:

- `characterState.writeCharacterRecord(charId,record,options)`:
  standard `repo.write('characters','/<charId>',...)`, which does not
  share the PF52 durable hull reservation transaction.
- `getCharacterRecord`: invokes that writer **during read-side
  normalization** when character shape changes.
- `updateCharacterRecord`: normalizes then calls that writer.
- `itemStore.syncCharacterActiveShip`: delegates to that original
  CharacterState writer.
- `itemStore.ensureCharacterActiveShipItem`: a *read*-looking path
  that can provision, repair or move a physical hull **before**
  synchronizing the corresponding character row. Blocking only the
  final writer could leave a physical orphan.

Both source paths are pinned to original Git blobs; the original fork
remains unmodified:

- `Code/server/src/services/character/characterState.js`:
  `8a002d190899b6cb1e1068a565451e6d1d808401`
- `Code/server/src/services/inventory/itemStore.js`:
  `e992d56ee9cff1911d54247bf46d44d01e5d8060`

## Review-only code

Two source-pinned **review-only** diffs under
`scripts/pf97/review/` implement a strict transitional owner
boundary for `EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS=1`.
Neither is registered with the legacy upstream patch installer,
and neither has been applied to the real original fork.

**CharacterState:** when the PF native witness flag is OFF,
`writeCharacterRecord` and deletion preserve their original
behavior. When ON:

- Any change to `shipID`, `shipid`, `activeShipID`,
  `shipTypeID`, `shipName` or `storedShips` is **blocked**
  before any write. No caller can pass a bare "approved" boolean.
  Ship title requires the separate PF91/PF92 verified session +
  physical hull custody owner, not implemented by this diff.
- Every **non-ship** existing-character update (wallet, skill
  metadata, etc.) runs through the original
  `gameStore.coopAtomicNativeRows.transact(['characters'], ...)`.
  The exact original cached before-image must match the native
  SQLite row inside the same transaction. If not, deny without
  replacing a newer hull or wallet balance.
- Direct original `repo.write` cannot be used in native mode.
  Unknown record creation, character deletion, nonempty
  persistence options, missing/poisoned original GameStore or
  bad/changed character identity fail closed.
- After an acknowledged commit, CharacterState invalidates its
  local record cache. Native GameStore performs original durable
  cache reconciliation. Unknown COMMIT outcome or post-commit cache
  corruption is propagated, **not** converted to a retryable
  write error.
- If read-side normalization cannot persist its new image while
  in native mode, it returns `null` rather than exposing an
  uncommitted normalized shipID to gameplay.

**ItemStore:** native mode blocks all stock
`syncCharacterActiveShip`, `setActiveShipForCharacter`, and
`ensureCharacterActiveShipItem` before they can provision/repair
an original physical hull. The last method returns `null` in
native mode. This is intentionally **not a usable gameplay
activation path**: it is the correct fail-closed intermediate
state until a real source-owned native title and physical custody
writer replaces these blockers.

## Test workflow

`scripts/pf97/tests/pf97-character-writer-source.test.cjs`
and `pf97-itemstore-source.test.cjs`:

- Read the two **unchanged** original files from
  `PF97_NATIVE_WORKTREE`; verify exact blob SHA1;
- Copy only those files to disposable temp directories;
- Run `git apply --check`, apply each review-only patch only in
  the temp copy, and execute **the patched original functions**
  in an isolated harness. The character harness uses real
  Node.js `node:sqlite` `DatabaseSync` and a transaction
  adapter double for the original GameStore.
- Exercise default-OFF compatibility, original writer routing,
  wallet atomicity, title/alias/storedShips denial, stale
  before-images, unknown commit outcome, cache poison, unsafe
  deletes and ItemStore lazy hull provisioning blocks.

The authored **25 source-pinned Node tests** require the original
local checkout. They are NOT native server E2E and should not be
claimed as having passed in this environment until actually run.

```powershell
.\scripts\pf97\Test-PF97-Local.ps1 -NativeCheckout 'C:\Games\EveCoop\upstream-evejs'
```

## Hard release boundary

The GitHub integration returns HTTP 403 for write access to
`pas7-studio/EveJS`. No real original owner hook was installed.
The PF97 review-only fail-closed paths are **not the final
implementation of playable Personal Fleet**. They intentionally
block ship switching when enabled and must never be toggled on
as a gameplay feature.

Before actual activation, a local original-fork author must
review/install PF95/PF96 GameStore epoch, then implement the
**source-owned** PF91/PF92 verified docking/session lease + item
title/custody handoff atomically, upgrade ItemStore repair
to the same original writer, test GameStore cache invalidation,
Mining/WAR/Exploration contention, crash recovery and two
authenticated WORK clients. Do not touch PLAY or merge PR #350
until full acceptance is proven.
