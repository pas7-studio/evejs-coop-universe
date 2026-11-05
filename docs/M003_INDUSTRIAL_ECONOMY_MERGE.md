# M003 «industrial economy» (L9-A) — what was prepared, what was merged, what is left

Date: 2026-11-05. Owner ask: «у нас підготовлений код десь в ПР або гілках масштабний
ALIFE 2.0, треба переглянути і зливати в main».

## 1. Where it actually was

| side | branch | state before the merge |
|---|---|---|
| engine (fork `pas7-studio/EveJS`) | `mission/003-industrial-economy` | 131 commits ahead of `coop/pas7std`, 191 behind |
| this repository | `origin/mission-003-industrial-economy` | 53 commits ahead of `main` |

The only open pull request (#350, `docs/personal-fleet-contract-freeze-v1-4-20261104`) is
**not** this work: it is a Personal-Fleet contract with policies and tests that explicitly
says the native gameplay integration is missing. The industrial-economy work was never a PR —
it lived as those two branches.

## 2. What it is

M003 is the industrial half of the living world: a corporation that buys ore, refines it,
manufactures from it, ships it in manifests, sells it into real market bids, and sweeps the
proceeds into a treasury — with every step leaving a durable artifact that can be re-read after
a crash. Its own acceptance instrument is `Doc/tools/verify-l9a-world.js`, which reads a world
root and fails on a receipt that does not cover itself, a `SETTLED` journal row without a
primary receipt, a manifest that closes over cargo it does not hold, money that moved without a
receipt, or a treasury that does not reconcile.

Runs 4-18 live in `Doc/L9A-RUN*-REPORT.md` on the branch; the close-out report is
`Doc/L9A-CLOSEOUT-REPORT.md`.

## 3. The surprise: most of it was already in `main`

Of the 120 files the branch adds relative to its base, **92 are byte-identical to files that
already exist on `coop/pas7std`** — the bulk of the economy package landed in main earlier
through other integration branches. The real remaining delta was small and focused:

| kind | files |
|---|---|
| new modules | `coopCorporateShipment`, `coopNativeSaleLedger`, `coopNativeSaleProofSettlement`, `coopNativeSaleRefusalWindow`, `coopRefineryBudget`, `coopSaleAmount` |
| new tool | `Code/server/scripts/coop-issue-shipment.js` |
| modified modules | `coopDistributionPlan`, `coopDistributionRun`, `coopMarketJournalBoot`, `coopNativeHaulManifest`, `coopNativeNpcMarket`, `coopNativeNpcMarketReconcile`, `coopNativeStationArrival`, `coopNpcDistribution`, `coopNpcRefineryTick`, `coopVirtualWorldRuntime` (+ `.pure`) |

Behaviour that now exists:

- **sale refusal window** — one window per (station, hauler), 60 s doubling to 300 s, opened at
  the choke point every seller goes through (`sellOnArrival`), so a refused batch is not offered
  on every tick (measured before the fix: 1 390 offers of one batch at a 5 s cadence);
- **sale amounts in exact ISK cents** (`coopSaleAmount`) and the real `marketOrderID` on every
  sold row, so an arrival can claim the bid it was actually paid from;
- **multi-station receipts** — a receipt states its own settlement and its per-fill rows instead
  of naming the last station for five;
- **refinery spend scope** (`coopRefineryBudget`) — a fee is only paid inside a durable,
  operator-set budget; without a budget file the limit is 0 and nothing is spent;
- **corporate shipments** (`coopCorporateShipment` + `coop-issue-shipment.js`) — a demand map
  aggregated per type, with an activation adapter;
- **the economic beat is started** by the living tick when `EVEJS_COOP_LOOP_DRIVER=1`
  (measured 2026-11-03: the flag was on and nothing ever called the driver).

## 4. Merge and adaptation (what had to be decided by hand)

Merged on 2026-11-05 into `coop/pas7std` (fork commit `c96dc66`) and into `main`
(this repo, `b8811574`). Conflicts: **1 in the engine, 3 in this repository**.

1. `coopNpcRefineryTick.js` — the branch rewrote the file (multi-dock manifests, batch mode,
   budgeted fees); main had added a note-suppression window (48 identical records in two
   minutes). Resolution: the branch's file, with main's window reinstated.
2. `docs/coop-flags.json` — regenerated from the merged code (`node scripts/coop-flags.cjs
   --baseline`), not hand-merged: 529 keys declared, 529 read.
3. `integration/coopUniverseSites.cjs` (add/add) and `tests/coop-absent-state.test.mjs` —
   the engine file and the newer, stricter test from `main` respectively.
4. `coopVirtualWorldRuntime.js` crossed the audit's 4 100-line ratchet (4 107). The ceiling is
   never raised: the sale-refusal-window wiring moved into the existing
   `coopVirtualWorldRuntime.pure.js` sibling (4 097 lines now).
5. `integration/coopNpcMarketMakerBands.js` shim was missing on `main` — `coopNpcTraderMaker.cjs`
   requires it as `path.join(__dirname, …)`, so `coop-integration-shims.cjs --check` failed.
   The shim is now committed.

Beyond the conflicts, the merge exposed a **second** class: `scripts/overlay-spec.cjs` had
grown two incompatible tails. The branch appended its 87 module names **after** `module.exports`
with an unconditional `names.push`, while main's require-graph loop above had already added the
same names — 539 entries for 524 modules, so a fresh overlay would have deployed 15 modules
twice. The list is now declared before the export and guarded by `names.includes`. Two further
mirror gaps were closed in the same pass:

- nine modules existed in `integration/` but were **never in the installer list** (the M003 set
  plus `coopNpcTraderMaker`, `coopNpcTraderRelist`, `coopTraderEndowment`);
- eight modules were in the installer list but had **no `integration/` copy** at all
  (`coopSiteSentries`, `coopSiteSentrySpawn`, `coopSiteSentryFire`, `coopSiteLootStructures`,
  `coopMilitiaSession`, `coopWarRewards`, `coopNpcBuyerLots`, `coopOwnerTeleport`) — the repo
  could not have built a working overlay for them.

`installer.names` and the tracked `integration/` set are now the same 533 names.

Four real defects were found by the suites once the code was merged, and fixed in the engine:

- the **liquidating leg** (`HOLD_ALREADY_FULL` → sell what is aboard) wrote a journal with no
  `trip`, and the branch's new journal validator requires one for `SELL`/`CROSS`: the file was
  there, `read()` called it `INVALID`, and the run looked finished with the freight still aboard;

- `planTrip` wrote `trip.demand` **per stack**, so the last stack replaced the earlier ones:
  three 10 000-unit rows produced a 10 000-unit demand map and the loader was authorised for a
  third of what the buyer asked (12 000);
- the **factory reserve was subtracted from every row**, so a 20 000 reserve against three
  10 000-unit rows shipped nothing (`NO_STOCK_IN_SYSTEM`) instead of the remaining 10 000; it is
  now one budget per (station, type) spent across the stacks;
- the same per-stack overwrite in the LOAD step of `coopDistributionRun`.

Two test fixtures were adapted to the new contract rather than the contract to the fixtures
(the branch's rules are stricter on purpose, and weakening them would be the wrong direction):

- `tests/coop-npc-refinery-tick.test.mjs` now establishes an operator **budget file** before a
  fee is paid — `coopRefineryBudget` makes the env flag a ceiling and the file the scope, and
  without a file nothing is spent;
- `tests/coop-npc-market-reconcile.test.mjs` now writes the **sale-attempt row** the seller
  stores before it calls the market, because `coopNativeSaleProofSettlement` refuses to pay a
  fill whose identity (fleet, corporation, hauler, type, station, system) it cannot prove.

One known-red case remains and is **not** from this merge: `coop-native-haul-transfer-physical`
«forged/corrupt original cargo fields» fails identically at `ed18182a` (pre-merge, verified in a
worktree). Its `wrongQuantity` variant mutates a copy returned by `listNativeCargo()`, so the
mutation never reaches the module under test.

## 5. Gates (all local, no CI)

| gate | result |
|---|---|
| `node scripts/coop-engine-audit.cjs` | `AUDIT_OK` (560 co-op modules, 62 stock files touched, 65 488 chars, 0 integration drift) |
| `node scripts/coop-flags.cjs --check` | `FLAGS_OK declared=529 read=529 stale=0` |
| `node scripts/coop-integration-shims.cjs --check` | `SHIMS_OK` |
| branch suites (`ie-*`, `review-*`, `coop-refinery-budget`, `coop-corporate-shipment`, `coop-issue-shipment`) | 257 checks, 251 pass → after the three fixes 257 pass |
| `coop-demand-map` + `coop-buyer-volume` | 15/15 |
| market-maker / trader / endowment suites | 31/31 |

## 6. What is NOT done (do not claim otherwise)

- **Not deployed.** The play stack still runs the previous image; M003 code is in the source and
  builds, but no restart window was taken. Deploy = `docker build -t evejs-local .` in
  `Code/`, then a play-stack recreate **with the owner's go**.
- **No live M003 evidence on the play stack.** The branch's L9-A evidence was measured on its own
  `m003s*` worlds, not here.
- `EVEJS_COOP_NPC_REFINERY` is `0` in `compose.coop-probe.yaml`; the refinery half of M003 stays
  off until someone decides to fund it and watch it.
- The strategy, jobs and lag items from the earlier handoff are untouched by this merge.

## 7. How to verify after a restart window

```
# 1. the world still boots and the beat runs
docker exec evejs-server-1 sh -c "grep -c 'living-' /var/lib/evejs/coop-events.jsonl"

# 2. the artifacts M003 owns
node Doc/tools/verify-l9a-world.js <copied world root>     # in the engine checkout

# 3. no offer storm
docker exec evejs-server-1 sh -c "grep -c 'living-npc-sale-refusal-window' /var/lib/evejs/coop-events.jsonl"
```

A world that shows an offer storm and never opened a refusal window fails the checker with
`SALE_OFFER_STORM`.
