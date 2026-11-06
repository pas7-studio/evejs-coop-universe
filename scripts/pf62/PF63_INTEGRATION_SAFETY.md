# PF-63 — complete native review patch, no partial deployment

## Defect
PF-62 generated `PF62-NATIVE-REVIEW.patch` with changes to two existing native
stock files but excluded the sixteen dependent `coopPersonalFleet*.js` files.
`git apply --check` therefore could succeed even when installing that patch
would leave unresolved native `require()` dependencies.

## Corrected contract

1. The patch must contain **exactly 18 file diffs** — two existing stock files
   and 16 `new file mode 100644` native modules. It is review-only.
2. Before emitting the bundle, `git apply --check` runs against the original
   engine checkout without writing to it. Preexisting native module filenames
   block the candidate, rather than overwriting existing code.
3. A separate temporary repository receives original stock preimages only.
   `git apply` is executed there and every resulting file is checked byte for
   byte against the expected staged source. Temporary files are removed on exit.
4. Protect against output nested inside either checkout **and** an output
   directory containing either checkout, including the engine alone.
5. Normalize the four archived CommonJS modules without a terminal newline
   only in the staged copy; never rewrite the archived source.
6. Stock source pins, explicit disabled feature flags, original wallet/ItemStore
   ownership rules and PF-42 coexistence prohibition remain in force.

## Evidence
Manual Node 22.16.0: PF-59–61 regression **59/59 PASS**, including PF-60
Linux SIGKILL. Python 3.13 PF-62/PF-63 composition **13/13 PASS**. Original
EveJS source pin anchors independently inspected from `pas7-studio/EveJS` GitHub
fork (`nativeNpcService.js` `ca039da...`, `nativeNpcStore.js` `95724ab...`).
**Full original fork checkout validation and WORK E2E: NOT RUN**.

## Native handoff (only in owner-controlled WORK checkout)

```powershell
.\scripts\pf62\Test-PF62-Local.ps1 `
  -NativeCheckout 'C:\Games\EveCoop\upstream-evejs' `
  -ReviewOutput 'O:\tmp\PF62-review'
```

Do NOT treat bundle generation as authorization to merge, deploy or flip flags.
After a successful local preflight, integration still needs a separately
reviewed engine-fork commit, real authority bindings, unfenced writer closure,
real source compilation, WORK service and two independent EVE clients.
Neither main nor PLAY are modified by this script.

## PF-66 extension (subsequent change, 2026-11-06)

The 18-file PF-63 contract described above is the historical baseline. PF-66
adds a source-pinned scoped dock scene-detach module and transform against the
same original `nativeNpcService.js`; the current integrated review bundle MUST
therefore contain **19 paths**: two stock edits plus **17** new files. The
PF-63 no-partial-install, no-overwrite, byte-perfect `git apply` and
out-of-tree output rules still apply. PF66 is a review candidate, not installed.
