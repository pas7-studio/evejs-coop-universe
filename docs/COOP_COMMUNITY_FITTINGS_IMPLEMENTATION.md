# COOP-043 — Native Community Fittings: tooling and safe rollout

**Status 2026-10-25:** Original offline importer, public-killmail harvester, merger and SQLite seed planner **implemented in source**. Eight isolated tests PASS (local Node test run). **Zero remote fits harvested in the cloud session, zero fitted ships verified, no server or `evejs-data` modified, and no client acceptance.** This is not a completed live deployment.

## What the player should see

Native **Fitting -> Browser -> Community Fittings** for both users, with distinct ships and fitting purposes. Up to five different loadouts per ship with modules in high/medium/low/rig slots plus drones/cargo when present. Curated, permissioned EFT is ranked above public combat-loss fits. Public combat-loss fits are labeled `[FIELD]` and **are not recommendations**; they can be incomplete or bad. No synthetic fallback templates are invented.

The import uses the original native EveJS community owner `1000282` and `savedFittings` SQLite records. It does not invent modules, spawn items, change ISK, modify player-owned fittings, or enable a new gameplay hook. The native UI read path supports arbitrary records but **client handling/performance above 600 has not been proven**; anything above the standard 600 limit is explicitly opt-in and must first be tested on a disposable world.

Not every hull can have three meaningful fits: shuttles, capsules, some freighters and rare/obsolete ships may have no fitting slots, no public sources, or too little data. The tools report `withAtLeast3`, `zero`, `coverage[].variants`; they **do not lie or clone donor fits from a different hull**.

## Files

- `scripts/coop-community-fittings.cjs` — canonical model, pinned-SDE type validation, extraction from public ESI killmails, deterministic hashes, native fitting upsert planner.
- `scripts/coop-community-fit-harvest.cjs` — rate-limited, cached source research via public zKillboard loss summaries and ESI killmail details, max 3–5 DISTINCT fits per hull. Produces a JSON file only.
- `scripts/coop-community-fit-eft.cjs` — parses local permissioned EFT text with per-file author, source URL and permission. Rejects unknown/ambiguous module names. Does **not** scrape third-party private or unauthorized sources.
- `scripts/coop-community-fit-merge.cjs` — combines curated EFT and public combat-loss records, deduplicates exact module layouts and selects up to five per hull with curated fits first.
- `scripts/coop-community-fit-seed.cjs` — strict `--mode plan` and opt-in `--mode apply`. Pins upstream SHA, checks Docker target stopped, verifies SQLite migration/outbox, backs up whole DB outside data directory, transactionally writes only the community owner and `_meta.nextFittingID`, preserves unrelated owner fitting records, refuses missing backup/consent.
- `tests/coop-community-fittings.test.cjs` — pure Node unit tests. Run `node --test tests/coop-community-fittings.test.cjs`.

## Setup and execution (local authorized host only)

**Never run on the live world as the first test.** The cloud agent cannot open the local Windows Docker volume or retrieve public killmail API bodies here; run this on your actual host or a separate authorized staging machine with network and the pinned source.

1. Find the **same SDE snapshot used by the pinned EveJS runtime**. Its directory must contain `types.jsonl` and `groups.jsonl`. Confirm the actual file paths locally rather than guessing. Use only `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f` upstream. Use a **temporary external output directory**, not `evejs-data`.
2. Generate a public-source research pack (may require many requests; run once, cache and resume). Use small pilot `--max-hulls 10` before full coverage:

```powershell
node .\scripts\coop-community-fit-harvest.cjs --sde "O:\EveSDE" --out "O:\tmp\coop043\field.json" --cache "O:\tmp\coop043\cache" --per-hull 5 --pages 3 --per-page 12 --max-hulls 10
```

For full collection **omit** `--max-hulls 10`. The source contains public **loss** fittings (not curated viable fits): check module counts, source links, pinned-SDE support, empty/shortfall hulls and rate limits. Harvested names get `[FIELD]`, never `[PVE]` or `[PVP]` by assumption.

