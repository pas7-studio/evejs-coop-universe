# PF58 WORK integration requirements

| Source | Read evidence | Current gate |
| --- | --- | --- |
| Original ItemStore (`items`) | Original ship itemID, ownerID, station, `flagID`, original fitted/cargo itemIDs | Source verified; foreign writers NOT fenced |
| PF52 original reservation (`corporationRuntime`) | Unique pilot + original ship + assignment + generation | Tested in synthetic original-shaped SQLite |
| PF54 deployment | Durable `ISSUING`, dispatchCount 1, fittingHash/cargoHash | Source candidate, native fork not integrated |
| PF58 one-shot permit | Global ship lock + assignment CONSUMED before any ItemStore move | SQLite tested, including child SIGKILL |
| Original `moveShipToSpace` | Same original ship item ID, no new item ID | Native API verified in GitHub source; NOT executed in actual EveJS |
| `nativeNpcStore` | Native entity/controller with EXACT original ID | Adapter tested with injected original API-shaped stubs; native server NOT RUN |
| Original fitted/slim module source | `getFittedModuleItems(owner, itemID)` and `buildSlimModuleTuples(owner,itemID)` | Source-pinned native patch; original full checkout NOT patched |
| `materializeStoredNativeController` | Only with PF58 permit; ISSUING allowed for initial direct adoption; ACTIVE+actor claim for restart | Synthetic `git apply --check`, actual WORK NOT RUN |
| `npcEquipment` | Avoid synthetic NPC cargo/ammo, use stock original fitted items | Stock modules patched; original ammo combat NOT integrated |
| Non-combat Orders | PF55 arbiter owner PERSONAL_FLEET and original controller receipt | PF55 native patch remains uninstalled |
| Return/Docking | No `removeNativeEntityCascade` until cargo/fitting custody is proven | PF56 native dock executor NOT installed |

## Critical architectural distinctions

- The original EveJS `spawnDynamicShip` accepts a preferred `itemID` through
  `buildRuntimeShipEntity`, but the standard NPC factory still uses
  `nativeNpcStore.allocateEntityID`. PF58 never calls that factory.
- Physical `items`, `npcEntities` and `npcRuntimeControllers` are distinct
  native persistence owners and cannot all be safely committed in the
  PF52/54 `corporationRuntime+items` GameStore transaction. PF58 commits a
  one-shot permit first; unknown external results are operator-repair-only.
- The true NPC loadout model uses `definition.profile.shipTypeID`, **not**
  `profile.typeID`. PF58 checks the exact original stock hull type.
- `nativeNpcService.materializeStoredNativeController` auto restores NPC
  runtime controllers. PF58 patch requires PF54 ACTIVE for automatic restart,
  so partial adoption cannot silently respawn a ship after crash.
- Existing stock character-session docking is not valid for a sessionless NPC.
  It cannot be faked with a player session. PF56 is still a separate blocker.

## Live acceptance matrix (all NOT RUN)

- Real WORK: authorized player hires actual NPC using real player wallet, then
  reserves ONE real ship in original hangar; original `itemID` unchanged.
- Deploy from original station: native entity + controller IDs equal the
  same original ship ID; no synthetic cargo/modules or duplicated inventory.
- Original EVE client observes real Follow and Warp for the adopted NPC;
  other WAR/Mining directors refuse its claim.
- SIGKILL between PF58 permit, stock item move, native controller row, scene
  spawn and PF54 ACTIVE; restart must not duplicate ship or rerun the handoff.
- Real docking returns original item, all original fitting/cargo identities,
  closes PF claim, and allows dismissal with original salary accounting.
- Two distinct players may not hire, control or lose each other's original ships.
- PLAY excluded; no flag activation or CI until WORK signoff.
