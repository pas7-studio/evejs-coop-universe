# Plan: reclaim `%TEMP%\opencode` without losing anything (2026-10-29)

Measured before: **1.1 GB** total. Most of it is not ours-to-delete blindly.

| item | size | last write | verdict |
| --- | --- | --- | --- |
| `market-reseed/` | 467 MB | today 23:56 | **active** (another session's market seeding) - leave |
| `market-audit.sqlite` | 199 MB | today 23:19 | **active** - leave |
| `play-all.jsonl` + `play-30k` + `play-20k` | 187 MB | 2026-10-27 21:0x | idle traces - **move** to `O:\tmp` (reversible) |
| `chrome-shot/` | 41 MB | - | browser pane components - leave |
| `llamacpp/` | 38 MB | - | another session's toolchain - leave |
| `rc/ dec/ ins/` (decompiled client) | 19 MB -> 9 MB after dropping `.pyc` | today | **archive** to `O:\tmp`, keep only the archive |
| `evdec/` (uncompyle6) | 6.7 MB | today | keep while contracts are being audited; recipe is in `docs/CLIENT_CONTRACT_STATUS.md` |

Rules applied: nothing belonging to another session is touched; anything moved goes to
`O:\tmp` instead of being deleted; the decompiled sources are reproducible from `code.ccp`
with the recipe now in the register.

Steps:
1. `O:\tmp\opencode-archive-20261029\` receives `eve-client-decompile-v24.01.tar.gz`
   (rc+dec+ins, one archive) and the three idle `play-*.jsonl` traces.
2. Verify the archive holds the 370 decompiled modules, then remove `rc/ dec/ ins/` from `C:`.
3. Re-measure and report; `market-*` stays untouched because it is being written right now.

## Result (done 2026-10-29 03:22)

- `O:	mp\opencode-archive-20261029\eve-client-decompile-v24.01.tar.gz` - **1.4 MB**, holds the
  497 decompiled files (370 modules) from `rc/ dec/ ins/`; the `.pyc` intermediates were already
  dropped and are reproducible from `code.ccp` (recipe in `docs/CLIENT_CONTRACT_STATUS.md`).
- `play-all.jsonl` (146 MB), `play-30k.jsonl` (24 MB), `play-20k.jsonl` (17 MB) - moved to the same
  folder, **187 MB**, untouched since 2026-10-27 21:0x.
- `%TEMP%\opencode`: **1.1 GB -> 831 MB**. Left alone on purpose: `market-reseed` (467 MB, being
  written today 23:56), `market-audit.sqlite` (199 MB, 23:19), `chrome-shot`, `llamacpp`, `wt-head`
  (other sessions' tools), and `evdec/` (6.7 MB, the decompiler, needed for the next contract pass).
- Nothing in the repository depended on the deleted copies: `docs/client-contracts/calls.json` and
  `gateway-types.json` are tracked, and `node scripts/coop-client-contracts.cjs` still reports
  `calls=542 missing=0 stub=44 nullable=103 ok=395`.
