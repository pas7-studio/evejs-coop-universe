# START HERE (agents, ≤2 minutes)

You may be a cloud session with no access to the owner's PC, Docker or the EVE
client. The repository is the only shared memory. Read in this order:

1. **`state/NOW.md`** — one generated screen: last test result, overlay state,
   gate status, what to do next. 40 lines, no secrets.
2. **`state/status.json`** — same facts, machine-readable (`projectRev`,
   `upstreamPin`, per-gate status). Use it instead of grepping logs.
3. **`state/ledger.json`** — every `COOP-*` task with its real status; it is
   generated from `docs/ROADMAP.md`, so trust the roadmap, not memory.
4. **`state/digests/<runId>.md`** — the detail behind the last run: server event
   counts, redacted client-log tail, overlay drift list.
5. Only then the deep docs: `DEVELOPMENT_DOCTRINE.md` (how to change code),
   `GAMEPLAY_TESTING.md` (how to accept gameplay), `ROADMAP.md`.

## How we work

- **No CI, ever.** The owner removed all workflows. Testing is local and manual.
- **Overlay, not fork.** Upstream EveJS stays byte-identical; we add 19 hooks and
  copy `integration/*.cjs` modules. Rules: `docs/DEVELOPMENT_DOCTRINE.md`.
- **Evidence ladder:** unit test → dry-run → deployed (`OVERLAY_OK`) → server
  events → one authorized client → two clients. Claim only the rung you reached.
- **Nothing is "done" from documentation or tests alone.** Real gameplay needs
  server evidence plus a human-visible client.

## Trusting the state bundle

- `state/status.json.projectRev` is the commit the facts came from.
  `node scripts/coop-state.cjs --verify` prints `STATE_STALE` when anything
  outside `state/` changed after that publish. Stale = read `git log` before
  acting, never assume.
- Raw logs, screenshots, DB dumps and pilot names are **never** committed; only
  counts, tails and hashes. If you need the bytes, ask the owner.

## What you must not do

Do not run `npm audit`, dependency upgrades, CI, market rebuilds, volume resets,
or kill processes you did not start. Do not edit the deployed upstream tree.
Do not "fix" a red gate by relaxing an assertion.

## Publishing from the local machine

```powershell
# full publish (runs the local suite, overlay check, server events, client logs)
.\scripts\Publish-SessionState.ps1 -Note "what I just did" -Next "what is next"

# cheap publish after a launch or a manual test (keeps the last test result)
.\scripts\Publish-SessionState.ps1 -Note "server restarted" -Next "run World" -SkipTests

# read-only health of the bundle itself
node scripts/coop-state.cjs --verify
```

Then commit `state/` together with the change it describes. A publish without a
commit is invisible to every cloud session.