3. Optional: add deliberately permissioned curated EFT files and a local JSON manifest next to them. Example:

```json
{
  "entries": [
    {
      "file": "venture-mining.eft",
      "sourceURL": "https://example.org/permissioned-fit",
      "author": "Fit creator credited here",
      "permission": "Author-approved local use"
    }
  ]
}
```

```powershell
node .\scripts\coop-community-fit-eft.cjs --sde "O:\EveSDE" --manifest "O:\tmp\coop043\eft\manifest.json" --out "O:\tmp\coop043\eft.json" --per-hull 5
node .\scripts\coop-community-fit-merge.cjs --sde "O:\EveSDE" --out "O:\tmp\coop043\catalog.json" --per-hull 5 "O:\tmp\coop043\eft.json" "O:\tmp\coop043\field.json"
```

Without EFT, `field.json` alone is a valid input for the next step.

4. **Plan** on the **disposable** EveJS instance before any data writes. The seeder needs the existing `better-sqlite3` dependency installed under `<CodePath>\server` and a local filesystem path to the SQLite file. For a Docker named volume you must first arrange a safe, stopped-server staging mount; do **not** write to a running DB using a host guess. Find the **real** `gamestore.sqlite` via Docker inspect and the known runtime volume layout. The exact example paths below are placeholders, not discovered host paths.

```powershell
node .\scripts\coop-community-fit-seed.cjs --mode plan --sde "O:\EveSDE" --code-path "C:\Games\EveCoop\upstream-evejs\Code" --db "O:\staging-evejs\gamestore.sqlite" --catalog "O:\tmp\coop043\catalog.json" --allow-over-600 yes
```

Capture `catalogSha256` from the plan. Validate counts and `changes`. >600 is explicitly experimental.

5. Stop the target Docker game container and confirm it reports `false` for `.State.Running`. Back up the database **outside** the named volume. **Apply only after owner approval and one disposable-server plan**:

```powershell
node .\scripts\coop-community-fit-seed.cjs --mode apply --sde "O:\EveSDE" --code-path "C:\Games\EveCoop\upstream-evejs\Code" --db "O:\staging-evejs\gamestore.sqlite" --catalog "O:\tmp\coop043\catalog.json" --allow-over-600 yes --container "evejs-local" --confirm-stopped yes --approve-sha256 "<sha from plan>" --backup-dir "O:\evejs-backups"
```

The apply path checks container stopped before both backup and transaction, creates and validates a SQLite backup, checks for outstanding `savedFittings` persistence operations, refuses SHA/pin drift and writes only native fitting records. This **has not been live acceptance-tested**; do not run it on the owner's persistent world before smoke testing.

## Known technical limits and next acceptance

- The `types.jsonl` / `groups.jsonl` SDE validation verifies published hull and item IDs plus native flag shape. **It does not yet prove** CPU, PG, calibration, skills, turret/launcher hardpoints, rig size, tech restrictions, charge compatibility or client display on arbitrary fits. Native fitting must still decide whether actual equipment can be installed.
- A source fit can contain unavailable modules; that's not a grant. If purchased later, purchases use native market inventory, wallet and settlement.
- Duplicated module/layout signatures are deduped. An imported `[FIELD]` fit is not an approved PvE/PvP recommendation. The optional human-reviewed EFT source is preferred.
- A full 3–5 per hull promise must be evidenced by `coverage[]`, not extrapolated from a few popular hulls. The native 600-entry browser limit may cause client slowness or truncation above 600; fail the large-catalog rollout if that happens.
- No third-party source code or fetched public killmail bodies are committed; any imported content stays on local host with provenance.
- No GitHub Actions or remote CI.

**Client gate:** disposable volume -> limited 10-hull seed -> one real authorized client browse, save-as and fitting with owned modules -> 2 independent clients see same community list -> restart/persistence -> 600+ stress gate -> only then owner-approved deployment to existing world. The user should not be told the fits are installed until real client proof exists.
