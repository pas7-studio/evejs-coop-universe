# COOP-024E stage 6 — Real native ammo exhaustion → safe NPC supply route

**2026-10-25 — Implemented in source, isolated tests PASS, native two-client gameplay UNVERIFIED.**

Dependency chain: [PR #55](https://github.com/pas7-studio/evejs-coop-universe/pull/55) (native strict ammo reload + read-only cargo witness) → #52 → #49 → #46 → #45 → #42 → #39.

## Player-visible behavior being added

A named pirate NPC with a genuine native ship and pre-existing fitted weapons should not blindly start new raids after all ammunition has been exhausted. Once **both the loaded charges and compatible loose native cargo stacks are empty**, and the NPC has **no viable charge-optional or synthetic hull weapon**, it should attempt to reach an **actual native station** via native warp/orbit. It must not teleport, receive virtual ammunition, create a player-wallet credit or perform simulated repairs.

New `integration/coopNpcAmmoSupply.cjs` inspects real authoritative `nativeNpcStore` ship, module and cargo rows, the ship's actual `npcEquipment.getNpcWeaponModules` and pinned `weaponDogma`/NPC charge compatibility. Its result is only `AMMO_EXHAUSTED` if all confirmed available installed weapon modules **require** an ammo type AND no real loaded/compatible loose charge remains. It does NOT count:
- synthetic native hull weapons as unloaded purchased weapons;
- charge-optional energy/other turrets as ammunition-starved;
- random unrelated cargo, incompatible charge types or another NPC's items as ammunition;
- a duplicate/missing physical fitted module as an assumed usable gun.

On exhausting ammo, the pilot enters a short-lived process-local resupply lease; raiding and allied rescue-assault orders against other NPCs are suppressed. Other civilian/patrol orders cannot immediately redirect the same ship.

### How physical retreat is authorized

- Only named pirate NPCs with a unique native ship link in a real EveJS scene are eligible. Never move a player-controlled hull.
- The controller and actual native ship must be present; if the ship is warp-scrambled, no warp command is issued. Existing combat remains native.
- Find the nearest **actual live station** in the same system whose identity and system are corroborated with authoritative `worldData.getStationByID`.
- During recent aggression, require station sufficiently far from the attacker (>500 km), never orbit a nearby station to interrupt active combat. A retreat under combat may issue **real native warp only** when the destination is >250 km away and warp is possible.
- Farther than 250 km: real `npcRuntime.warpToEntity`; closer than 250 km and not fighting: real `npcRuntime.orbit` at 2 km. Within 5 km: **await supply**; no phantom docking or free refill.
- Cooldown on repeated orders (60 seconds), max 3 new native orders per system tick, bounded process-local leases.
- When actual real compatible loaded or loose native cargo returns, report `npc-ammo-resupplied` and release the raid/order block. A temporarily unreadable fitted module is **not** proof that resupply occurred.

### Integration and guards

- `integration/coopVirtualWorldRuntime.cjs`: new `native-ammo-supply` world phase **before native raids**, and the same supply lease blocks new raids, NPC rescue-assault orders, civilian/patrol overrides. Uses native shared order arbiter and native warp/weapon semantics, not a second attack engine.
- `scripts/patch-evejs-coop.cjs`: includes only new co-op source in existing pinned reversible overlay. No additional patch to native EveJS combat logic.
- Native `npcEquipment.getNpcWeaponModules` can return synthetic hull weapons; the source safely distinguishes them from physical cargo-consuming modules. No new ammo types, stats or virtual budgets are introduced.

## Feature gates (default OFF)

```
EVEJS_COOP_NPC_STRICT_AMMO=1
EVEJS_COOP_NPC_AMMO_SUPPLY=1
EVEJS_COOP_NPC_ORDER_ARBITER=1
EVEJS_COOP_NPC_RAIDS=1
EVEJS_COOP_MATERIALIZE_NPCS=1
EVEJS_COOP_VIRTUAL_WORLD=1
```

For NPCs to **buy** ammunition automatically with actually earned ledger funds, also enable PR #52's `EVEJS_COOP_NPC_EARN_SPEND_REARM=1`, seeded native market and correctly configured charge buy/rearm allowlists; it remains independent and OFF by default. An NPC stranded without a market seller, funds, valid native modules or a real station will **not** magically restore its combat capability.

**Safety:** The ammo-supply feature does not claim successful weapon firing, ammo consumption per successful shot, player-visible battle end, or true docking. Both native market repair and Crimewatch restrictions from earlier PRs remain. This branch does not touch the native player inventory/wallet or bypass loot rights.

## Tests and acceptance

- **15/15** focused tests PASS against exact committed JS modules in isolated V8: real native empty-gun readiness, loaded/loose ammo, optional/synthetic alternative, multiple weapons, false/unverified fitting, pilot identity, no warp spam, scramble, battle-only safe warp, station arrival, recovery after actual native resupply, false station/player exclusion, and transient native fitting read failure.
- Source parse for module, World integration and overlay PASS. Previous stage #55 has 15/15 isolated regression tests; full native `node --test` baseline and active client test still needed.
- **NOT TESTED:** real native shot/cycle-to-charge debit, warping and scramble in full native simulator, actual station sale/buy and rearm at runtime, persistent strategy/goals through full server restart, two client view, and network/performance faults.

### Owner-approved disposable live gate

Start two EveJS clients, observe an existing named pirate with a **real fitted ammo-consuming module**. Confirm native store has actual charges. Fire until empty; **verify per-cycle actual ammo debit with authoritative combat records**, no free virtual reload, that raiding stops and station warp/orbit proceeds (unless scrambled), that seeded market purchase costs actual NPC ledger funds, that real native purchased cargo reloads exactly one existing module, and that the NPC resumes raid after positive verification. Include synthetic hull-weapon control, shot failure, repeated cycle, restart and malicious/concurrent player attack. Do **not** use or modify `evejs-data` for this test without authorization.

**Draft, not merged/deployed; no Docker restart, CI or main mutation.**
