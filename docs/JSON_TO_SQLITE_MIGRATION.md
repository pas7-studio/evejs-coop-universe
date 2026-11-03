# JSON ledgers that belong in SQLite (2026-11-03)

Co-op business state lived in hand-written JSON on the data volume while the
engine itself is SQLite. This is the migration record: what moved, why, what was
measured, and what is deliberately **not** claimed.

## What this is not

It is **not** a performance fix. A live `fs` interception over 89 s of the play
stack measured **0 ms** of JSON I/O (the most-read file was read 30 times, each
under 1 ms). The lag we measured came from SQLite phases (`npc-reconcile`
41 MB clone, `universe-sites` ~1.1 s per family), not from JSON.

The real motives are correctness:

- a whole-file rewrite is not atomic against a second writer, and the process
  cache silently wins over an edit made outside it (2026-11-03: 208 leftover
  pirates could only be purged from **inside** the running process);
- searching a ledger meant parsing everything;
- several owners rewrote one file, so an owner holding a boot-time copy dropped
  another owner's row (2026-10-30: a linked hull disappeared after a write from
  the market side, and every later crossing failed `SOURCE_IDENTITY_MISMATCH`).

## Migrated (fork `cc7d17b`, `fad546a`)

| Table | Was | Owner module | Key |
| --- | --- | --- | --- |
| `coopWarMirror` | `coop-faction-war-mirror.json` (1.0 MB) | `space/coopWarMirror.js` | `state-v1` |
| `coopWreckClaims` | `coop-npc-wreck-claims.json` | `space/coopNpcWreckClaims.js` | one journal row |
| `coopWreckCustody` | `coop-npc-wreck-custody/tx/*.json` | `space/coopNpcWreckCustody.js` | one row per wreck item |
| `coopNpcLife` | `coop-npc-life.json` (70 KB) | `space/coopNpcLife.js` | one document row |
| `coopNpcLinks` | `coop-npc-links.json` | `space/coopIdentityRegistry.js` | one row per pilot |

Rules that apply to all five:

- the legacy file/directory is **read once at boot and healed into the table**;
  it is never a second writer afterwards;
- a refused store write still falls back to the legacy file, so a mirror, claim
  or journal can never be lost to a storage failure;
- a damaged stored journal is **fatal** (`INVALID_*_JOURNAL`), never silently
  replaced by the file;
- durability is preserved where it mattered: claims, custody journals and
  identity links call `flushTableSync` before the caller continues, which is the
  same guarantee as `fsync` + `rename` **plus** the directory entry that a rename
  alone does not make durable on POSIX.

`coop-npc-links.json` is still written, but only as a best-effort **projection**
of `coopNpcLinks`: the admin bridge, NPC memory and destruction attribution still
parse that file. Dropping the projection is a separate change and needs those
five readers moved to the table first.

## Live evidence (play stack, image `evejs-local` at `cc7d17b`)

After `docker compose -f compose.yaml -f compose.coop-probe.yaml -p evejs up -d
--force-recreate server`:

- `coopWreckClaims` 3 rows / 19.5 KB, `coopNpcLife` 3 rows / 70 KB,
  `coopNpcLinks` 100 rows / 17 KB — imported from the legacy files, which were
  left untouched on disk;
- `coop-npc-links.json` mtime moved to the recreate minute: the projection is
  being written by the store owner;
- `coop-faction-war-mirror.json` still at its pre-deploy mtime: it is no longer
  written, because the mirror row is only written on a real war write. The heal
  path was proved live instead: reading through `coopWarMirror.read()` validated
  the 1 066 440-byte legacy file with `coopFactionWarCore.validateState` and
  wrote row `state-v1` of exactly 1 066 440 bytes (10 wars / 866 campaigns /
  37 territories, identical to the authoritative record, which was unchanged);
- `coopWreckCustody` is empty because native wreck transfer is off on the play
  stack, so its module was never constructed (nothing to import yet).

## Still JSON, on purpose

- `coop-events.jsonl` — append-only telemetry, a log wants NDJSON;
- `coop-npc-ammo-debits`, `coop-native-warehouse`, `coop-native-industry` — file
  trees whose crash semantics are still being designed;
- the ammo/industry `*.json.lock` pairs — an interprocess fence, not state.
