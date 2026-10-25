# Cross-stream co-op integration candidate — 2026-10-25

This branch is a reviewable **integration snapshot**, not a game-night deployment or a verified multiplayer build.

## Provenance and ownership

Base = Draft PR #2 `c76b0663a5877573a81072a96cf64c36c9ff198a`, pinned upstream EveJS `c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`. Import from Draft PR #3 `42d4f89`, #4 `3f2223f`, #5 `8033810`, #6 `7d3adc1`. Only the **changed paths** of #3-#6 were copied (their older main snapshots must not replace newer PR #2 work). No upstream checkout, container, data volume, client or network configuration was touched.

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

Run locally from the integrated project checkout (Node 22+):

```powershell
node --test tests/coop-crossstream-wiring.test.mjs tests/coop-runtime-probe-ack.test.mjs tests/coop-native-snapshot.test.mjs tests/coop-reliability-gates.test.mjs tests/coop-actionable-intel.test.mjs tests/coop-raid-beacon.test.mjs tests/coop-pve-chain.test.mjs tests/coop-player-combat-witness.test.mjs tests/coop-duo-contribution-report.test.mjs
```

When the exact pinned `Code` checkout is available: run the installer's `--dry-run` and reversible source/overlay tests **without deployment**. First live diagnostic remains:

```powershell
.\scripts\Local-Two-Client-Test.ps1 -Action DiagnoseWorld -CodePath 'C:\Games\EveCoop\upstream-evejs\Code'
```

Only after the operator separately approves a real deployment and genuine client QA, collect `World`, `Party`, native combat evidence, `coop-pve-chain` and `coop-duo-contribution-report`. Preserve `evejs-data`, do not rebuild market assets, and do not publish external ports.

## Conflict and review policy

This is intentionally based on PR #2 rather than merging PRs #3-#6 to main while other agents are editing. Review and compare **current** heads again before eventual merge; never blindly force-update other workstreams. A green isolated test does not substitute for the running overlay/world/client gate.
