# Cross-stream co-op integration candidate — 2026-10-25

This branch is a reviewable **integration snapshot**, not a game-night deployment or a verified multiplayer build.

## Provenance and ownership

Base = Draft PR #2 `c76b0663a5877573a81072a96cf64c36c9ff198a` updated with its newer `e06c7b3e23d7722bcc6eb3f681aa28f3eca021b9` (native contracts opt-in), pinned upstream EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Import from Draft PR #3 `a6ac72c` (snapshot durability hardening), #4 `3f2223f`, #5 `8033810`, #6 `7d3adc1`. Only the **changed paths** of #3-#6 were copied (their older main snapshots must not replace newer PR #2 work). No upstream checkout, container, data volume, client or network configuration was touched.

## Actual integration changes

1. Import QA diagnostics (#3), live raid/intel presentation (#4), causal shared-loot report (#5), and per-pilot real applied damage (#6).
2. Install #6's reversible pinned `killmailTracker.noteDamage` patch through PR #2's **single transactional overlay**. Copy `coopPlayerCombatWitness` in the existing space module set; do not run competing patch installers.
3. Enable passive player damage receipts only for an explicitly selected `-LivingCoop` deployment. The default EveJS behavior remains off; damage/loot/mission authority unchanged. The existing PR #2 native fleet, mission and trading flags stay as-is.
4. The runtime JSONL writer returns true only after `appendFileSync` succeeds; a missing path or IO failure returns false. The witness reports `TELEMETRY_NOT_RECORDED` rather than claiming a receipt when the writer cannot append. Other existing best-effort telemetry callers remain compatible.
5. Register cross-stream Node regression tests in the **local manual** verifier. No GitHub Actions or remote CI is installed. Remove the redundant second mission-source helper invocation (the helper was idempotent, but repeated invocation made the integration harder to audit).

## Boundaries (do not misreport)

- No local Windows Docker host or authentic two-client runtime was available to this integration agent; **no gameplay or runtime verification PASS is claimed**.
- Headless `/var/lib/evejs/coop-events.jsonl` absence remains `BLOCKED_TELEMETRY` until the operator runs read-only `DiagnoseWorld` on the exact running image. This branch is not proof that it now exists.
- Real fleet invitation, both physical warp arrivals, player-vs-NPC hits, loot-source debit, native reward settlement, saved inventory, relog and client rendering remain pending user-controlled acceptance.
- Native mission objective sharing is separate from independent per-player payout; the latter remains OFF pending an exactly-once crash-recovery journal.
- Stock NPC ore `virtual depot` is still not player-accessible authoritative inventory for station reprocessing/blueprint production.
- Never treat a stock NPC order or scripted alert as independent NPC wallet/cargo/order/escrow proof.

## Source and manual test gates

The native `contractMgr` -> `contractProxy` opt-in routing patch from PR #2 was also synchronized after the first integration commit. It stays **disabled** unless `EVEJS_COOP_NATIVE_CONTRACTS=1` is explicitly set; do not advertise contracts as tested or enable it for game-night without native escrow/courier/client checks.

Run locally from the integrated project checkout (Node 22+):

```powershell
node --test tests/coop-crossstream-wiring.test.mjs tests/coop-runtime-probe-ack.test.mjs tests/coop-native-snapshot.test.mjs tests/coop-reliability-gates.test.mjs tests/coop-actionable-intel.test.mjs tests/coop-raid-beacon.test.mjs tests/coop-pve-chain.test.mjs tests/coop-player-combat-witness.test.mjs tests/coop-duo-contribution-report.test.mjs tests/coop-native-contract-routing.test.mjs tests/coop-native-contracts-lp-integration.test.mjs
```

When the exact pinned `Code` checkout is available: run the installer's `--dry-run` and reversible source/overlay tests **without deployment**. First live diagnostic remains:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

Only after the operator separately approves a real deployment and genuine client QA, collect `World`, `Party`, native combat evidence, `coop-pve-chain` and `coop-duo-contribution-report`. Preserve `evejs-data`, do not rebuild market assets, and do not publish external ports.

## Conflict and review policy

This is intentionally based on PR #2 rather than merging PRs #3-#6 to main while other agents are editing. Review and compare **current** heads again before eventual merge; never blindly force-update other workstreams. A green isolated test does not substitute for the running overlay/world/client gate.

## Snapshot refresh

After the first integration merge, PR #2 advanced to `e06c7b3e23d7722bcc6eb3f681aa28f3eca021b9` (new optional native contracts / LP contract-level tests); PR #3 advanced to `a6ac72cf5b10e09a0cf2f247af06949c5a67c4f8` (read-only snapshot hardening). This snapshot includes their new changed files; no operator backend test was run. Later workstream changes require an explicit follow-up comparison, not blind overwrites.

## Opt-in native contracts deployment flag

PR #2's newer `4ca22f9546c49216b4026c93f982236b3f60e9df` adds an explicit `-EnableNativeCoopContracts` switch. It is now included **without enabling** contracts in default LivingCoop. No real courier, escrow, crash-replay or UI acceptance was executed. Local verifier already includes `coop-native-contracts-lp-integration.test.mjs`.

## P0 co-op LP standing sync

Latest PR #2 `f6646c31dfd3b2500b49ef47b5612d07b9165f6f` adds authoritative static LP standing requirements and native contracts/LP documentation. The integration installer now includes its reversible standing patch and module. Native LP standing gate is **OFF by default**; explicitly selected `-EnableNativeLpStandings` only. Manual Node verifier registers its tests; no real authorized client LP purchase was verified. Keep original PR #2 active and this integration branch Draft.

## Verified cross-stream evidence defect fixed

The combined `coop-duo-contribution-report.cjs` previously counted genuine A/B native damage **and** a separate valid C/D mission objective as a single two-player completion. A deterministic real-module reproduction demonstrated the false PASS. The integration branch now requires mission credit for the **same exact two character IDs** that provided two distinct authenticated hits on a single physical native NPC victim. It preserves independent mission and damage reporting, but marks unrelated mission credit `MISSION_CREDIT_NOT_LINKED_TO_DAMAGING_CREW`, never overall success. Added positive/reordered-crew and adversarial negative tests. This is a server JSONL correlation fix, NOT proof that two clients completed their mission or received rewards.

## Reproducible native-source overlay verification (2026-10-25)

Ran the combined PR #7 overlay `transform` on **all 19 real source files** from pinned EveJS commit `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`, using a restricted JavaScript harness (not a Windows Node Docker run). Each file parsed after patching, repeated patching was byte-stable, and removal restored the original source exactly: **19/19 parse, idempotence, round-trip PASS**. All source anchors matched this pinned SHA. A new local Node regression `tests/coop-crossstream-overlay-roundtrip.test.mjs` is registered in the manual verifier to repeat all checks on the operator's actual Code checkout. This is static native source integration evidence only; real game runtime, telemetry, inventory writes, multiplayer and client screenshots are still unverified.

## Global merge reconciliation (2026-10-25)

Integrated PR #10's safe startup diagnostics and native state-load warning from the fully merged PR #2 lineage, preserving the boolean acknowledgement used by coopRuntimeProbe.observe() for the combat witness. Added read-only Diagnose-Coop-Telemetry.ps1 and three telemetry regression suites, and registered those plus PR #8's transactional damage overlay test in the local verifier. PR #8's same-crew same-system, after-combat, 30-minute correlation was reconciled with PR #7's all-verified-damaged-pairs logic; unrelated duo mission cannot produce a false PASS. PR #11 lethal NPC victim proof merged into PR #7 as 85c24f7. Windows Docker and two-client verification are still unrun.
