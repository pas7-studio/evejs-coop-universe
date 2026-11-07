# PF81 — post-test native WORK integrity (PR #350)

**P0 false-positive fixed:** PF80 verified the file set and PF55 stock source
before invoking the PF77 Node subprocess. The subprocess could modify already
verified native files, add non-native or ignored files, or edit the orchestration
repository and still be followed by a successful PF80 review receipt.

`prepare_complete_native_work.py` now records the expected SHA256s from the
source-pinned PF62 stage and the original PF55 transformer. It checks the exact
22 native paths and bytes once after patching and once **after** PF77 returns.
It also detects symlinks, ignored/untracked artifacts, and any newly dirty
original Git source checkout. A passing Node test alone never generates a
`postTestNativeIntegrity: PASS` receipt.

## Proof

Before correction, PF81's first 3 post-execution mutation tests were
**3/3 red** (PF80 erroneously accepted corrupt worktrees). After correction,
**22/22** combined PF68/PF80/PF81 Python tests pass on Node 22 / Python 3.13,
using real disposable Git worktrees and `git apply` with synthetic original
sources. Mutation tests exercise:

- PF77 adding an untracked native JS file;
- PF77 overwriting the original PF62 native NPC service;
- PF77 overwriting the original PF55 order arbiter;
- PF77 writing an ignored artifact;
- PF77 modifying the orchestration Git checkout.

The source native fork remains unchanged. On failure the affected WORK tree is
preserved for review; no unsafe auto-reset, rerun, push or deployment occurs.
The release gates remain **NOT RUN** on the true EveJS server and two clients.
