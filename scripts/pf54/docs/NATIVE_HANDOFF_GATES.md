# PF-54 Original-Ship Handoff Acceptance Gates

**FAIL CLOSED: production and WORK deployment OFF until ALL gates are proven.**

## Exact original API evidence (retrieved from `pas7-studio/EveJS` branch `coop/pas7std`)

| Original source | Git blob SHA-1 |
| --- | --- |
| `Code/server/src/space/npc/nativeNpcService.js` | `ca039daaaad2839d17f7109de2f3834cec0373a8` |
| `Code/server/src/space/npc/nativeNpcStore.js` | `95724ab4537683e7ee933bc3149d0a891082ce7e` |
| `Code/server/src/services/inventory/itemStore.js` | `e992d56ee9cff1911d54247bf46d44d01e5d8060` |
| `Code/server/src/space/coopGameStoreAtomic.js` | `2b28b48145f3fbc989ce7346384487ee75e52280` |
| `Code/server/src/space/coopNpcOrderArbiter.js` | `aa5447ada4015b1ac8262d14bae5cd975af6ec6b` |
| `Code/server/src/space/coopNpcOrderBridge.js` | `c0f93af3e5a67703a84dc03cab8da29a65afdf3b` |

## Blocking integration contracts

1. **Original inventory ownership**: all real stock ItemStore operators (sell,
   trade, contract, repackage, undock, move, fit, repair, dock and death) must
   honor the exact PF52 reservation and PF54 deployment intent in their own
   original serializable write boundaries. The feature must not be enabled
   merely because `allWritersFenced()` returns a stubbed true.
2. **Original native handoff**: implement an original server-only executor that
   moves the **existing** player-owned `items[itemID]` into its original in-space
   state, registers an authorized sessionless native NPC controller and scene
   representation for **that same itemID**, preserves original modules/fitting,
   cargo, skill restrictions and ownership, and does not call the stock NPC
   `allocateEntityID()` to mint a second hull.
3. **Native controller uniqueness**: explicit rule for collision between itemID
   and the nativeNpcStore entityID namespace; do not alias an unrelated NPC.
   Check live scene, persistent entity/controller, and any player session/active
   ship before the first handoff. `npcRuntimeControllers` is absent from the
   GameStore atomic allowlist in the reviewed source. Do not pretend all of
   these rows are one SQLite transaction.
4. **PF ownership**: bind the new `verifyExclusiveOwnership(c,tx)` to real
   PF44/PF46 Mining leases and writer permits, WAR and Exploration authoritative
   rows. Original PF01 actor claims, PF52 roster and item source,
   WAR, Mining PF42/PF44/PF46 writers and Exploration must reciprocally refuse
   new work on this original ship/pilot while the PREPARED/ISSUING/ACTIVE
   ownership claim is live. A callback must prove this on WORK.
5. **Independent reconciliation**: verify native scene has **exactly one** ship
   entity, live matching controller and owner; original `items` root has
   category=6, `flagID=0`, locationID=systemID, original itemID, and valid
   `spaceState`, then independently verify original modules/cargo ownership.
   An executor saying `COMPLETED` is never enough. All proof must be collected
   from the authoritative in-process owner while original writes are fenced.
6. **Crash handling**: after PF54 commits ISSUING, no automatic second physical
   handoff, even if the process dies before the first handoff call. Operator
   reconciliation must use original evidence to decide whether to resume,
   cancel or repair. This candidate only implements the ACTIVE path.
7. **Sessionless native orders**: original `coopNpcOrderArbiter` does not yet
   accept `PERSONAL_FLEET`, and `coopNpcOrderBridge` does not support it. A
   separate tested PF55 reciprocal owner and direct order integration is required.
8. **Payroll and hire**: PF53 wallet/contract is a prerequisite, not a free
   native spawn. PF54 does not charge additional ISK; periodically due salary,
   dismissal with liabilities and original docking remain pending.
9. **Same roster**: PF52 `HANGAR_RESERVED` is legacy assignment ownership and
   does not by itself state that the physical ship remains in a hangar. Once
   PF54 is ACTIVE, derive the UI's physical state from the PF54 deployment
   receipt, not solely the PF52 roster. A native schema migration and tests
   are needed before merging.
10. **WORK proof**: run full original checkout with two real player sessions,
    source-accurate NPC Agent hire, original player wallet debit and NPC company
    credit, stock ship reservation, full native handoff, module and cargo
    continuity, one original entity, reboot recovery, commands and docking.
    Do not mark `PLAY` safe based on isolated SQLite fixtures.

## Intentional non-goals of this candidate

- No direct mutation of ItemStore from the PF54 module.
- No new native entity ID, ship, module, cargo item or payment.
- No automatic retry from `ISSUING` or timeout-based intent release.
- No assumption that a synthetic fixture's `nativeNpc=true` proves a real fork.
- No PLAY deploy, no GitHub Actions, no main merge and no PF42 bypass.