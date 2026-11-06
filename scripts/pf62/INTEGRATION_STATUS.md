# PF-62 — Exact acceptance status, not a gameplay claim

| Gate | Status | Owner evidence needed |
| --- | --- | --- |
| PF-59–61 local Node + SQLite | 59/59 PASS at previous PR head | Rerun on latest branch; includes 6 PF-60 SIGKILL |
| PF-62 out-of-tree composition | 13/13 Python PASS (PF-63 strengthened) | Synthetic native fixtures only |
| Stock source pins | Recorded and cross-checked against GitHub | Native engine checkout preflight still NOT RUN |
| PF-58 + PF-59 + PF-61 + PF-66 one native patch | Implemented as one 20-file, read-only, source-pinned builder | `git apply --check` against actual engine NOT RUN |
| Original server `.js` module staging | 18 distinct modules included by builder | Source-specific requires checked; full engine not booted |
| Real agent + wallet + ItemStore + NPC profile | NOT INSTALLED | Original in-process bootstrap wiring |
| Global writers including WAR/Mining/Exploration | NOT FENCED | Owner-specific original transaction audits |
| PF-60/61 terminal native cleanup | Candidate tested; NOT INSTALLED | Native controller writer, physical death/dock evidence |
| `pas7-studio/EveJS` write | BLOCKED 403 | GitHub integration repo Contents: RW |
| Original WORK server and two EVE clients | NOT RUN | Local owner WORK E2E and crash proof |
| PLAY/main activation | OFF / unchanged | Only after owner signoff and restart window |

No remote CI, automatic merge, fork modification, production flag change, or
unreviewed direct stock-code rewriting is authorized.

## PF-63 additional preflight gates

- PF63 historical baseline patch: 2 source edits + 16 new modules (18 paths). PF66 extends this to 2 stock edits + 17 new modules = 19 paths.
- Read-only `git apply --check` against actual native checkout; abort on module collisions
- Ephemeral `git apply` roundtrip with byte equality of all 20 files
- Reject output directories that contain either checkout (in addition to output nested in them)
- **Still NOT RUN:** real WORK server, original EVE client, two-player interaction and all writer fences

- Four archived modules without trailing newline are normalized only in the staged copies.

## PF-66 new release gate — source-bound sessionless docking

- Scoped original dock command binds PF56 `DOCK_ISSUING` with PF54 ACTIVE,
  PF58 consumed original hull lock and unique PF actor claim in one original
  GameStore transaction before an irreversible stock ItemStore dock.
- Separate source-pinned `nativeNpcService` capability must remove **scene
  state only**; PF59 generic NPC destroy remains prohibited. PF60/61 still
  own terminal persisted native row cleanup after independent readback.
- 27/27 isolated PF66 Node and 6/6 Python PASS. The newly updated PF62 Python
  composition suite is **not rerun** against the complete 20-file original
  source, and real WORK E2E remains NOT RUN. No feature flags enabled.
