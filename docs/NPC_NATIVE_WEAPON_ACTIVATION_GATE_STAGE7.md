# COOP-024E stage 7 — Source-verified NPC weapon activation gate

**2026-10-25. Status: implemented in source, isolated tests PASS, real-game firing/debit unverified.** Stacked on [PR #58](https://github.com/pas7-studio/evejs-coop-universe/pull/58) → #55 → #52 → #49 → #46 → #45 → #42 → #39.

## Pinned-source finding

The pinned EveJS source (`c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f`) has a separate **native NPC weapon activation path** in `server/src/space/npc/npcBehaviorLoop.js` (`syncNpcWeapons`), which calls `scene.activateGenericModule(..., {activationHint:"weapon"})`. A previously activated module can be maintained by simply detecting its `activeModuleEffects` entry, even when its native cargo changed.

The helper `consumeLoadedChargeQuantity` in `localCycleRuntime.js` belongs to local module cycles (including boosters and local repair), **not a proven universal turret/missile shot debit API**. It must not be called by an arbitrary world tick or target-lock event to fake weapon ammunition usage. Native missile/turret virtual reload loopholes are separately addressed by PR #55.

## Implementation

- `integration/coopNpcWeaponAmmoGate.cjs` (new): optional, read-only validation against **actual nativeNpcStore**, triggered immediately before the pinned NPC weapon's `activeEffect` maintenance/activation branch.
- Requires exact native ship and stored owner identity, verified physical category-7 fitted module, exact owner/module/type/quantity in a real category-8 native charge row, and compatibility via `npcCapabilityResolver.isNpcChargeCompatibleWithModule`. Supports multiple actual grouped barrels; every fitted weapon in the bank needs one unique compatible loaded stack.
- Genuine native **transient-scene** cargo rows are legitimate native stock and work; virtual reserve has no actual native cargo row and cannot pass.
- Genuine native synthetic-hull weapons and `weaponDogma.isChargeOptionalTurretWeapon` are exempt; unsupported weapon families, ambiguous duplicated cargo, disconnected native store and wrong-owner items fail closed in strict mode.
- With verified empty magazine, **no new `scene.activateGenericModule` command is issued**, and a previously active native module receives a native `scene.deactivateGenericModule` order. This is native engine scheduling, not scripted damage or a synthetic kill.
- A single pinned-source anchored line is installed reversibly through `scripts/patch-evejs-coop.cjs` in `server/src/space/npc/npcBehaviorLoop.js`. The new helper is installed in the overlay manifest. Exact pinned full source transformed successfully: idempotent and **byte-for-byte reversible**.
- The feature is **OFF by default**. With `EVEJS_COOP_NPC_STRICT_AMMO` unset or not `1`, the gate returns immediately and the existing native weapon path is unchanged. This opt-in applies to all native NPCs in the server; playtest before enabling broadly.

## Flags

```
EVEJS_COOP_NPC_STRICT_AMMO=1  # Must be explicitly enabled on disposable test server
# For NPC AI station supply response from PR #58, separately:
EVEJS_COOP_NPC_AMMO_SUPPLY=1
EVEJS_COOP_NPC_ORDER_ARBITER=1
```

## Test evidence

- **19/19 isolated committed tests PASS:** 14 native charge/owner/module/banked-weapon/synthetic-hull/ephemeral-inventory assertions, and 5 source hook tests including refused activation, deactivation of existing effect, correct activation with real ammo, default-off baseline, and exact reversible/idempotent patch.
- Actual complete pinned upstream `npcBehaviorLoop.js` (141,499 characters) fetched and transformed through committed patch implementation. Native JS syntax validated, patch applied exactly once and reverted to original content.
- **Not verified:** live native EveJS daemon/server `node --test`, networked client weapon effects, actual fired-cycle damage receipts and one-unit-per-shot authoritative charge debit, native market/loot concurrency, scene restart, multi-bank cadence and real NPC battle balance.

### Critical remaining P0: actual per-shot debit

**This branch is an activation/continuation guard, not a per-shot consumption implementation.** Native gameplay must show real charge debit at an authoritative successful weapon firing/cycle boundary, without duplicate spends under replay or interrupt. The pinned `npcBehaviorLoop` activation ACK and 30s World observer are **not** proof of a fired cycle. Before declaring the ammo economy complete, identify the actual weapon cycling owner (native scene engine / module activation scheduler), add a source-backed unique-cycle receipt if needed, verify cargo debit on a live successful turret/missile firing, and test missed shot, cooldown, manual cancel, reconnect, restart and concurrent module banks.

If no reliable source-owned cycle callback exists, **fail closed** rather than artificially decrementing ammunition in the World tick.

### Safe game acceptance procedure

In an owner-approved disposable EveJS server with two clients and native fitted weapons: (1) prove loaded genuine native cargo permits weapon activation; (2) deplete it with actual fired cycles and capture authoritative before/after quantities; (3) prove active weapon is deactivated and cannot resume at zero without real ammo; (4) prove natural charge-optional/hull synthetic weapon still works; (5) prove repeated activation attempts, crashes and restarts do not mint/debit twice; (6) allow native NPC to return to physical station, spend real earned NPC market ledger and reload bought charges per PR #52/#58.

**No main merge, CI, Docker/restart, or existing `evejs-data` changes.**
