# PF60 remaining blockers to real native integration

| Requirement | State |
| --- | --- |
| Original PF56 DOCK_ISSUING item+receipt custody | PF60 protocol implemented with injected trusted proof, WORK NOT RUN |
| Original PF57 wreck+kill+asset custody | Protocol validates wreck/item and injected witness, WORK NOT RUN |
| PF58 source-pinned native handoff | Review candidate only |
| PF59 generic NPC deletion hard block | Review patch only, NOT native-installed |
| **Dedicated scoped PF60 original native entity/controller cleanup writer** | **NOT IMPLEMENTED in EveJS fork; this is essential** |
| All native/market/inventory/Mining/WAR/Exploration writers fenced | Not proven |
| PF54/PF56/PF57 full original SQLite state and crash reconcile | Local original-shaped SQLite, no WORK |
| Anti-replay original writer generation for reusing docked hull | Local PF60 tested, native writer not integrated |
| True player authentication, NPC service, stock fitted ammunition | Not installed |
| Linux WORK kill/recovery and authenticated two-player EVE client | NOT RUN |

## Deadlock avoided in candidate policy, not in gameplay

PF57 loss needs native rows absent while PF59 blocks generic removal. The PF60 `executeScopedNativeCleanup` authority **must be a new carefully reviewed in-fork method** that removes exactly a verified Personal Fleet native row/controller; it may NOT reuse `destroyNativeNpcController` / `removeNativeEntityCascade`. No such native primitive exists in the current deployed engine. A code-level test double is not sufficient evidence. Do not enable PF54/58/59/60 in WORK or PLAY until the scoped native executor, independent scene readback and complete reciprocal writer fences exist.

PF60 finalization uses original `tx.del()` for lock release; `tx.put(null)` is prohibited by `coopGameStoreAtomic`. The PF60 durable terminal ship tombstone is used only by PF60 for generation comparison; PF58 engine integration must also review and fence concurrent new handoffs. `readNativeIdentity` must be authoritative and synchronous, and `allWritersFenced` needs original writer coverage, not arbitrary callback returning true.

Never retry an ISSUING native effect on timeout. A stuck original ship should remain blocked and require operator investigation.
