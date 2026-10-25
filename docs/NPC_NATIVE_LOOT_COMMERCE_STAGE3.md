# COOP-024E stage 3 — Native loot delivery and seeded market sale (2026-10-25)

**Status:** IMPLEMENTED in source, **isolated tested only**, opt-in **OFF**, in-game acceptance NOT DONE. Stacked on [PR #46](https://github.com/pas7-studio/evejs-coop-universe/pull/46) (real wreck→cargo custody), which depends on #45/#42/#39.

## Gameplay: physical loot actually affects a real seeded market

For an authorized NPC that survived its native raid, owns a **confirmed** recovered wreck cargo stack, and is not actively fighting, this stage:

1. Reads the **durable SETTLED custody receipt** and native cargo row to prove exact original `wreckID`, `wreckItemID`, owner, pilot ID, type and quantity. `coopNpcWreckCustody` now persists `sourceWreckID` and `sourceWreckItemID` on the actual native cargo record; those fields must agree with the source journal even on recovery. Items with missing/forged provenance and unrelated regular NPC cargo do not qualify for loot commerce.
2. Finds a **real station** in the NPC's physical EveJS scene and verifies its authoritative `worldData` system. Uses the **same native NPC hull**, native `npcRuntime.warpToEntity` and `npcRuntime.orbit` commands under the shared order arbiter, with an anti-spam cooldown. No teleportation and no fake docking.
3. Issues sale eligibility only when the NPC is **physically within 5 km** of that real station, still owns the same cargo, is not a player-controlled hull, and retains an active native controller. The checked evidence is short-lived and revalidated at offer time.
4. Allows a named pirate into the existing `coopNativeNpcMarket` seller path only with `EVEJS_COOP_NPC_LOOT_COMMERCE=1`, a true `stationReady` proof and a specific recovered cargo ID. Existing trader/hauler roles, purchases and all non-pirate market behavior remain unchanged.
5. Calls the existing real `GetOrders` and `FillOrder` **only for source=`seed` station BUY orders on explicitly allowlisted item types**, with the *exact* `cargoID` and a provenance callback checked **before and after the async book lookup**. This avoids selling a different stack of the same type if the original changes or disappears. The native market tx journal retains `lootSource`, cargo ID, confirmed order and settled quantity.
6. Existing native market RPC ack, source cargo decrement and journal restoration remain authoritative. Partial sales preserve original wreck provenance on the remaining native cargo. Full sales remove the cargo row. If the external RPC outcome is ambiguous, the native market fence requires operator reconciliation; no repeated fill and no fictional sale.

**Economic accounting:** `FillOrder` changes the actual native seeded market order's remaining stock and reduces the **actual NPC-native cargo**. `coopNativeNpcMarket` records sale proceeds in its own **NPC market ledger**, NOT in a player's authoritative EveJS wallet. The event explicitly says `NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET`. This IS a real order/cargo settlement but NOT a full NPC wallet/repair/replacement economy yet.

**No real seeded BUY order in the reached station = no sale.** This stage chooses the nearest actual station, not an invented profitable buyer or cross-system destination. Intelligent order-book search, inter-system delivery, NPC fitting purchase, repair and Crimewatch-compliant looting remain future work.

## Source files

- `integration/coopNpcLootCommerce.cjs` (new): strict journal provenance validator, bound real native cargo, physical station waypoint navigation, 5-km arrival proof, active movement leases and native combat/player exclusion.
- `integration/coopNpcWreckCustody.cjs`: attaches original wreck/source IDs to durable native cargo and validates them against journal replay without losing earlier custody behavior.
- `integration/coopNativeNpcMarket.cjs`: optional exact cargo ID / provenance verifier for source-controlled sales, rechecked after `GetOrders`. Pre-existing sell/buy flows are unchanged. Trade ack includes cargo, source wreck, `npcLedgerOnly`.
- `integration/coopVirtualWorldRuntime.cjs`: a new bounded `native-loot-station-delivery` World phase ahead of generic civilian navigation, plus opt-in pirate cargo selection at physically reached station. Existing gate/patrol/civilian director blocks observe active real cargo delivery; old native market fence still refuses trades during combat.
- `scripts/patch-evejs-coop.cjs`: installs the new module in the existing reversible EveJS overlay; no new upstream hook.

## Feature gates (all default OFF)

```
EVEJS_COOP_VIRTUAL_WORLD=1
EVEJS_COOP_MATERIALIZE_NPCS=1
EVEJS_COOP_NATIVE_NPC_MARKET=1
EVEJS_COOP_NPC_ORDER_ARBITER=1
EVEJS_COOP_NPC_WRECK_RECOVERY=1
EVEJS_COOP_NATIVE_WEAPON_EVIDENCE=1
EVEJS_COOP_NPC_WRECK_TRANSFER=1
EVEJS_COOP_NPC_LOOT_COMMERCE=1
EVEJS_COOP_NPC_MARKET_SELL_TYPES=<actual allowlisted loot typeIDs>
```

The custody and native market journal directories must be persistent and writable:
`EVEJS_COOP_NPC_WRECK_CUSTODY_ROOT` defaults to `/var/lib/evejs/coop-npc-wreck-custody`; the market's existing root defaults to `/var/lib/evejs/coop-native-market`.

**Crimewatch restriction persists:** stock NPC mining fleet wrecks generally belong to the victim or its corporation. A hostile pirate **cannot** take them without independently verified loot rights under PR #46. This implementation does not silently enable unlawful theft. Meaningful NPC piracy with lawful/suspect theft and player counterplay requires a distinct source-audited native Crimewatch rule set.

## Evidence and acceptance

- **11/11** new native loot cargo provenance, waypoint, physical station and conflicting order tests PASS.
- **4/4** new async targeted native seed market tests PASS, including identical-type unrelated cargo untouched, forged source refusal and mid-book change refusal before market fill.
- **20/20** augmented native wreck custody tests PASS, including persistent provenance and forged source recovery refusal.
- **13/13** unmodified existing NPC native market regression tests PASS. **48/48 total** executed using the actual fetched committed JS modules and tests with an isolated V8 environment and an in-memory filesystem shim. This is **not** `node --test` with actual EveJS SQLite/market daemon, native physics or two game clients.
- Full overlay roundtrip, native scene two-client journey, actual seeded order fill and wallet accounting, RPC crash fault injection, concurrency with the refinery/haulers/other players, performance and Crimewatch must still be tested in an owner-approved disposable server.

### Next actual gameplay gate

Select a real system with a known seed BUY order for a loot type and a legal NPC owner of the wreck; observe **native kill → wreck → source-proven item → physical station → real FillOrder → native cargo debit → NPC market ledger settled**. Abort on any missing native evidence; never report ISK, loot or inventory changes from intent alone.

**No main merge, no Docker restart/deploy, no CI, no `evejs-data` mutation.**
