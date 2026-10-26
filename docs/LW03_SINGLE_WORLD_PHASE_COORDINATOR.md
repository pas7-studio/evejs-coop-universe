# LW-03A — One ordered Living World phase coordinator

Status: **SOURCE IMPLEMENTED, original EveJS gameplay NOT_RUN**. This now includes LW-03A/B source-level extraction and phase classification;
it is not full native LW-04 factory ACT integration.

## Integration

The existing `coopVirtualWorldRuntime.cjs` remains the **sole owner** of the
30-second world interval. It now uses
`coopLivingWorldPhaseCoordinator.cjs` to dispatch its **27 named phase
call-sites in the same order and behind the same feature flags**.

- The original `safeNpcPhase` remains the per-phase error boundary, including
  its existing `coopRuntimeProbe` failure event and continue-on-fault behavior.
- The existing read-only 5-second combat observation interval is not moved.
- Native mining, hauling, combat, refinery, BPO, market, Rust, contract, ISK,
  inventory and pilot control execution are not redirected or replaced.
- The coordinator adds **no timer**, journal, wallet, state file, retry, lock
  migration, materialized NPC or native writer.
- A synchronous recursive tick is skipped; a promise-returning entire tick
  is rejected to prevent silently releasing the clock lease early.
- Individual asynchronous native phases retain their original
  single-flight/outcome protections. This coordinator **does not** assert that
  a dispatched asynchronous operation succeeded or settled.
- Phase history is a bounded, read-only **diagnostic snapshot**; every actual
  phase still executes, including more than 128 per-system reconcile calls.
- The optional `livingWorldPhases()` export returns only status, sequence,
  phase names and timing. It cannot command a ship or settle ISK.

## LW-03B: source-domain phase registry and telemetry

The static groups describe execution domains, NOT safety permissions: the
`faction` step advances virtual faction state and `native-market-schedule` can
initiate an original native market action. Counts are attempted dispatches only.

The pure `coopLivingWorldPhaseRegistry.cjs` now defines the stable ordering
and names of the 27 current phase call-sites in 9 contiguous domains:
opportunities, world-state, alife-strategy, combat, salvage, movement,
market, activity and reconciliation. Dynamic physical system
reconciles are named `npc-reconcile:<systemID>` only for positive safe integers.

The **same legacy callback bodies** still execute in their original sequence;
the registry only classifies dispatched phases and cannot authorize or skip
them. Unknown but syntactically valid future names continue executing and
appear in bounded `unknownNames` diagnostics. Snapshot group counts are
dispatch attempts, **NOT proven native operations or settlements**.

`livingWorldPhases()` now exposes grouped runtime diagnostics. An existing
`coopRuntimeProbe` event `living-world-phase-cycle` is emitted at most once
per 10 cycles under normal load, and immediately when an unclassified phase
is observed. The onCycle handler is diagnostic only and cannot change a
native result.

Existing source-only A-Life economy, buyer, and ammo-resupply wiring tests
were migrated from the old textual `safeNpcPhase` and timer signatures to
`worldPhaseCoordinator.tick(runPhase=>...)`. Their original proof and
no-second-scheduler expectations remain intact.

## Acceptance

Use `pwsh -File scripts/Run-LivingWorld-Phase-Gates.ps1` to run five Node
regression suites without touching Docker or protected `evejs-data`. Nine
physical gameplay acceptance scenarios remain explicitly `NOT_RUN` in
`tests/scenarios/lw03-single-world-phase-e2e.json`.

```bash
node --test tests/coop-living-world-phase-coordinator.test.mjs
node --test tests/coop-installer-module-coverage.test.mjs
```

The test verifies exact order for 27 named call-sites, no additional timer,
reentry, faults, diagnostics and async boundary. This source-only check is
**not** native Node/SQLite+Rust or physical game acceptance.

Original EveJS manual gates remain NOT_RUN: 30-second phases with flags OFF,
the same physical ship order priority during optional A-Life mode, native
market/cargo conservation, one read-only combat sampler and cold restart.
No changes to protected `evejs-data` are permitted for validation.

## Next dependent work

1. LW-03C: extract the remaining callback bodies into bounded adapters,
   preserve their existing effect order, then measure real native phase
   durations on a disposable test world.
2. LW-04: introduce an opt-in native **MANUFACTURE -> COMPLETE_JOB ->
   LIST_OUTPUT** executor through existing `coopAlifeNativeEconomyAct` and
   native industry director; never enable the separate
   `coopNpcEconomyScheduler` timer in unified mode.
3. LW-05: read-only projection of source-backed opportunities for native
   agent dialogue and EVEmail, without parallel escrow/wallet state.
